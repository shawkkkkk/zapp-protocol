import { createHash } from "node:crypto";
import { base58Decode, bytesToHex } from "../protocol.ts";

export type BurnCommitmentInput = {
  solanaGenesisHash: string;
  signature: string;
  instructionLocator: string;
  mint: string;
};

function lengthPrefixed(value: string): Buffer {
  const body = Buffer.from(value, "utf8");
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(body.length);
  return Buffer.concat([prefix, body]);
}

export function deriveBurnId(input: BurnCommitmentInput): string {
  const bytes = Buffer.concat([
    lengthPrefixed("zapp:burn:v1"),
    lengthPrefixed(input.solanaGenesisHash),
    lengthPrefixed(input.signature),
    lengthPrefixed(input.instructionLocator),
    lengthPrefixed(input.mint),
  ]);
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256(bytes: Uint8Array): Buffer {
  return createHash("sha256").update(bytes).digest();
}

export function decodeBase58Check(address: string): Uint8Array {
  const raw = base58Decode(address);
  if (raw.length < 5) throw new Error("Invalid Base58Check address");
  const body = raw.slice(0, -4);
  const checksum = raw.slice(-4);
  const expected = sha256(sha256(body)).subarray(0, 4);
  if (bytesToHex(checksum) !== bytesToHex(expected)) throw new Error("Invalid Zcash address checksum");
  return body;
}

export function assertMainnetTransparentAddress(address: string): "p2pkh" | "p2sh" {
  const body = decodeBase58Check(address);
  if (body.length !== 22) throw new Error("ZApp v1 requires a legacy transparent Zcash address");
  if (body[0] === 0x1c && body[1] === 0xb8) return "p2pkh";
  if (body[0] === 0x1c && body[1] === 0xbd) return "p2sh";
  throw new Error("ZApp v1 requires a Zcash mainnet t1/t3 address");
}
