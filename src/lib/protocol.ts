export const ZAPP_MAGIC = "ZAPP";
export const ZAPP_VERSION = 1;
export const OP_CLAIM = 1;
export const OP_TRANSFER = 2;
export const CLAIM_PAYLOAD_BYTES = 78;
export const TRANSFER_PAYLOAD_BYTES = 38;
export const U64_MAX = (1n << 64n) - 1n;
export const ZAPP_MEMO_PREFIX = "ZAPP1:";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ALPHABET_INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

export type ZAppProof = {
  version: 1;
  operation: "claim";
  mint: string;
  burnId: string;
  amount: bigint;
};

export type ZAppTransfer = {
  version: 1;
  operation: "transfer";
  burnId: string;
};

export type ZAppPayload = ZAppProof | ZAppTransfer;

export function base58Decode(value: string): Uint8Array {
  if (!value) return new Uint8Array();
  let n = 0n;
  for (const char of value) {
    const digit = ALPHABET_INDEX.get(char);
    if (digit === undefined) throw new Error(`Invalid base58 character: ${char}`);
    n = n * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.push(Number(n & 0xffn));
    n >>= 8n;
  }
  bytes.reverse();
  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === "1") leadingZeroes += 1;
  return Uint8Array.from([...new Array(leadingZeroes).fill(0), ...bytes]);
}

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let n = 0n;
  for (const byte of bytes) n = (n << 8n) + BigInt(byte);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return "1".repeat(zeroes) + out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string, expectedBytes?: number): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) throw new Error("Invalid hex");
  const bytes = Uint8Array.from(hex.match(/.{2}/g)?.map((v) => Number.parseInt(v, 16)) ?? []);
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) {
    throw new Error(`Expected ${expectedBytes} bytes, got ${bytes.length}`);
  }
  return bytes;
}

export function encodeClaimPayload(input: { mint: string; burnId: string; amount: bigint }): Uint8Array {
  if (input.amount <= 0n || input.amount > U64_MAX) {
    throw new Error("Amount must fit unsigned 64-bit base units");
  }
  const mint = base58Decode(input.mint);
  if (mint.length !== 32) throw new Error("Solana mint must decode to 32 bytes");
  const burnId = hexToBytes(input.burnId, 32);

  const out = new Uint8Array(CLAIM_PAYLOAD_BYTES);
  out.set(new TextEncoder().encode(ZAPP_MAGIC), 0);
  out[4] = ZAPP_VERSION;
  out[5] = OP_CLAIM;
  out.set(mint, 6);
  out.set(burnId, 38);
  new DataView(out.buffer).setBigUint64(70, input.amount, true);
  return out;
}

export function decodeClaimPayload(bytes: Uint8Array): ZAppProof {
  if (bytes.length !== CLAIM_PAYLOAD_BYTES) {
    throw new Error(`Invalid ZApp payload length: ${bytes.length}`);
  }
  const magic = new TextDecoder().decode(bytes.slice(0, 4));
  if (magic !== ZAPP_MAGIC || bytes[4] !== ZAPP_VERSION || bytes[5] !== OP_CLAIM) {
    throw new Error("Unsupported ZApp payload");
  }
  return {
    version: 1,
    operation: "claim",
    mint: base58Encode(bytes.slice(6, 38)),
    burnId: bytesToHex(bytes.slice(38, 70)),
    amount: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(70, true),
  };
}


export function encodeTransferPayload(input: { burnId: string }): Uint8Array {
  const burnId = hexToBytes(input.burnId, 32);
  const out = new Uint8Array(TRANSFER_PAYLOAD_BYTES);
  out.set(new TextEncoder().encode(ZAPP_MAGIC), 0);
  out[4] = ZAPP_VERSION;
  out[5] = OP_TRANSFER;
  out.set(burnId, 6);
  return out;
}

export function decodeTransferPayload(bytes: Uint8Array): ZAppTransfer {
  if (bytes.length !== TRANSFER_PAYLOAD_BYTES) {
    throw new Error(`Invalid ZApp transfer payload length: ${bytes.length}`);
  }
  const magic = new TextDecoder().decode(bytes.slice(0, 4));
  if (magic !== ZAPP_MAGIC || bytes[4] !== ZAPP_VERSION || bytes[5] !== OP_TRANSFER) {
    throw new Error("Unsupported ZApp transfer payload");
  }
  return {
    version: 1,
    operation: "transfer",
    burnId: bytesToHex(bytes.slice(6, 38)),
  };
}

export function decodeProtocolPayload(bytes: Uint8Array): ZAppPayload {
  if (bytes.length < 6) throw new Error("ZApp payload is too short");
  if (bytes[5] === OP_CLAIM) return decodeClaimPayload(bytes);
  if (bytes[5] === OP_TRANSFER) return decodeTransferPayload(bytes);
  throw new Error("Unknown ZApp operation");
}

export function encodeOpReturnScript(payload: Uint8Array): Uint8Array {
  if (payload.length > 80) throw new Error("ZApp payload exceeds the 80-byte data-carrier budget");
  if (payload.length <= 75) return Uint8Array.from([0x6a, payload.length, ...payload]);
  return Uint8Array.from([0x6a, 0x4c, payload.length, ...payload]);
}

export function decodeOpReturnScript(scriptHex: string): Uint8Array | null {
  const script = hexToBytes(scriptHex);
  if (script.length < 2 || script[0] !== 0x6a) return null;
  let length: number;
  let offset: number;
  if (script[1] <= 75) {
    length = script[1];
    offset = 2;
  } else if (script[1] === 0x4c && script.length >= 3) {
    length = script[2];
    offset = 3;
  } else {
    return null;
  }
  if (script.length !== offset + length) return null;
  return script.slice(offset);
}

export function buildZAppMemo(zcashAddress: string): string {
  return `${ZAPP_MEMO_PREFIX}${zcashAddress.trim()}`;
}

export function parseZAppMemo(memo: string): string | null {
  if (!memo.startsWith(ZAPP_MEMO_PREFIX)) return null;
  const address = memo.slice(ZAPP_MEMO_PREFIX.length).trim();
  return address || null;
}

export function parseUiAmount(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("Invalid decimals");
  const clean = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(clean)) throw new Error("Enter a positive decimal amount");
  const [whole, fraction = ""] = clean.split(".");
  if (fraction.length > decimals) throw new Error(`This token supports at most ${decimals} decimal places`);
  const base = BigInt(whole) * 10n ** BigInt(decimals);
  const fractional = fraction ? BigInt(fraction.padEnd(decimals, "0")) : 0n;
  const result = base + fractional;
  if (result <= 0n || result > U64_MAX) throw new Error("Amount is outside the supported uint64 range");
  return result;
}

export function formatBaseUnits(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
