import test from "node:test";
import assert from "node:assert/strict";
import { assertMainnetTransparentAddress, deriveBurnId } from "../src/lib/server/crypto.ts";

test("accepts a checksummed Zcash mainnet t1 address", () => {
  assert.equal(assertMainnetTransparentAddress("t1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yC"), "p2pkh");
});

test("rejects a corrupted transparent address checksum", () => {
  assert.throws(() => assertMainnetTransparentAddress("t1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yD"));
});

test("burn commitment is domain separated and deterministic", () => {
  const input = {
    solanaGenesisHash: "genesis",
    signature: "signature",
    instructionLocator: "message:0",
    mint: "So11111111111111111111111111111111111111112",
  };
  const first = deriveBurnId(input);
  const second = deriveBurnId(input);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, deriveBurnId({ ...input, instructionLocator: "message:1" }));
});
