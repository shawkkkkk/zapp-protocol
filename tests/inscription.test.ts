import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRedeemScript,
  buildRevealScriptSig,
  inscriptionCommitment,
  inscriptionDescriptor,
  splitInscriptionContent,
} from "../src/lib/inscription.ts";

const PUBKEY = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

test("ZApp NFT content fits a single Zerdinals reveal", () => {
  const content = new TextEncoder().encode(
    JSON.stringify({
      p: "zapp",
      op: "mint",
      v: 1,
      mint: "EKtmPPLaCbEEKiwoHHtV7TsRsmPXs5CMGtQtZFSiinsc",
      burn: "4hCLg38ijA3tiTVwUFbE4ktZBvEPLPLmRHzTMLEx3MeCEMNCDWNTHi4wwYTawAwua2T7jfpvpforJgyd2zyCxDBK",
      burnId: "ab".repeat(32),
      amt: "1000000",
      to: "t1P2GcxGhzeM5tPk3r3JsGh1tEVArD4C2fB",
    }),
  );
  const pieces = splitInscriptionContent(content);
  assert.ok(pieces.length >= 1 && pieces.length <= 4);

  const descriptor = inscriptionDescriptor({ compressedPubkeyHex: PUBKEY, content });
  assert.equal(descriptor.pieces, pieces.length);
  assert.match(descriptor.commitAddress, /^t3/);
  assert.match(descriptor.commitmentHex, /^[0-9a-f]{64}$/);

  const redeem = buildRedeemScript({ compressedPubkeyHex: PUBKEY, content });
  const signature = Uint8Array.from(new Array(72).fill(1));
  const scriptSig = buildRevealScriptSig({
    content,
    signatureWithHashType: signature,
    redeemScript: redeem,
  });
  assert.ok(scriptSig.length < 1650);
  assert.equal(scriptSig[0], 3);
  assert.equal(new TextDecoder().decode(scriptSig.slice(1, 4)), "ord");
});

test("content commitment changes with content", () => {
  const a = inscriptionCommitment(new TextEncoder().encode("a"));
  const b = inscriptionCommitment(new TextEncoder().encode("b"));
  assert.notDeepEqual(a, b);
});
