import { createHash } from "node:crypto";
import { base58Decode, parseZAppMemo, U64_MAX } from "../protocol.ts";
import { assertMainnetTransparentAddress, deriveBurnId } from "./crypto.ts";
import type { BurnEvidence } from "../validation.ts";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const INCINERATOR = "1nc1nerator11111111111111111111111111111111";
const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);
const MEMO_PROGRAMS = new Set([
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH",
]);
const UNSIGNED_BURN_OWNERS = new Set([SYSTEM_PROGRAM, INCINERATOR]);
const IX_BURN_CHECKED = 15;

type RawIx = { programIdIndex: number; accounts: number[]; data: string };
type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals?: number };
};
type RawTransaction = {
  slot: number;
  blockTime?: number | null;
  version?: number | "legacy";
  meta: {
    err: unknown;
    innerInstructions?: Array<{ index: number; instructions: RawIx[] }> | null;
    preTokenBalances?: TokenBalance[] | null;
    postTokenBalances?: TokenBalance[] | null;
    loadedAddresses?: { writable: string[]; readonly: string[] } | null;
  } | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: string[];
      header: { numRequiredSignatures: number };
      instructions: RawIx[];
    };
  };
};

type RpcResponse<T> = { result?: T; error?: { code: number; message: string } };

function rpcUrl(): string {
  return process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "zapp", method, params }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Solana RPC HTTP ${response.status}`);
  const body = (await response.json()) as RpcResponse<T>;
  if (body.error) throw new Error(`Solana RPC ${body.error.code}: ${body.error.message}`);
  if (body.result === undefined) throw new Error("Solana RPC returned no result");
  return body.result;
}

function keysFor(tx: RawTransaction): string[] {
  const loaded = tx.meta?.loadedAddresses;
  return [
    ...tx.transaction.message.accountKeys,
    ...(loaded?.writable || []),
    ...(loaded?.readonly || []),
  ];
}

function readU64LE(data: Uint8Array, offset: number): bigint {
  if (data.length < offset + 8) throw new Error("Truncated u64");
  let out = 0n;
  for (let i = 7; i >= 0; i -= 1) out = (out << 8n) | BigInt(data[offset + i]);
  return out;
}

type RawBurn = {
  programId: string;
  sourceIndex: number;
  mint: string;
  authority: string;
  amount: bigint;
  decimals: number;
  topLevel: boolean;
  locator: string;
};

function decodeBurnChecked(
  ix: RawIx,
  keys: string[],
  topLevel: boolean,
  locator: string,
): RawBurn | null {
  const programId = keys[ix.programIdIndex];
  if (!TOKEN_PROGRAMS.has(programId)) return null;
  const data = base58Decode(ix.data);
  if (data.length !== 10 || data[0] !== IX_BURN_CHECKED) return null;
  if (ix.accounts.length < 3) throw new Error("Malformed BurnChecked accounts");

  const amount = readU64LE(data, 1);
  if (amount <= 0n || amount > U64_MAX) throw new Error("Burn amount is outside uint64 range");

  const sourceIndex = ix.accounts[0];
  const mint = keys[ix.accounts[1]];
  const authority = keys[ix.accounts[2]];
  if (!mint || !authority || !keys[sourceIndex]) throw new Error("BurnChecked references missing account keys");
  if (base58Decode(mint).length !== 32) throw new Error("Burn mint is not a Solana public key");

  return {
    programId,
    sourceIndex,
    mint,
    authority,
    amount,
    decimals: data[9],
    topLevel,
    locator,
  };
}

function decodeMemo(ix: RawIx, keys: string[]): string | null {
  const programId = keys[ix.programIdIndex];
  if (!MEMO_PROGRAMS.has(programId)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(base58Decode(ix.data));
  } catch {
    throw new Error("ZApp memo is not valid UTF-8");
  }
}

function balanceMap(balances?: TokenBalance[] | null): Map<number, TokenBalance> {
  return new Map((balances || []).map((balance) => [balance.accountIndex, balance]));
}

export async function fetchFinalizedRawTransaction(signature: string): Promise<RawTransaction> {
  const tx = await rpc<RawTransaction | null>("getTransaction", [
    signature,
    {
      commitment: "finalized",
      encoding: "json",
      maxSupportedTransactionVersion: 1,
    },
  ]);
  if (!tx) throw new Error("Finalized Solana transaction is unavailable from this RPC");
  return tx;
}

async function finalizedStatus(signature: string): Promise<boolean> {
  const status = await rpc<{ value: Array<{ err: unknown; confirmationStatus?: string } | null> }>(
    "getSignatureStatuses",
    [[signature], { searchTransactionHistory: true }],
  );
  const row = status.value[0];
  return Boolean(row && row.err === null && row.confirmationStatus === "finalized");
}

async function genesisHash(): Promise<string> {
  return rpc<string>("getGenesisHash", []);
}

export async function verifyBurnRaw(signature: string): Promise<BurnEvidence> {
  if (!signature || signature.length < 40) throw new Error("Invalid Solana signature");
  const [tx, finalized, genesis] = await Promise.all([
    fetchFinalizedRawTransaction(signature),
    finalizedStatus(signature),
    genesisHash(),
  ]);

  if (!finalized) throw new Error("Solana burn is not successfully finalized");
  if (!tx.meta || tx.meta.err !== null) throw new Error("Solana burn transaction failed");
  if (tx.transaction.signatures[0] !== signature) throw new Error("RPC transaction signature mismatch");

  const keys = keysFor(tx);
  const top = tx.transaction.message.instructions;
  const allBurns: RawBurn[] = [];

  top.forEach((ix, index) => {
    const burn = decodeBurnChecked(ix, keys, true, `message:${index}`);
    if (burn) allBurns.push(burn);
  });
  for (const group of tx.meta.innerInstructions || []) {
    group.instructions.forEach((ix, index) => {
      const burn = decodeBurnChecked(ix, keys, false, `inner:${group.index}:${index}`);
      if (burn) allBurns.push(burn);
    });
  }

  // v1 is intentionally strict: exactly one BurnChecked in the whole tx.
  if (allBurns.length !== 1) throw new Error("ZApp v1 requires exactly one BurnChecked instruction");
  const burn = allBurns[0];
  if (!burn.topLevel) throw new Error("ZApp v1 does not accept CPI/inner burns");

  const memos = top.map((ix) => decodeMemo(ix, keys)).filter((memo): memo is string => memo !== null);
  if (memos.length !== 1) throw new Error("ZApp v1 requires exactly one top-level memo");
  const recipient = parseZAppMemo(memos[0]);
  if (!recipient) throw new Error("Memo does not contain a canonical ZAPP1 destination");
  assertMainnetTransparentAddress(recipient);

  const signerCount = tx.transaction.message.header.numRequiredSignatures;
  const signers = new Set(tx.transaction.message.accountKeys.slice(0, signerCount));
  if (!signers.has(burn.authority)) throw new Error("Burn authority did not directly sign the transaction");

  const pre = balanceMap(tx.meta.preTokenBalances).get(burn.sourceIndex);
  const post = balanceMap(tx.meta.postTokenBalances).get(burn.sourceIndex);
  if (!pre?.owner) throw new Error("preTokenBalances does not record the source token owner");
  if (UNSIGNED_BURN_OWNERS.has(pre.owner)) throw new Error("System/incinerator-owned token accounts are not claimable");
  if (pre.owner !== burn.authority) throw new Error("Burn authority is not the source token-account owner");
  if (pre.mint !== burn.mint) throw new Error("Source balance mint does not match BurnChecked mint");
  if (pre.uiTokenAmount.decimals !== undefined && pre.uiTokenAmount.decimals !== burn.decimals) {
    throw new Error("BurnChecked decimals do not match the source token balance");
  }

  const preAmount = BigInt(pre.uiTokenAmount.amount);
  const postAmount = post ? BigInt(post.uiTokenAmount.amount) : 0n;
  if (preAmount - postAmount !== burn.amount) {
    throw new Error("Source token balance delta does not equal the BurnChecked amount");
  }

  const burnId = deriveBurnId({
    solanaGenesisHash: genesis,
    signature,
    instructionLocator: burn.locator,
    mint: burn.mint,
  });

  return {
    burnId,
    signature,
    instructionLocator: burn.locator,
    slot: tx.slot,
    mint: burn.mint,
    amount: burn.amount,
    recipient,
    authority: burn.authority,
    finalized: true,
    successful: true,
  };
}

export async function listFinalizedMintSignatures(
  mint: string,
  before?: string,
): Promise<Array<{ signature: string; err: unknown; memo?: string | null; slot: number }>> {
  return rpc("getSignaturesForAddress", [
    mint,
    {
      before,
      limit: 1000,
      commitment: "finalized",
    },
  ]);
}

export async function findBurnRawByCommitment(
  mint: string,
  burnId: string,
): Promise<BurnEvidence | null> {
  const maxPages = Math.max(1, Number.parseInt(process.env.SOLANA_DISCOVERY_MAX_PAGES || "20", 10));
  let before: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const signatures = await listFinalizedMintSignatures(mint, before);
    if (signatures.length === 0) return null;

    for (const candidate of signatures) {
      if (candidate.err || !candidate.memo) continue;
      try {
        const evidence = await verifyBurnRaw(candidate.signature);
        if (evidence.mint === mint && evidence.burnId === burnId) return evidence;
      } catch {
        // Not a canonical ZApp burn.
      }
    }

    before = signatures.at(-1)?.signature;
    if (!before || signatures.length < 1000) return null;
  }
  return null;
}

export function rawVerifierFingerprint(): string {
  return createHash("sha256")
    .update("zapp-solana-raw-v1|burnchecked|pre-post-owner|memo-v1-v3-v4|max-tx-v1")
    .digest("hex");
}
