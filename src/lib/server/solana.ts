import { base58Decode, parseZAppMemo, U64_MAX } from "../protocol.ts";
import { assertMainnetTransparentAddress, deriveBurnId } from "./crypto.ts";
import type { BurnEvidence } from "../validation.ts";

const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const INCINERATOR = "1nc1nerator11111111111111111111111111111111";
const MEMO_PROGRAMS = new Set([
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH",
]);
const TOKEN_PROGRAMS = new Set([SPL_TOKEN, TOKEN_2022]);
const UNSIGNED_BURN_OWNERS = new Set([SYSTEM_PROGRAM, INCINERATOR]);
const IX_BURN_CHECKED = 15;
const SYSTEM_TRANSFER = 2;

type RawInstruction = {
  programIdIndex: number;
  accounts: number[];
  data: string;
};

type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: {
    amount: string;
    decimals?: number;
  };
};

type RawTransaction = {
  slot: number;
  blockTime?: number | null;
  version?: number | "legacy";
  meta: {
    err: unknown;
    innerInstructions?: Array<{ index: number; instructions: RawInstruction[] }> | null;
    preTokenBalances?: TokenBalance[] | null;
    postTokenBalances?: TokenBalance[] | null;
    loadedAddresses?: { writable: string[]; readonly: string[] } | null;
  } | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: string[];
      header: { numRequiredSignatures: number };
      instructions: RawInstruction[];
    };
  };
};

type SignatureStatus = {
  err: unknown;
  confirmationStatus?: "processed" | "confirmed" | "finalized" | null;
};

type SignatureInfo = {
  signature: string;
  slot: number;
  err: unknown;
  memo: string | null;
};

