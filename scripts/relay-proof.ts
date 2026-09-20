import { verifyBurnRaw } from "../src/lib/server/solana-raw.ts";
import { broadcastProof } from "../src/lib/server/zcash.ts";

const signature = process.argv[2];
if (!signature) throw new Error("usage: npm run relay:proof -- <solana-signature>");

const evidence = await verifyBurnRaw(signature);
console.log("verified finalized Solana burn");
console.log({
  mint: evidence.mint,
  amountBaseUnits: evidence.amount.toString(),
  recipient: evidence.recipient,
  burnId: evidence.burnId,
});

const result = await broadcastProof(evidence);
console.log("broadcast Zcash Proof");
console.log(result);
