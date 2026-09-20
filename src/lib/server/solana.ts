import {
  Connection,
  PublicKey,
  SystemProgram,
  type ParsedInstruction,
  type PartiallyDecodedInstruction,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { base58Decode, parseZAppMemo, U64_MAX } from "../protocol.ts";
import { assertMainnetTransparentAddress, deriveBurnId } from "./crypto.ts";
import type { BurnEvidence } from "../validation.ts";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

function rpcUrl(): string {
  return process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

export function solanaConnection(): Connection {
  return new Connection(rpcUrl(), { commitment: "finalized" });
}

function instructionProgramId(ix: ParsedInstruction | PartiallyDecodedInstruction): string {
  return ix.programId.toBase58();
}

function parseMemo(ix: ParsedInstruction | PartiallyDecodedInstruction): string | null {
  if (instructionProgramId(ix) !== MEMO_PROGRAM_ID.toBase58()) return null;
  if ("parsed" in ix) {
    if (typeof ix.parsed === "string") return ix.parsed;
    const candidate = (ix.parsed as { info?: unknown })?.info;
    if (typeof candidate === "string") return candidate;
    return null;
  }
  try {
    return new TextDecoder().decode(base58Decode(ix.data));
  } catch {
    return null;
  }
}

type ParsedBurn = {
  mint: string;
  amount: bigint;
  authority: string;
  locator: string;
};

function parseBurnChecked(
  ix: ParsedInstruction | PartiallyDecodedInstruction,
  index: number,
): ParsedBurn | null {
  const programId = instructionProgramId(ix);
  if (programId !== TOKEN_PROGRAM_ID.toBase58() && programId !== TOKEN_2022_PROGRAM_ID.toBase58()) {
    return null;
  }
  if (!("parsed" in ix) || !ix.parsed || typeof ix.parsed !== "object") return null;

  const parsed = ix.parsed as {
    type?: string;
    info?: {
      mint?: string;
      authority?: string;
      tokenAmount?: { amount?: string };
      amount?: string | number;
    };
  };
  if ((parsed.type || "").toLowerCase() !== "burnchecked") return null;

  const mint = parsed.info?.mint;
  const authority = parsed.info?.authority;
  const amountRaw = parsed.info?.tokenAmount?.amount ?? parsed.info?.amount;
  if (!mint || !authority || amountRaw === undefined) throw new Error("Malformed BurnChecked instruction");

  const amount = BigInt(String(amountRaw));
  if (amount <= 0n || amount > U64_MAX) throw new Error("Burn amount is outside ZApp's uint64 range");
  if (base58Decode(mint).length !== 32) throw new Error("Burn mint is not a 32-byte Solana public key");

  return { mint, amount, authority, locator: `message:${index}` };
}

function verifyConfiguredServiceFee(
  instructions: Array<ParsedInstruction | PartiallyDecodedInstruction>,
  burnAuthority: string,
): void {
  const required = BigInt(process.env.ZAPP_FEE_LAMPORTS || "0");
  if (required <= 0n) return;

  const treasury = process.env.ZAPP_FEE_TREASURY;
  if (!treasury) throw new Error("ZAPP_FEE_TREASURY is required when a relay fee is enabled");

  const matches = instructions.filter((ix) => {
    if (instructionProgramId(ix) !== SystemProgram.programId.toBase58()) return false;
    if (!("parsed" in ix) || !ix.parsed || typeof ix.parsed !== "object") return false;
    const parsed = ix.parsed as {
      type?: string;
      info?: { source?: string; destination?: string; lamports?: number | string };
    };
    if ((parsed.type || "").toLowerCase() !== "transfer") return false;
    if (parsed.info?.source !== burnAuthority || parsed.info?.destination !== treasury) return false;
    try {
      return BigInt(String(parsed.info?.lamports ?? "0")) >= required;
    } catch {
      return false;
    }
  });

  if (matches.length !== 1) throw new Error("Required ZApp relay fee was not paid in the burn transaction");
}

export async function verifyBurnTransaction(
  signature: string,
  connection = solanaConnection(),
): Promise<BurnEvidence> {
  if (!signature || signature.length < 40) throw new Error("Invalid Solana signature");

  const [statusResult, transaction, genesisHash] = await Promise.all([
    connection.getSignatureStatuses([signature], { searchTransactionHistory: true }),
    connection.getParsedTransaction(signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    }),
    connection.getGenesisHash(),
  ]);

  const status = statusResult.value[0];
  if (!status || status.err || status.confirmationStatus !== "finalized") {
    throw new Error("Solana burn is not successfully finalized");
  }
  if (!transaction || transaction.meta?.err) throw new Error("Finalized Solana transaction could not be verified");

  const instructions = transaction.transaction.message.instructions;
  const burns = instructions
    .map((ix, index) => parseBurnChecked(ix, index))
    .filter((burn): burn is ParsedBurn => burn !== null);
  if (burns.length !== 1) {
    throw new Error("ZApp v1 requires exactly one top-level SPL BurnChecked instruction");
  }

  const zappMemos = instructions
    .map(parseMemo)
    .filter((memo): memo is string => Boolean(memo))
    .map(parseZAppMemo)
    .filter((address): address is string => Boolean(address));
  if (zappMemos.length !== 1) {
    throw new Error("ZApp v1 requires exactly one ZAPP1 destination memo");
  }

  const recipient = zappMemos[0];
  assertMainnetTransparentAddress(recipient);

  const signerSet = new Set(
    transaction.transaction.message.accountKeys
      .filter((key) => key.signer)
      .map((key) => key.pubkey.toBase58()),
  );
  const burn = burns[0];
  if (!signerSet.has(burn.authority)) {
    throw new Error("Burn authority is not a direct transaction signer; multisig/delegated v1 claims are not supported");
  }

  verifyConfiguredServiceFee(instructions, burn.authority);

  const burnId = deriveBurnId({
    solanaGenesisHash: genesisHash,
    signature,
    instructionLocator: burn.locator,
    mint: burn.mint,
  });

  return {
    burnId,
    signature,
    instructionLocator: burn.locator,
    slot: transaction.slot,
    mint: burn.mint,
    amount: burn.amount,
    recipient,
    authority: burn.authority,
    finalized: true,
    successful: true,
  };
}

export async function findBurnEvidenceByCommitment(
  mint: string,
  burnId: string,
  connection = solanaConnection(),
): Promise<BurnEvidence | null> {
  const mintKey = new PublicKey(mint);
  const maxPages = Number.parseInt(process.env.SOLANA_DISCOVERY_MAX_PAGES || "20", 10);
  let before: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const signatures = await connection.getSignaturesForAddress(mintKey, { before, limit: 1000 }, "finalized");
    if (signatures.length === 0) return null;

    for (const candidate of signatures) {
      if (candidate.err) continue;
      try {
        const evidence = await verifyBurnTransaction(candidate.signature, connection);
        if (evidence.burnId === burnId) return evidence;
      } catch {
        // Not a valid ZApp burn. Continue scanning public history.
      }
    }

    before = signatures.at(-1)?.signature;
    if (!before || signatures.length < 1000) return null;
  }

  return null;
}