function rpcUrl(): string {
  return process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

let rpcId = 0;
async function solanaRpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Solana RPC HTTP ${response.status}`);
  const body = (await response.json()) as {
    result?: T;
    error?: { code?: number; message?: string };
  };
  if (body.error) {
    throw new Error(`Solana RPC ${method}: ${body.error.message || body.error.code || "unknown error"}`);
  }
  return body.result as T;
}

function resolveKeys(tx: RawTransaction): string[] {
  const loaded = tx.meta?.loadedAddresses;
  return [
    ...tx.transaction.message.accountKeys,
    ...(loaded?.writable ?? []),
    ...(loaded?.readonly ?? []),
  ];
}

function readU64Le(bytes: Uint8Array, offset: number): bigint {
  if (bytes.length < offset + 8) throw new Error("Truncated uint64 instruction field");
  let value = 0n;
  for (let i = 7; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[offset + i]);
  return value;
}

function readU32Le(bytes: Uint8Array, offset: number): number {
  if (bytes.length < offset + 4) throw new Error("Truncated uint32 instruction field");
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function utf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

type ParsedBurn = {
  mint: string;
  sourceIndex: number;
  authority: string;
  amount: bigint;
  decimals: number;
  locator: string;
  programId: string;
  topLevel: boolean;
  sourceOwner: string | null;
  preAmount: bigint | null;
  postAmount: bigint;
  recordedDecimals: number | null;
};

function parseBurnChecked(
  ix: RawInstruction,
  keys: string[],
  index: number,
  topLevel: boolean,
  balances: { pre: Map<number, TokenBalance>; post: Map<number, TokenBalance> },
): ParsedBurn | null {
  const programId = keys[ix.programIdIndex];
  if (!programId || !TOKEN_PROGRAMS.has(programId)) return null;

  const data = base58Decode(ix.data);
  if (data.length !== 10 || data[0] !== IX_BURN_CHECKED) return null;
  if (ix.accounts.length < 3) throw new Error("Malformed BurnChecked account list");

  const sourceIndex = ix.accounts[0];
  const mint = keys[ix.accounts[1]];
  const authority = keys[ix.accounts[2]];
  if (!mint || !authority) throw new Error("BurnChecked references an unresolved account key");

  const amount = readU64Le(data, 1);
  if (amount <= 0n || amount > U64_MAX) throw new Error("Burn amount is outside uint64");
  const decimals = data[9];

  const pre = balances.pre.get(sourceIndex);
  const post = balances.post.get(sourceIndex);
  return {
    mint,
    sourceIndex,
    authority,
    amount,
    decimals,
    locator: topLevel ? `message:${index}` : `inner:${index}`,
    programId,
    topLevel,
    sourceOwner: pre?.owner ?? null,
    preAmount: pre ? BigInt(pre.uiTokenAmount.amount) : null,
    postAmount: post ? BigInt(post.uiTokenAmount.amount) : 0n,
    recordedDecimals: pre?.uiTokenAmount.decimals ?? null,
  };
}

function parseTopLevelMemos(instructions: RawInstruction[], keys: string[]): string[] {
  const memos: string[] = [];
  for (const ix of instructions) {
    const programId = keys[ix.programIdIndex];
    if (!programId || !MEMO_PROGRAMS.has(programId)) continue;
    const decoded = utf8(base58Decode(ix.data));
    if (decoded === null) throw new Error("Memo is not valid UTF-8");
    memos.push(decoded);
  }
  return memos;
}

function relayFeePaid(
  instructions: RawInstruction[],
  keys: string[],
  authority: string,
): boolean {
  const required = BigInt(process.env.ZAPP_FEE_LAMPORTS || "0");
  if (required <= 0n) return true;

  const treasury = process.env.ZAPP_FEE_TREASURY;
  if (!treasury) throw new Error("ZAPP_FEE_TREASURY is required when relay fees are enabled");

  let matches = 0;
  for (const ix of instructions) {
    if (keys[ix.programIdIndex] !== SYSTEM_PROGRAM || ix.accounts.length < 2) continue;
    const data = base58Decode(ix.data);
    if (data.length !== 12 || readU32Le(data, 0) !== SYSTEM_TRANSFER) continue;
    const from = keys[ix.accounts[0]];
    const to = keys[ix.accounts[1]];
    const lamports = readU64Le(data, 4);
    if (from === authority && to === treasury && lamports >= required) matches += 1;
  }
  return matches === 1;
}

async function fetchRawTransaction(signature: string): Promise<RawTransaction | null> {
  return solanaRpc<RawTransaction | null>("getTransaction", [
    signature,
    {
      commitment: "finalized",
      encoding: "json",
      maxSupportedTransactionVersion: 1,
    },
  ]);
}

export async function verifyBurnTransaction(
  signature: string,
  _unusedConnection?: unknown,
  options: { requireRelayFee?: boolean } = {},
): Promise<BurnEvidence> {
  if (!signature || signature.length < 40) throw new Error("Invalid Solana signature");

  const [statuses, tx, genesisHash] = await Promise.all([
    solanaRpc<{ value: Array<SignatureStatus | null> }>("getSignatureStatuses", [
      [signature],
      { searchTransactionHistory: true },
    ]),
    fetchRawTransaction(signature),
    solanaRpc<string>("getGenesisHash", []),
  ]);

  const status = statuses.value[0];
  if (!status || status.err || status.confirmationStatus !== "finalized") {
    throw new Error("Solana burn is not successfully finalized");
  }
  if (!tx || !tx.meta || tx.meta.err !== null) {
    throw new Error("Finalized Solana transaction could not be verified");
  }

  const keys = resolveKeys(tx);
  const pre = new Map((tx.meta.preTokenBalances ?? []).map((balance) => [balance.accountIndex, balance]));
  const post = new Map((tx.meta.postTokenBalances ?? []).map((balance) => [balance.accountIndex, balance]));
  const balances = { pre, post };

  const topBurns = tx.transaction.message.instructions
    .map((ix, index) => parseBurnChecked(ix, keys, index, true, balances))
    .filter((burn): burn is ParsedBurn => burn !== null);

  const innerBurns = (tx.meta.innerInstructions ?? []).flatMap((group) =>
    group.instructions
      .map((ix, innerIndex) => parseBurnChecked(ix, keys, group.index * 1000 + innerIndex, false, balances))
      .filter((burn): burn is ParsedBurn => burn !== null),
  );

  const allBurns = [...topBurns, ...innerBurns];
  if (allBurns.length !== 1) {
    throw new Error("ZApp v1 requires exactly one BurnChecked instruction in the transaction");
  }

  const burn = allBurns[0];
  if (!burn.topLevel) throw new Error("ZApp v1 does not accept burns executed through CPI");
  if (burn.sourceOwner === null || burn.preAmount === null) {
    throw new Error("Solana token balances do not identify the source owner/balance");
  }
  if (UNSIGNED_BURN_OWNERS.has(burn.sourceOwner)) {
    throw new Error("Burn source is system/incinerator-owned and is not claimable");
  }
  if (burn.sourceOwner !== burn.authority) {
    throw new Error("Burn authority is not the source token-account owner");
  }

  const signerCount = tx.transaction.message.header.numRequiredSignatures;
  const signers = new Set(tx.transaction.message.accountKeys.slice(0, signerCount));
  if (!signers.has(burn.authority)) throw new Error("Burn authority did not sign the transaction");

  if (burn.preAmount - burn.postAmount !== burn.amount) {
    throw new Error("Token balance delta does not exactly match BurnChecked amount");
  }
  if (burn.recordedDecimals === null || burn.decimals !== burn.recordedDecimals) {
    throw new Error("BurnChecked decimals do not match the recorded token balance decimals");
  }

  const memos = parseTopLevelMemos(tx.transaction.message.instructions, keys);
  if (memos.length !== 1) throw new Error("ZApp v1 requires exactly one top-level memo instruction");
  const recipient = parseZAppMemo(memos[0]);
  if (!recipient) throw new Error("Memo must be exactly ZAPP1:<zcash-mainnet-t-address>");
  assertMainnetTransparentAddress(recipient);

  if (options.requireRelayFee && !relayFeePaid(tx.transaction.message.instructions, keys, burn.authority)) {
    throw new Error("Required ZApp sponsored-relay fee was not paid in the burn transaction");
  }

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
    slot: tx.slot,
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
): Promise<BurnEvidence | null> {
  const maxPages = Number.parseInt(process.env.SOLANA_DISCOVERY_MAX_PAGES || "0", 10);
  let before: string | undefined;
  let page = 0;

  for (;;) {
    if (maxPages > 0 && page >= maxPages) return null;
    const list = await solanaRpc<SignatureInfo[]>("getSignaturesForAddress", [
      mint,
      { before, limit: 1000 },
      "finalized",
    ]);
    if (list.length === 0) return null;

    for (const candidate of list) {
      // A valid ZApp burn must carry a memo, so this cannot discard a valid candidate.
      if (candidate.err || !candidate.memo) continue;
      try {
        const evidence = await verifyBurnTransaction(candidate.signature);
        if (evidence.burnId === burnId) return evidence;
      } catch {
        // Ordinary mint activity or an invalid ZApp burn.
      }
    }

    before = list.at(-1)?.signature;
    if (!before || list.length < 1000) return null;
    page += 1;
  }
}
