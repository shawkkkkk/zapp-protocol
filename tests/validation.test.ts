import test from "node:test";
import assert from "node:assert/strict";
import { validateProofAgainstBurn, type BurnEvidence } from "../src/lib/validation.ts";
import type { ZAppProof } from "../src/lib/protocol.ts";

const proof: ZAppProof = {
  version: 1,
  operation: "claim",
  mint: "So11111111111111111111111111111111111111112",
  burnId: "11".repeat(32),
  amount: 50_000n,
};

const burn: BurnEvidence = {
  burnId: proof.burnId,
  signature: "sig",
  instructionLocator: "message:0",
  slot: 1,
  mint: proof.mint,
  amount: proof.amount,
  recipient: "t1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yC",
  authority: "authority",
  finalized: true,
  successful: true,
};

test("accepts an exact finalized burn match", () => {
  assert.deepEqual(validateProofAgainstBurn(proof, burn, burn.recipient), { valid: true });
});

test("rejects a forged proof with no source burn", () => {
  assert.equal(validateProofAgainstBurn(proof, null).valid, false);
});

test("rejects the competitor-style 10x amount forgery", () => {
  const forged = { ...proof, amount: proof.amount * 10n };
  const result = validateProofAgainstBurn(forged, burn, burn.recipient);
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.code, "AMOUNT_MISMATCH");
});

test("rejects redirecting someone else's burn", () => {
  const result = validateProofAgainstBurn(proof, burn, "t1FakeDestination");
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.code, "RECIPIENT_MISMATCH");
});

test("rejects a mismatched mint", () => {
  const result = validateProofAgainstBurn({ ...proof, mint: "11111111111111111111111111111111" }, burn);
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.code, "MINT_MISMATCH");
});
