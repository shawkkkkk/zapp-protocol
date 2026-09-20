import { createHash } from "node:crypto";
import { base58Encode, bytesToHex, hexToBytes } from "./protocol.ts";

export const INSCRIPTION_CONTENT_TYPE = "application/json";
export const INSCRIPTION_MAX_PIECE_BYTES = 240;
export const INSCRIPTION_MAX_PIECES_PER_REVEAL = 4;
export const ZCASH_MAINNET_P2SH_PREFIX = Uint8Array.from([0x1c, 0xbd]);

function sha256(bytes: Uint8Array): Buffer {
  return createHash("sha256").update(bytes).digest();
}

function hash160(bytes: Uint8Array): Buffer {
  return createHash("ripemd160").update(sha256(bytes)).digest();
}

function pushData(data: Uint8Array): Uint8Array {
  if (data.length <= 75) return Uint8Array.from([data.length, ...data]);
  if (data.length <= 255) return Uint8Array.from([0x4c, data.length, ...data]);
  throw new Error("ZApp inscription push exceeds 255 bytes");
}

function pushNum(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error("Invalid inscription script number");
  if (n === 0) return Uint8Array.from([0x00]);
  if (n >= 1 && n <= 16) return Uint8Array.from([0x50 + n]);
  return Uint8Array.from([0x01, n]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}

function base58Check(payload: Uint8Array): string {
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return base58Encode(concat(payload, checksum));
}

export function inscriptionCommitment(
  content: Uint8Array,
  contentType = INSCRIPTION_CONTENT_TYPE,
): Uint8Array {
  const domain = new TextEncoder().encode("UZRD1");
  const type = new TextEncoder().encode(contentType);
  return sha256(concat(domain, type, Uint8Array.from([0]), content));
}

export function splitInscriptionContent(content: Uint8Array): Uint8Array[] {
  if (content.length === 0) throw new Error("Inscription content cannot be empty");
  const pieces: Uint8Array[] = [];
  for (let offset = 0; offset < content.length; offset += INSCRIPTION_MAX_PIECE_BYTES) {
    pieces.push(content.slice(offset, offset + INSCRIPTION_MAX_PIECE_BYTES));
  }
  if (pieces.length > INSCRIPTION_MAX_PIECES_PER_REVEAL) {
    throw new Error("ZApp v1 NFT receipt exceeds the single-reveal inscription limit");
  }
  return pieces;
}

export function buildRedeemScript(input: {
  compressedPubkeyHex: string;
  content: Uint8Array;
  contentType?: string;
}): Uint8Array {
  const pubkey = hexToBytes(input.compressedPubkeyHex, 33);
  const contentType = input.contentType || INSCRIPTION_CONTENT_TYPE;
  const pieces = splitInscriptionContent(input.content);
  const commitment = inscriptionCommitment(input.content, contentType);

  // <33 pubkey> CHECKSIGVERIFY <32 commitment> DROP
  // then one DROP for every non-signature stack item left by the ord envelope, then TRUE.
  const drops = 3 + 2 * pieces.length;
  return concat(
    pushData(pubkey),
    Uint8Array.from([0xad]),
    pushData(commitment),
    Uint8Array.from([0x75]),
    Uint8Array.from(new Array(drops).fill(0x75)),
    Uint8Array.from([0x51]),
  );
}

export function p2shAddressForRedeemScript(redeemScript: Uint8Array): string {
  const scriptHash = hash160(redeemScript);
  return base58Check(concat(ZCASH_MAINNET_P2SH_PREFIX, scriptHash));
}

export function buildRevealScriptSig(input: {
  content: Uint8Array;
  signatureWithHashType: Uint8Array;
  redeemScript: Uint8Array;
  contentType?: string;
}): Uint8Array {
  const contentType = input.contentType || INSCRIPTION_CONTENT_TYPE;
  const typeBytes = new TextEncoder().encode(contentType);
  if (typeBytes.length < 3 || typeBytes.length > 96 || !contentType.includes("/")) {
    throw new Error("Invalid inscription content type");
  }

  const pieces = splitInscriptionContent(input.content);
  const parts: Uint8Array[] = [
    pushData(new TextEncoder().encode("ord")),
    pushNum(pieces.length),
    pushData(typeBytes),
  ];

  for (let i = 0; i < pieces.length; i += 1) {
    const pieceIndex = pieces.length - 1 - i;
    parts.push(pushNum(pieceIndex), pushData(pieces[i]));
  }

  parts.push(pushData(input.signatureWithHashType), pushData(input.redeemScript));
  const scriptSig = concat(...parts);
  if (scriptSig.length > 1650) throw new Error("Inscription scriptSig exceeds standard relay policy");
  return scriptSig;
}

export function inscriptionDescriptor(input: {
  compressedPubkeyHex: string;
  content: Uint8Array;
}): {
  commitmentHex: string;
  redeemScriptHex: string;
  commitAddress: string;
  pieces: number;
} {
  const redeem = buildRedeemScript(input);
  return {
    commitmentHex: bytesToHex(inscriptionCommitment(input.content)),
    redeemScriptHex: bytesToHex(redeem),
    commitAddress: p2shAddressForRedeemScript(redeem),
    pieces: splitInscriptionContent(input.content).length,
  };
}
