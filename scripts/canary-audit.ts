import { getClaim, getNftMint } from "../src/lib/server/db.ts";
import { getZcashTransaction } from "../src/lib/server/zcash.ts";

const burnId = (process.env.ZAPP_CANARY_BURN_ID || process.argv[2] || "").trim();
if (!/^[0-9a-f]{64}$/i.test(burnId)) {
  throw new Error(
    "Provide the 64-hex canary burnId as ZAPP_CANARY_BURN_ID or the first argument",
  );
}

const claim = await getClaim(burnId);
if (!claim) throw new Error("Canary claim row does not exist");
if (claim.status !== "confirmed") {
  throw new Error("Canary claim is not independently confirmed: " + claim.status);
}
if (!claim.zcash_txid) throw new Error("Canary claim has no Zcash transaction id");
if (claim.recipient_vout !== 0) {
  throw new Error("Canary inscription carrying output is not vout 0");
}

const nft = await getNftMint(burnId);
if (!nft) throw new Error("Canary NFT row does not exist");
if (nft.status !== "confirmed") {
  throw new Error("Canary NFT worker status is not confirmed: " + nft.status);
}
if (!nft.reveal_txid || nft.reveal_txid !== claim.zcash_txid) {
  throw new Error("Canary worker reveal tx does not match canonical indexed claim");
}
if (!nft.indexer_verified_at || !nft.indexer_verified_height) {
  throw new Error("Canary NFT has not been independently verified by the Zcash indexer");
}
if (nft.inscription_id !== nft.reveal_txid + "i0") {
  throw new Error("Canary inscription id is inconsistent with reveal transaction");
}

const tx = await getZcashTransaction(nft.reveal_txid);
if (tx.txid !== nft.reveal_txid) {
  throw new Error("Zcash RPC returned a different canary reveal transaction");
}

console.log("PASS  burn-id          " + burnId);
console.log("PASS  solana-burn      " + claim.solana_signature);
console.log("PASS  zcash-reveal     " + nft.reveal_txid);
console.log("PASS  inscription      " + nft.inscription_id);
console.log("PASS  indexer-height   " + nft.indexer_verified_height);
console.log("PASS  current-owner    " + (claim.current_owner || "terminal"));
console.log("READY  mainnet canary is worker-confirmed and independently indexer-verified.");
