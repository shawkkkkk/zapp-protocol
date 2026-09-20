import test from "node:test";
import assert from "node:assert/strict";
import {
  findClaimPayloads,
  replaceZeroValueOutputScript,
} from "../src/lib/server/zcash.ts";
import {
  bytesToHex,
  encodeClaimPayload,
  encodeOpReturnScript,
} from "../src/lib/protocol.ts";

const MINT = "So11111111111111111111111111111111111111112";

test("carrier mutation changes only the unique zero-value placeholder output", () => {
  const oldScript = "a914" + "11".repeat(20) + "87";
  const newScript = bytesToHex(
    encodeOpReturnScript(
      encodeClaimPayload({
        mint: MINT,
        burnId: "22".repeat(32),
        amount: 123n,
      }),
    ),
  );
  const prefix = "0400008085202f89";
  const suffix = "00000000";
  const placeholder = "0000000000000000" + "17" + oldScript;
  const raw = prefix + placeholder + suffix;

  const mutated = replaceZeroValueOutputScript(raw, oldScript, newScript);
  assert.ok(mutated.startsWith(prefix));
  assert.ok(mutated.endsWith(suffix));
  assert.ok(mutated.includes("0000000000000000" + "51" + newScript));
  assert.ok(!mutated.includes(oldScript));
});

test("carrier mutation refuses ambiguous placeholders", () => {
  const oldScript = "a914" + "33".repeat(20) + "87";
  const placeholder = "0000000000000000" + "17" + oldScript;
  assert.throws(
    () => replaceZeroValueOutputScript(placeholder + placeholder, oldScript, "6a00"),
    /not unique/,
  );
});

test("claim scanner ignores unrelated OP_RETURN data", () => {
  const proofPayload = encodeClaimPayload({
    mint: MINT,
    burnId: "44".repeat(32),
    amount: 1n,
  });
  const proofScript = bytesToHex(encodeOpReturnScript(proofPayload));
  const unrelated = "6a026869";
  const found = findClaimPayloads({
    txid: "00".repeat(32),
    vin: [],
    vout: [
      { n: 0, valueZat: 0, scriptPubKey: { hex: unrelated } },
      { n: 1, valueZat: 0, scriptPubKey: { hex: proofScript } },
    ],
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].vout, 1);
});
