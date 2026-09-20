import test from "node:test";
import assert from "node:assert/strict";
import { rawVerifierFingerprint } from "../src/lib/server/solana-raw.ts";

test("raw verifier publishes a stable implementation fingerprint", () => {
  const fp = rawVerifierFingerprint();
  assert.match(fp, /^[0-9a-f]{64}$/);
});
