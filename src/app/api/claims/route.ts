import { NextRequest, NextResponse } from "next/server";
import { bytesToHex, encodeClaimPayload } from "@/lib/protocol";
import { verifyBurnTransaction } from "@/lib/server/solana";
import { verifyBurnRaw } from "@/lib/server/solana-raw";
import {
  getAsset,
  getClaim,
  getNftMint,
  listClaims,
  queueNftMint,
  reserveClaim,
} from "@/lib/server/db";
import { encodeNftContent, nftContentCommitment, nftContentForBurn } from "@/lib/nft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicClaim(row: Awaited<ReturnType<typeof getClaim>>) {
  if (!row) return null;
  return {
    burnId: row.burn_id,
    solanaSignature: row.solana_signature,
    mint: row.mint,
    amountBaseUnits: row.amount_base_units,
    recipient: row.recipient,
    currentOwner: row.current_owner,
    ownerOutpoint: row.owner_txid && row.owner_vout !== null ? row.owner_txid + ":" + row.owner_vout : null,
    zcashTxid: row.zcash_txid,
    zcashHeight: row.zcash_height,
    status: row.status,
    error: row.status === "failed" ? row.error : null,
    createdAt: row.created_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "50", 10);
    const rows = await listClaims(Number.isFinite(limit) ? limit : 50);
    return NextResponse.json({ claims: rows.map((row) => publicClaim(row)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to list proofs" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (process.env.ZAPP_PUBLIC_LAUNCH_ENABLED !== "true") {
      return NextResponse.json({ error: "ZApp public launch is not enabled yet" }, { status: 503 });
    }
    const body = (await request.json()) as { solanaSignature?: string };
    const signature = body.solanaSignature?.trim();
    if (!signature) return NextResponse.json({ error: "solanaSignature is required" }, { status: 400 });

    const evidence = await verifyBurnRaw(signature);

    if (BigInt(process.env.ZAPP_FEE_LAMPORTS || "0") > 0n) {
      const feeEvidence = await verifyBurnTransaction(signature, undefined, { requireRelayFee: true });
      if (
        feeEvidence.burnId !== evidence.burnId ||
        feeEvidence.mint !== evidence.mint ||
        feeEvidence.amount !== evidence.amount ||
        feeEvidence.recipient !== evidence.recipient
      ) {
        throw new Error("Relay-fee parser disagrees with the canonical raw burn verifier");
      }
    }

    if (process.env.ZAPP_REQUIRE_REGISTERED_ASSET !== "false") {
      const asset = await getAsset(evidence.mint);
      if (!asset) throw new Error("This mint is not a public ZApp launch");
    }

    const payloadHex = bytesToHex(
      encodeClaimPayload({ mint: evidence.mint, burnId: evidence.burnId, amount: evidence.amount }),
    );
    const claim = await reserveClaim(evidence, payloadHex);

    const contentBytes = encodeNftContent(nftContentForBurn(evidence));
    const nft = await queueNftMint({
      burnId: evidence.burnId,
      contentJson: new TextDecoder().decode(contentBytes),
      contentSha256: nftContentCommitment(contentBytes),
    });

    if (process.env.ZAPP_NFT_MINT_ENABLED === "false") {
      return NextResponse.json(
        {
          error: "NFT mint worker is disabled",
          claim: publicClaim(claim),
          nft,
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        claim: publicClaim(await getClaim(evidence.burnId)),
        nft: await getNftMint(evidence.burnId),
        proof: {
          burnId: evidence.burnId,
          mint: evidence.mint,
          amountBaseUnits: evidence.amount.toString(),
          recipient: evidence.recipient,
          payloadHex,
        },
      },
      { status: claim.status === "broadcast" || claim.status === "confirmed" ? 200 : 202 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Claim failed" },
      { status: 400 },
    );
  }
}
