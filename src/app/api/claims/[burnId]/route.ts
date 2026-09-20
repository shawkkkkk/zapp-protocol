import { NextResponse } from "next/server";
import { getClaim, getNftMint } from "@/lib/server/db";

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

    const nft = await getNftMint(burnId.toLowerCase());

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
        currentOwner: row.current_owner,
        ownerTxid: row.owner_txid,
        ownerVout: row.owner_vout,
        status: row.status,
        ownershipState: row.ownership_state,
        createdAt: row.created_at,
      },
      nft: nft ? {
        status: nft.status,
        commitTxid: nft.commit_txid,
        revealTxid: nft.reveal_txid,
        inscriptionId: nft.inscription_id,
        contentSha256: nft.content_sha256,
        error: nft.status === "failed" ? nft.error : null,
      } : null,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load proof" }, { status: 500 });
  }
}
