import { NextRequest, NextResponse } from "next/server";
import { mutationAllowed } from "@/lib/server/mutation-access";
import { getClaim, listClaims } from "@/lib/server/db";
import { processBurnSignature } from "@/lib/server/claim-service";
import { enforceRateLimit, RateLimitError, rateLimitResponse } from "@/lib/server/rate-limit";

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
    if (!mutationAllowed(request)) {
      return NextResponse.json(
        { error: "ZApp public launch is not enabled yet" },
        { status: 503 },
      );
    }
    if (process.env.ZAPP_NFT_MINT_ENABLED === "false") {
      return NextResponse.json(
        {
          error:
            "ZApp NFT minting is temporarily paused. Existing finalized burns can be recovered after service resumes.",
        },
        { status: 503 },
      );
    }

    const body = (await request.json()) as { solanaSignature?: string };
    const signature = body.solanaSignature?.trim();
    if (!signature) return NextResponse.json({ error: "solanaSignature is required" }, { status: 400 });

    await enforceRateLimit(request, {
      namespace: "claim-submit-ip",
      limit: 120,
      windowSeconds: 3600,
    });

    const processed = await processBurnSignature(signature);

    if (process.env.ZAPP_NFT_MINT_ENABLED === "false") {
      return NextResponse.json(
        {
          error: "NFT mint worker is disabled",
          claim: publicClaim(processed.claim),
          nft: processed.nft,
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        claim: publicClaim(processed.claim),
        nft: processed.nft,
        proof: {
          burnId: processed.evidence.burnId,
          mint: processed.evidence.mint,
          amountBaseUnits: processed.evidence.amount.toString(),
          recipient: processed.evidence.recipient,
          payloadHex: processed.payloadHex,
        },
      },
      {
        status:
          processed.claim?.status === "broadcast" ||
          processed.claim?.status === "confirmed"
            ? 200
            : 202,
      },
    );
  } catch (error) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Claim failed" },
      { status: 400 },
    );
  }
}
