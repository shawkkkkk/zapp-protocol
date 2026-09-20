import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRedeemScript,
  buildRevealScriptSig,
  inscriptionCommitment,
  inscriptionDescriptor,
  splitInscriptionContent,
  estimateRevealZip317FeeZats,
  parseInscriptionRevealScriptSig,
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


test("ZIP-317 reveal fee is derived from serialized transparent action sizes", () => {
  const content = new TextEncoder().encode(
    JSON.stringify({
      p: "zapp",
      op: "mint",
      v: 1,
      mint: "So11111111111111111111111111111111111111112",
      burn: "5".repeat(88),
      burnId: "cd".repeat(32),
      amt: "1000000",
      to: "t1P2GcxGhzeM5tPk3r3JsGh1tEVArD4C2fB",
    }),
  );
  const descriptor = inscriptionDescriptor({
    compressedPubkeyHex: PUBKEY,
    content,
  });
  const proofScriptHex = "6a4c4e" + "00".repeat(78);
  const fee = estimateRevealZip317FeeZats({
    content,
    redeemScriptHex: descriptor.redeemScriptHex,
    proofScriptHex,
  });

  assert.ok(fee >= 10_000n);
  assert.equal(fee % 5_000n, 0n);
  assert.ok(fee <= 60_000n);
});


test("reveal parser reconstructs canonical inscription content", () => {
  const content = new TextEncoder().encode(
    JSON.stringify({
      p: "zapp",
      op: "mint",
      v: 1,
      mint: "So11111111111111111111111111111111111111112",
      burn: "6".repeat(88),
      burnId: "ef".repeat(32),
      amt: "42",
      to: "t1P2GcxGhzeM5tPk3r3JsGh1tEVArD4C2fB",
    }),
  );
  const redeem = buildRedeemScript({ compressedPubkeyHex: PUBKEY, content });
  const signature = Uint8Array.from(new Array(72).fill(7));
  const scriptSig = buildRevealScriptSig({
    content,
    signatureWithHashType: signature,
    redeemScript: redeem,
  });

  const parsed = parseInscriptionRevealScriptSig(Buffer.from(scriptSig).toString("hex"));
  assert.ok(parsed);
  assert.equal(new TextDecoder().decode(parsed.content), new TextDecoder().decode(content));
  assert.equal(parsed.contentType, "application/json");
  assert.equal(parsed.compressedPubkeyHex, PUBKEY);
});

test("reveal parser rejects a tampered redeem commitment", () => {
  const content = new TextEncoder().encode('{"p":"zapp","op":"mint","v":1,"mint":"x","burn":"y","burnId":"z","amt":"1","to":"t"}');
  const redeem = buildRedeemScript({ compressedPubkeyHex: PUBKEY, content });
  const tampered = Uint8Array.from(redeem);
  tampered[tampered.length - 1] ^= 1;

  const scriptSig = buildRevealScriptSig({
    content,
    signatureWithHashType: Uint8Array.from(new Array(72).fill(3)),
    redeemScript: tampered,
  });
  assert.equal(
    parseInscriptionRevealScriptSig(Buffer.from(scriptSig).toString("hex")),
    null,
  );
});
