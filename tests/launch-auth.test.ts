import test from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { base58Encode, bytesToHex } from "../src/lib/protocol.ts";
import { buildLaunchMessage } from "../src/lib/launch.ts";
import { verifyLaunchAuthorization } from "../src/lib/server/assets.ts";

test("launch metadata requires the creator wallet signature", () => {
  const keypair = nacl.sign.keyPair();
  const creator = base58Encode(keypair.publicKey);
  const input = {
    mint: "So11111111111111111111111111111111111111112",
    creationSignature: "4".repeat(88),
    name: "Zebra",
    symbol: "ZEBRA",
    imageUrl: "https://example.com/zebra.png",
    description: "test launch",
  };
  const message = new TextEncoder().encode(buildLaunchMessage(input));
  const signature = nacl.sign.detached(message, keypair.secretKey);

  assert.doesNotThrow(() =>
    verifyLaunchAuthorization({
      ...input,
      creator,
      registrationSignature: bytesToHex(signature),
    }),
  );

  assert.throws(() =>
    verifyLaunchAuthorization({
      ...input,
      name: "Hijacked",
      creator,
      registrationSignature: bytesToHex(signature),
    }),
  );
});
