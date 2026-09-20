import test from "node:test";
import assert from "node:assert/strict";
import { encodeNftContent, nftContentCommitment, nftContentForBurn, parseNftContent } from "../src/lib/nft.ts";

const burn = {
  burnId: "ab".repeat(32),
  signature: "4hCLg38ijA3tiTVwUFbE4ktZBvEPLPLmRHzTMLEx3MeCEMNCDWNTHi4wwYTawAwua2T7jfpvpforJgyd2zyCxDBK",
  instructionLocator: "message:0",
  slot: 123,
  mint: "EKtmPPLaCbEEKiwoHHtV7TsRsmPXs5CMGtQtZFSiinsc",
  amount: 1_000_000n,
  recipient: "t1P2GcxGhzeM5tPk3r3JsGh1tEVArD4C2fB",
  authority: "owner",
  finalized: true,
  successful: true,
};

test("ZApp NFT content is canonical and round-trips", () => {
  const content = nftContentForBurn(burn);
  const encoded = encodeNftContent(content);
  assert.deepEqual(parseNftContent(encoded), content);
  assert.match(nftContentCommitment(encoded), /^[0-9a-f]{64}$/);
});

test("non-canonical JSON does not become a ZApp NFT", () => {
  const content = nftContentForBurn(burn);
  const pretty = new TextEncoder().encode(JSON.stringify(content, null, 2));
  assert.equal(parseNftContent(pretty), null);
});
