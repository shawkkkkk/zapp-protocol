import { NextRequest, NextResponse } from "next/server";
import { encodeClaimPayload, bytesToHex } from "@/lib/protocol";
import { verifyBurnTransaction } from "@/lib/server/solana";
import {
  acquireClaimRelay,
  getClaim,
  listClaims,
  markClaimBroadcast,
  markClaimFailed,
  reserveClaim,
} from "@/lib/server/db";
import { broadcastProof } from "@/lib/server/zcash";

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
  let burnId: string | null = null;
  let acquiredRelay = false;
  try {
    const body = (await request.json()) as { solanaSignature?: string };
    const signature = body.solanaSignature?.trim();
    if (!signature) return NextResponse.json({ error: "solanaSignature is required" }, { status: 400 });

    const evidence = await verifyBurnTransaction(signature, undefined, { requireRelayFee: true });
    burnId = evidence.burnId;

    const payloadHex = bytesToHex(
      encodeClaimPayload({ mint: evidence.mint, burnId: evidence.burnId, amount: evidence.amount }),
    );
    const reserved = await reserveClaim(evidence, payloadHex);

    if (reserved.status === "confirmed" || reserved.status === "broadcast") {
      return NextResponse.json({ claim: publicClaim(reserved), reused: true });
    }

    if (process.env.ZAPP_RELAY_ENABLED === "false") {
      return NextResponse.json(
        {
          error: "Sponsored Zcash relay is disabled",
          proof: {
            burnId: evidence.burnId,
            mint: evidence.mint,
            amountBaseUnits: evidence.amount.toString(),
            recipient: evidence.recipient,
            payloadHex,
          },
        },
        { status: 503 },
      );
    }

    acquiredRelay = await acquireClaimRelay(evidence.burnId);
    if (!acquiredRelay) {
      return NextResponse.json(
        { claim: publicClaim(await getClaim(evidence.burnId)), reused: true, processing: true },
        { status: 202 },
      );
    }

    const broadcast = await broadcastProof(evidence);
    await markClaimBroadcast({
      burnId: evidence.burnId,
      txid: broadcast.txid,
      recipientVout: broadcast.recipientVout,
      carrierVout: broadcast.carrierVout,
    });

    return NextResponse.json({
      claim: publicClaim(await getClaim(evidence.burnId)),
      proof: {
        burnId: evidence.burnId,
        mint: evidence.mint,
        amountBaseUnits: evidence.amount.toString(),
        recipient: evidence.recipient,
        payloadHex: broadcast.payloadHex,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Claim failed";
    if (burnId && acquiredRelay) {
      try {
        await markClaimFailed(burnId, message);
      } catch {
        // Preserve the original protocol/RPC error.
      }
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
