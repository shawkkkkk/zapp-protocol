import test from "node:test";
import assert from "node:assert/strict";
import { assertMintCreationEvidence } from "../src/lib/server/assets.ts";

const CREATOR = "11111111111111111111111111111111";
const MINT = "So11111111111111111111111111111111111111112";
const OTHER = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

test("ordinary mint signer proves creation", () => {
  assert.doesNotThrow(() =>
    assertMintCreationEvidence({
      creator: CREATOR,
      mint: MINT,
      accountKeys: [CREATOR, MINT, OTHER],
      signerCount: 2,
      preBalances: [100, 0, 0],
      postBalances: [90, 123, 0],
    }),
  );
});

test("program-created mint proves zero-to-funded creation", () => {
  assert.doesNotThrow(() =>
    assertMintCreationEvidence({
      creator: CREATOR,
      mint: MINT,
      accountKeys: [CREATOR, OTHER, MINT],
      signerCount: 1,
      preBalances: [100, 0, 0],
      postBalances: [80, 0, 2039280],
    }),
  );
});

test("pre-existing unsigned mint cannot be smuggled through registration", () => {
  assert.throws(() =>
    assertMintCreationEvidence({
      creator: CREATOR,
      mint: MINT,
      accountKeys: [CREATOR, OTHER, MINT],
      signerCount: 1,
      preBalances: [100, 0, 2039280],
      postBalances: [90, 0, 2039280],
    }),
  );
});

test("creator must remain the transaction fee payer", () => {
  assert.throws(() =>
    assertMintCreationEvidence({
      creator: CREATOR,
      mint: MINT,
      accountKeys: [OTHER, MINT, CREATOR],
      signerCount: 2,
      preBalances: [100, 0, 0],
      postBalances: [90, 1, 0],
    }),
  );
});
