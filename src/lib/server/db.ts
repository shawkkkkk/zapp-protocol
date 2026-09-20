import pg from "pg";
import type { BurnEvidence } from "../validation.ts";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function database(): pg.Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; ZApp will not use ephemeral claim state");
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export type ClaimRow = {
  burn_id: string;
  solana_signature: string;
  instruction_locator: string;
  solana_slot: string;
  mint: string;
  amount_base_units: string;
  recipient: string;
  payload_hex: string;
  zcash_txid: string | null;
  zcash_height: string | null;
  zcash_tx_index: number | null;
  recipient_vout: number | null;
  carrier_vout: number | null;
  current_owner: string | null;
  owner_txid: string | null;
  owner_vout: number | null;
  status: "reserved" | "relaying" | "broadcast" | "confirmed" | "failed" | "invalidated";
  error: string | null;
  created_at: string;
  updated_at: string;
};

export async function reserveClaim(evidence: BurnEvidence, payloadHex: string): Promise<ClaimRow> {
  const db = database();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO claims (
        burn_id, solana_signature, instruction_locator, solana_slot, mint,
        amount_base_units, recipient, payload_hex, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'reserved')
      ON CONFLICT (burn_id) DO NOTHING`,
      [
        evidence.burnId,
        evidence.signature,
        evidence.instructionLocator,
        evidence.slot,
        evidence.mint,
        evidence.amount.toString(),
        evidence.recipient,
        payloadHex,
      ],
    );
    const selected = await client.query<ClaimRow>("SELECT * FROM claims WHERE burn_id = $1 FOR UPDATE", [evidence.burnId]);
    const row = selected.rows[0];
    if (!row) throw new Error("Failed to reserve burn");

    const sameEvidence =
      row.solana_signature === evidence.signature &&
      row.mint === evidence.mint &&
      row.amount_base_units === evidence.amount.toString() &&
      row.recipient === evidence.recipient;

    if (!sameEvidence) throw new Error("Burn commitment is already associated with different evidence");

    if (row.status === "failed" || row.status === "invalidated") {
      const retried = await client.query<ClaimRow>(
        "UPDATE claims SET status='reserved', error=NULL, updated_at=NOW() WHERE burn_id=$1 RETURNING *",
        [evidence.burnId],
      );
      await client.query("COMMIT");
      return retried.rows[0];
    }

    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


export async function acquireClaimRelay(burnId: string): Promise<boolean> {
  const result = await database().query(
    `UPDATE claims
     SET status='relaying', error=NULL, updated_at=NOW()
     WHERE burn_id=$1
       AND (
         status='reserved'
         OR (status='relaying' AND updated_at < NOW() - INTERVAL '5 minutes')
       )
     RETURNING burn_id`,
    [burnId],
  );
  return result.rowCount === 1;
}

export async function markClaimBroadcast(input: {
  burnId: string;
  txid: string;
  recipientVout: number;
  carrierVout: number;
}): Promise<void> {
  await database().query(
    `UPDATE claims
     SET status='broadcast', zcash_txid=$2, recipient_vout=$3, carrier_vout=$4, error=NULL, updated_at=NOW()
     WHERE burn_id=$1`,
    [input.burnId, input.txid, input.recipientVout, input.carrierVout],
  );
}

export async function markClaimFailed(burnId: string, error: string): Promise<void> {
  await database().query(
    "UPDATE claims SET status='failed', error=$2, updated_at=NOW() WHERE burn_id=$1",
    [burnId, error.slice(0, 2000)],
  );
}

export async function getClaim(burnId: string): Promise<ClaimRow | null> {
  const result = await database().query<ClaimRow>("SELECT * FROM claims WHERE burn_id=$1", [burnId]);
  return result.rows[0] ?? null;
}

export async function listClaims(limit = 50): Promise<ClaimRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const result = await database().query<ClaimRow>(
    `SELECT * FROM claims
     WHERE status IN ('broadcast','confirmed')
     ORDER BY COALESCE(zcash_height, 9223372036854775807), created_at DESC
     LIMIT $1`,
    [safeLimit],
  );
  return result.rows;
}

export async function confirmIndexedClaim(input: {
  evidence: BurnEvidence;
  payloadHex: string;
  zcashTxid: string;
  zcashHeight: number;
  zcashTxIndex: number;
  recipientVout: number;
  carrierVout: number;
}): Promise<boolean> {
  const db = database();
  const existing = await db.query<ClaimRow>("SELECT * FROM claims WHERE burn_id=$1", [input.evidence.burnId]);
  if (existing.rows[0]?.status === "confirmed") {
    return existing.rows[0].zcash_txid === input.zcashTxid;
  }

  const result = await db.query(
    `INSERT INTO claims (
      burn_id, solana_signature, instruction_locator, solana_slot, mint, amount_base_units,
      recipient, payload_hex, zcash_txid, zcash_height, zcash_tx_index,
      recipient_vout, carrier_vout, current_owner, owner_txid, owner_vout, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$7,$9,$12,'confirmed')
    ON CONFLICT (burn_id) DO UPDATE SET
      zcash_txid = EXCLUDED.zcash_txid,
      zcash_height = EXCLUDED.zcash_height,
      zcash_tx_index = EXCLUDED.zcash_tx_index,
      recipient_vout = EXCLUDED.recipient_vout,
      carrier_vout = EXCLUDED.carrier_vout,
      current_owner = EXCLUDED.recipient,
      owner_txid = EXCLUDED.zcash_txid,
      owner_vout = EXCLUDED.recipient_vout,
      status = 'confirmed',
      error = NULL,
      updated_at = NOW()
    WHERE claims.status <> 'confirmed'
    RETURNING burn_id`,
    [
      input.evidence.burnId,
      input.evidence.signature,
      input.evidence.instructionLocator,
      input.evidence.slot,
      input.evidence.mint,
      input.evidence.amount.toString(),
      input.evidence.recipient,
      input.payloadHex,
      input.zcashTxid,
      input.zcashHeight,
      input.zcashTxIndex,
      input.recipientVout,
      input.carrierVout,
    ],
  );
  return result.rowCount === 1;
}

export type TransferRow = {
  txid: string;
  burn_id: string;
  zcash_height: string;
  zcash_tx_index: number;
  from_txid: string;
  from_vout: number;
  to_owner: string;
  to_vout: number;
  payload_vout: number;
};

export async function applyIndexedTransfer(input: {
  burnId: string;
  txid: string;
  zcashHeight: number;
  zcashTxIndex: number;
  fromTxid: string;
  fromVout: number;
  toOwner: string;
  toVout: number;
  payloadVout: number;
}): Promise<boolean> {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const claimResult = await client.query<ClaimRow>(
      "SELECT * FROM claims WHERE burn_id=$1 FOR UPDATE",
      [input.burnId],
    );
    const claim = claimResult.rows[0];
    if (
      !claim ||
      claim.status !== "confirmed" ||
      claim.owner_txid !== input.fromTxid ||
      claim.owner_vout !== input.fromVout
    ) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query(
      `INSERT INTO transfers (
        txid,burn_id,zcash_height,zcash_tx_index,from_txid,from_vout,to_owner,to_vout,payload_vout
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (txid) DO NOTHING`,
      [
        input.txid,
        input.burnId,
        input.zcashHeight,
        input.zcashTxIndex,
        input.fromTxid,
        input.fromVout,
        input.toOwner,
        input.toVout,
        input.payloadVout,
      ],
    );
    await client.query(
      `UPDATE claims
       SET current_owner=$2, owner_txid=$3, owner_vout=$4, updated_at=NOW()
       WHERE burn_id=$1`,
      [input.burnId, input.toOwner, input.txid, input.toVout],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function rebuildOwnershipFromTransfers(): Promise<void> {
  const db = database();
  await db.query(
    `UPDATE claims
     SET current_owner=recipient,
         owner_txid=zcash_txid,
         owner_vout=recipient_vout
     WHERE status='confirmed'`,
  );

  const claims = await db.query<{ burn_id: string }>(
    "SELECT burn_id FROM claims WHERE status='confirmed'",
  );
  for (const row of claims.rows) {
    const latest = await db.query<TransferRow>(
      `SELECT * FROM transfers
       WHERE burn_id=$1
       ORDER BY zcash_height DESC, zcash_tx_index DESC
       LIMIT 1`,
      [row.burn_id],
    );
    const transfer = latest.rows[0];
    if (!transfer) continue;
    await db.query(
      "UPDATE claims SET current_owner=$2, owner_txid=$3, owner_vout=$4 WHERE burn_id=$1",
      [row.burn_id, transfer.to_owner, transfer.txid, transfer.to_vout],
    );
  }
}
