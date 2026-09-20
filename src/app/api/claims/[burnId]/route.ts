import { NextResponse } from "next/server";
import { getClaim } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ burnId: string }> },
) {
  try {
    const { burnId } = await context.params;
    if (!/^[0-9a-f]{64}$/i.test(burnId)) {
      return NextResponse.json({ error: "Invalid burn id" }, { status: 400 });
    }
    const row = await getClaim(burnId.toLowerCase());
    if (!row) return NextResponse.json({ error: "Proof not found" }, { status: 404 });

    return NextResponse.json({
      claim: {
        burnId: row.burn_id,
        solanaSignature: row.solana_signature,
        instructionLocator: row.instruction_locator,
        solanaSlot: row.solana_slot,
        mint: row.mint,
        amountBaseUnits: row.amount_base_units,
        recipient: row.recipient,
        payloadHex: row.payload_hex,
        zcashTxid: row.zcash_txid,
        zcashHeight: row.zcash_height,
        zcashTxIndex: row.zcash_tx_index,
        recipientVout: row.recipient_vout,
        carrierVout: row.carrier_vout,
        status: row.status,
        createdAt: row.created_at,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load proof" }, { status: 500 });
  }
}
