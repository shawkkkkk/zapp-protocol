"use strict";
const { Buffer } = require("buffer");
const { blob, u8 } = require("@solana/buffer-layout");
const BigNumber = require("bignumber.js");
const { PublicKey } = require("@solana/web3.js");

function encodeDecode(layout) {
  return { decode: layout.decode.bind(layout), encode: layout.encode.bind(layout) };
}
function ensureLength(length) {
  if (!Number.isSafeInteger(length) || length <= 0) throw new RangeError("layout length must be a positive safe integer");
  return length;
}
function toUnsignedBigInt(value) {
  if (typeof value !== "bigint" || value < 0n) throw new RangeError("layout value must be an unsigned bigint");
  return value;
}
function decodeBigEndian(bytes) {
  const src = Buffer.from(bytes);
  return src.length ? BigInt("0x" + src.toString("hex")) : 0n;
}
function decodeLittleEndian(bytes) {
  const src = Buffer.from(bytes); src.reverse(); return decodeBigEndian(src);
}
function encodeBigEndian(value, length) {
  const n = toUnsignedBigInt(value);
  const bits = BigInt(ensureLength(length) * 8);
  if (n >= (1n << bits)) throw new RangeError("bigint does not fit layout width");
  return Buffer.from(n.toString(16).padStart(length * 2, "0"), "hex");
}
function encodeLittleEndian(value, length) {
  const src = encodeBigEndian(value, length); src.reverse(); return src;
}
const bigInt = (length) => (property) => {
  ensureLength(length);
  const layout = blob(length, property);
  const base = encodeDecode(layout);
  layout.decode = (buffer, offset = 0) => decodeLittleEndian(base.decode(buffer, offset));
  layout.encode = (value, buffer, offset = 0) => base.encode(encodeLittleEndian(value, length), buffer, offset);
  return layout;
};
const bigIntBE = (length) => (property) => {
  ensureLength(length);
  const layout = blob(length, property);
  const base = encodeDecode(layout);
  layout.decode = (buffer, offset = 0) => decodeBigEndian(base.decode(buffer, offset));
  layout.encode = (value, buffer, offset = 0) => base.encode(encodeBigEndian(value, length), buffer, offset);
  return layout;
};
const u64 = bigInt(8), u64be = bigIntBE(8), u128 = bigInt(16), u128be = bigIntBE(16);
const u192 = bigInt(24), u192be = bigIntBE(24), u256 = bigInt(32), u256be = bigIntBE(32);
const WAD = new BigNumber("1e+18");
const decimal = (property) => {
  const layout = u128(property), base = encodeDecode(layout);
  layout.decode = (buffer, offset = 0) => new BigNumber(base.decode(buffer, offset).toString()).div(WAD);
  layout.encode = (value, buffer, offset = 0) => base.encode(BigInt(new BigNumber(value).times(WAD).integerValue().toString()), buffer, offset);
  return layout;
};
const bool = (property) => {
  const layout = u8(property), base = encodeDecode(layout);
  layout.decode = (buffer, offset = 0) => Boolean(base.decode(buffer, offset));
  layout.encode = (value, buffer, offset = 0) => base.encode(value ? 1 : 0, buffer, offset);
  return layout;
};
const publicKey = (property) => {
  const layout = blob(32, property), base = encodeDecode(layout);
  layout.decode = (buffer, offset = 0) => new PublicKey(base.decode(buffer, offset));
  layout.encode = (value, buffer, offset = 0) => base.encode(value.toBuffer(), buffer, offset);
  return layout;
};
module.exports = { encodeDecode, bigInt, bigIntBE, u64, u64be, u128, u128be, u192, u192be, u256, u256be, WAD, decimal, bool, publicKey };
