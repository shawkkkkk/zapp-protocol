import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  toBigIntLE,
  toBigIntBE,
  toBufferLE,
  toBufferBE,
} = require("../vendor/bigint-buffer/index.cjs") as {
  toBigIntLE(buf: Buffer | Uint8Array): bigint;
  toBigIntBE(buf: Buffer | Uint8Array): bigint;
  toBufferLE(num: bigint, width: number): Buffer;
  toBufferBE(num: bigint, width: number): Buffer;
};

test("bounds-safe bigint compatibility conversions roundtrip", () => {
  const n = 0x0102030405060708n;
  const be = toBufferBE(n, 8);
  const le = toBufferLE(n, 8);

  assert.equal(be.toString("hex"), "0102030405060708");
  assert.equal(le.toString("hex"), "0807060504030201");
  assert.equal(toBigIntBE(be), n);
  assert.equal(toBigIntLE(le), n);
});

test("bigint compatibility package rejects overflow and invalid widths", () => {
  assert.throws(() => toBufferBE(256n, 1), /does not fit/);
  assert.throws(() => toBufferLE(-1n, 8), /unsigned/);
  assert.throws(() => toBufferBE(1n, -1), /width/);
  assert.throws(() => toBufferBE(1n, Number.MAX_SAFE_INTEGER + 1), /width/);
});

test("bigint compatibility handles zero-width zero and empty buffers", () => {
  assert.equal(toBigIntBE(Buffer.alloc(0)), 0n);
  assert.equal(toBigIntLE(Buffer.alloc(0)), 0n);
  assert.equal(toBufferBE(0n, 0).length, 0);
  assert.equal(toBufferLE(0n, 0).length, 0);
  assert.throws(() => toBufferBE(1n, 0), /does not fit/);
});
