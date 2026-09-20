import test from "node:test";
import assert from "node:assert/strict";
import {
  CLAIM_PAYLOAD_BYTES,
  base58Decode,
  base58Encode,
  buildZAppMemo,
  decodeClaimPayload,
  decodeOpReturnScript,
  encodeClaimPayload,
  encodeOpReturnScript,
  formatBaseUnits,
  parseUiAmount,
  parseZAppMemo,
} from "../src/lib/protocol.ts";

const MINT = "So11111111111111111111111111111111111111112";
const BURN_ID = "ab".repeat(32);

test("base58 round-trips a 32-byte Solana mint", () => {
  const decoded = base58Decode(MINT);
  assert.equal(decoded.length, 32);
  assert.equal(base58Encode(decoded), MINT);
});

test("claim codec is exact and round-trips uint64 amounts", () => {
  const amount = (1n << 64n) - 1n;
  const payload = encodeClaimPayload({ mint: MINT, burnId: BURN_ID, amount });
  assert.equal(payload.length, CLAIM_PAYLOAD_BYTES);
  assert.deepEqual(decodeClaimPayload(payload), {
    version: 1,
    operation: "claim",
    mint: MINT,
    burnId: BURN_ID,
    amount,
  });
});

test("78-byte proof fits the standard data budget using PUSHDATA1", () => {
  const payload = encodeClaimPayload({ mint: MINT, burnId: BURN_ID, amount: 1n });
  const script = encodeOpReturnScript(payload);
  assert.equal(payload.length, 78);
  assert.equal(script.length, 81);
  assert.equal(script[0], 0x6a);
  assert.equal(script[1], 0x4c);
  assert.equal(script[2], 78);
  assert.deepEqual(decodeOpReturnScript(Buffer.from(script).toString("hex")), payload);
});

test("amount parsing never passes through unsafe JavaScript number precision", () => {
  const amount = parseUiAmount("9007199254.740993", 6);
  assert.equal(amount, 9007199254740993n);
  assert.equal(formatBaseUnits(amount, 6), "9007199254.740993");
});

test("memo commits the Zcash destination", () => {
  const address = "t1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yC";
  const memo = buildZAppMemo(address);
  assert.equal(parseZAppMemo(memo), address);
  assert.equal(parseZAppMemo("hello"), null);
});
