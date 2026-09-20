import { getClaim } from "../src/lib/server/db.ts";
import { assertMainnetTransparentAddress } from "../src/lib/server/crypto.ts";
import { broadcastTransfer } from "../src/lib/server/zcash.ts";

const burnId = process.argv[2];
const toOwner = process.argv[3];
if (!burnId || !toOwner) {
  throw new Error("usage: npm run transfer:proof -- <burn-id> <new-zcash-t-address>");
}
assertMainnetTransparentAddress(toOwner);

const claim = await getClaim(burnId);
if (!claim || claim.status !== "confirmed" || !claim.owner_txid || claim.owner_vout === null) {
  throw new Error("Canonical current owner outpoint is unavailable. Run the indexer first.");
}

const result = await broadcastTransfer({
  burnId,
  fromTxid: claim.owner_txid,
  fromVout: claim.owner_vout,
  toOwner,
});
console.log(result);
