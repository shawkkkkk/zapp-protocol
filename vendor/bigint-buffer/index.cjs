"use strict";

const { Buffer } = require("buffer");

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("Expected a Buffer or Uint8Array");
}

function widthBytes(width) {
  if (!Number.isSafeInteger(width) || width < 0) {
    throw new RangeError("width must be a non-negative safe integer");
  }
  return width;
}

function asUnsignedBigInt(value) {
  if (typeof value !== "bigint") throw new TypeError("Expected a bigint");
  if (value < 0n) throw new RangeError("Only unsigned bigint values are supported");
  return value;
}

function toBigIntBE(input) {
  const buf = asBuffer(input);
  if (buf.length === 0) return 0n;
  const hex = buf.toString("hex");
  return BigInt("0x" + hex);
}

function toBigIntLE(input) {
  const buf = Buffer.from(asBuffer(input));
  buf.reverse();
  return toBigIntBE(buf);
}

function toBufferBE(value, width) {
  const num = asUnsignedBigInt(value);
  const size = widthBytes(width);
  if (size === 0) {
    if (num !== 0n) throw new RangeError("bigint does not fit requested width");
    return Buffer.alloc(0);
  }

  const limit = 1n << BigInt(size * 8);
  if (num >= limit) throw new RangeError("bigint does not fit requested width");

  const hex = num.toString(16).padStart(size * 2, "0");
  return Buffer.from(hex, "hex");
}

function toBufferLE(value, width) {
  const buf = toBufferBE(value, width);
  buf.reverse();
  return buf;
}

module.exports = {
  toBigIntLE,
  toBigIntBE,
  toBufferLE,
  toBufferBE,
};
