import { bytesToHex, encodeClaimPayload } from "../protocol.ts";
import {
  encodeNftContent,
  nftContentCommitment,
  nftContentForBurn,
} from "../nft.ts";
import { verifyBurnTransaction } from "./solana.ts";
import { verifyBurnRaw } from "./solana-raw.ts";
import {
  getAsset,
  getClaim,
  getNftMint,
  queueNftMint,
  reserveClaim,
} from "./db.ts";

export async function processBurnSignature(signature: string) {
  const evidence = await verifyBurnRaw(signature);

  if (BigInt(process.env.ZAPP_FEE_LAMPORTS || "0") > 0n) {
    const feeEvidence = await verifyBurnTransaction(signature, undefined, {
      requireRelayFee: true,
    });
    if (
      feeEvidence.burnId !== evidence.burnId ||
      feeEvidence.mint !== evidence.mint ||
      feeEvidence.amount !== evidence.amount ||
      feeEvidence.recipient !== evidence.recipient
    ) {
      throw new Error(
        "Relay-fee parser disagrees with the canonical raw burn verifier",
      );
    }
  }

  if (process.env.ZAPP_REQUIRE_REGISTERED_ASSET !== "false") {
    const asset = await getAsset(evidence.mint);
    if (!asset) throw new Error("This mint is not a public ZApp launch");
    if (evidence.amount < BigInt(asset.min_burn_base_units)) {
      throw new Error(
        "Burn is below this launch's minimum of " +
          asset.min_burn_base_units +
          " base units",
      );
    }
  }

  const payloadHex = bytesToHex(
    encodeClaimPayload({
      mint: evidence.mint,
      burnId: evidence.burnId,
      amount: evidence.amount,
    }),
  );
  const claim = await reserveClaim(evidence, payloadHex);

  const contentBytes = encodeNftContent(nftContentForBurn(evidence));
  await queueNftMint({
    burnId: evidence.burnId,
    contentJson: new TextDecoder().decode(contentBytes),
    contentSha256: nftContentCommitment(contentBytes),
  });

  return {
    evidence,
    claim: await getClaim(evidence.burnId),
    nft: await getNftMint(evidence.burnId),
    payloadHex,
  };
}
