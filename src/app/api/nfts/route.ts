import { NextRequest, NextResponse } from "next/server";
import { listNftMints } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "50", 10);
    const rows = await listNftMints(Number.isFinite(limit) ? limit : 50);
    return NextResponse.json({
      nfts: rows.map((row) => ({
        burnId: row.burn_id,
        mint: row.mint,
        amountBaseUnits: row.amount_base_units,
        recipient: row.recipient,
        currentOwner: row.current_owner,
        symbol: row.symbol,
        name: row.name,
        status: row.status,
        commitTxid: row.commit_txid,
        revealTxid: row.reveal_txid,
        inscriptionId: row.inscription_id,
        contentSha256: row.content_sha256,
        attempts: row.attempts,
        error: row.status === "failed" ? row.error : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to list NFT mints" },
      { status: 500 },
    );
  }
}
