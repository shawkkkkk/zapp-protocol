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
  ownership_state: "tracked" | "terminal";
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
  payload_vout: number | null;
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
  payloadVout: number | null;
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
      ON CONFLICT (txid, burn_id) DO NOTHING`,
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
       SET current_owner=$2, owner_txid=$3, owner_vout=$4, ownership_state='tracked', updated_at=NOW()
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


export async function getClaimByOwnerOutpoint(
  txid: string,
  vout: number,
): Promise<ClaimRow | null> {
  const result = await database().query<ClaimRow>(
    `SELECT * FROM claims
     WHERE status='confirmed'
       AND ownership_state='tracked'
       AND owner_txid=$1
       AND owner_vout=$2
     LIMIT 1`,
    [txid, vout],
  );
  return result.rows[0] || null;
}

export async function terminateIndexedOwnership(input: {
  burnId: string;
  txid: string;
  zcashHeight: number;
  zcashTxIndex: number;
  fromTxid: string;
  fromVout: number;
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
      claim.ownership_state !== "tracked" ||
      claim.owner_txid !== input.fromTxid ||
      claim.owner_vout !== input.fromVout
    ) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query(
      `INSERT INTO ownership_terminals (
        burn_id,txid,zcash_height,zcash_tx_index,from_txid,from_vout
      ) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (burn_id) DO UPDATE SET
        txid=EXCLUDED.txid,
        zcash_height=EXCLUDED.zcash_height,
        zcash_tx_index=EXCLUDED.zcash_tx_index,
        from_txid=EXCLUDED.from_txid,
        from_vout=EXCLUDED.from_vout`,
      [
        input.burnId,
        input.txid,
        input.zcashHeight,
        input.zcashTxIndex,
        input.fromTxid,
        input.fromVout,
      ],
    );
    await client.query(
      `UPDATE claims
       SET current_owner=NULL, owner_txid=NULL, owner_vout=NULL,
           ownership_state='terminal', updated_at=NOW()
       WHERE burn_id=$1`,
      [input.burnId],
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
         owner_vout=recipient_vout,
         ownership_state='tracked'
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
    if (transfer) {
      await db.query(
        "UPDATE claims SET current_owner=$2, owner_txid=$3, owner_vout=$4, ownership_state='tracked' WHERE burn_id=$1",
        [row.burn_id, transfer.to_owner, transfer.txid, transfer.to_vout],
      );
    }

    const terminal = await db.query<{ burn_id: string }>(
      "SELECT burn_id FROM ownership_terminals WHERE burn_id=$1 LIMIT 1",
      [row.burn_id],
    );
    if (terminal.rows[0]) {
      await db.query(
        "UPDATE claims SET current_owner=NULL, owner_txid=NULL, owner_vout=NULL, ownership_state='terminal' WHERE burn_id=$1",
        [row.burn_id],
      );
    }
  }
}

export type AssetRow = {
  mint: string;
  token_program: string;
  name: string;
  symbol: string;
  decimals: number;
  creator: string;
  image_url: string | null;
  description: string | null;
  website_url: string | null;
  x_url: string | null;
  min_burn_base_units: string;
  creation_signature: string | null;
  registration_signature: string | null;
  registered_supply_base_units: string | null;
  launch_slot: string;
  enabled: boolean;
  created_at: string;
};

export async function upsertAsset(input: {
  mint: string;
  tokenProgram: string;
  name: string;
  symbol: string;
  decimals: number;
  creator: string;
  imageUrl?: string | null;
  description?: string | null;
  websiteUrl?: string | null;
  xUrl?: string | null;
  minBurnBaseUnits: string;
  creationSignature: string;
  registrationSignature: string;
  registeredSupplyBaseUnits: string;
  launchSlot: number;
}): Promise<AssetRow> {
  const db = database();
  const inserted = await db.query<AssetRow>(
    `INSERT INTO assets (
      mint,token_program,name,symbol,decimals,creator,image_url,description,
      website_url,x_url,min_burn_base_units,creation_signature,
      registration_signature,registered_supply_base_units,launch_slot
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (mint) DO NOTHING
    RETURNING *`,
    [
      input.mint,
      input.tokenProgram,
      input.name,
      input.symbol,
      input.decimals,
      input.creator,
      input.imageUrl || null,
      input.description || null,
      input.websiteUrl || null,
      input.xUrl || null,
      input.minBurnBaseUnits,
      input.creationSignature,
      input.registrationSignature,
      input.registeredSupplyBaseUnits,
      input.launchSlot,
    ],
  );
  if (inserted.rows[0]) return inserted.rows[0];

  const existingResult = await db.query<AssetRow>(
    "SELECT * FROM assets WHERE mint=$1",
    [input.mint],
  );
  const existing = existingResult.rows[0];
  if (!existing) throw new Error("Launch registration conflicted; retry");

  const same =
    existing.creator === input.creator &&
    existing.token_program === input.tokenProgram &&
    existing.name === input.name &&
    existing.symbol === input.symbol &&
    existing.decimals === input.decimals &&
    existing.image_url === (input.imageUrl || null) &&
    existing.description === (input.description || null) &&
    existing.website_url === (input.websiteUrl || null) &&
    existing.x_url === (input.xUrl || null) &&
    existing.min_burn_base_units === input.minBurnBaseUnits &&
    existing.creation_signature === input.creationSignature &&
    existing.registration_signature === input.registrationSignature &&
    existing.registered_supply_base_units === input.registeredSupplyBaseUnits;

  if (!same) {
    throw new Error(
      existing.creator === input.creator
        ? "Launch metadata is immutable after registration"
        : "This mint is already registered by a different creator",
    );
  }
  return existing;
}

export async function getAsset(mint: string): Promise<AssetRow | null> {
  const result = await database().query<AssetRow>("SELECT * FROM assets WHERE mint=$1 AND enabled=TRUE", [mint]);
  return result.rows[0] || null;
}

export async function listAssets(limit = 50): Promise<AssetRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const result = await database().query<AssetRow>(
    "SELECT * FROM assets WHERE enabled=TRUE ORDER BY created_at DESC LIMIT $1",
    [safeLimit],
  );
  return result.rows;
}

export type NftMintRow = {
  burn_id: string;
  status: "queued" | "building" | "commit_broadcast" | "reveal_broadcast" | "confirmed" | "failed";
  content_json: string;
  content_sha256: string;
  commit_txid: string | null;
  commit_vout: number | null;
  commit_raw_hex: string | null;
  reveal_txid: string | null;
  reveal_raw_hex: string | null;
  inscription_id: string | null;
  indexer_verified_at: string | null;
  indexer_verified_height: string | null;
  attempts: number;
  error: string | null;
  updated_at: string;
  created_at: string;
};

export async function queueNftMint(input: {
  burnId: string;
  contentJson: string;
  contentSha256: string;
}): Promise<NftMintRow> {
  const result = await database().query<NftMintRow>(
    `INSERT INTO nft_mints (burn_id,status,content_json,content_sha256)
     VALUES ($1,'queued',$2,$3)
     ON CONFLICT (burn_id) DO UPDATE SET
       status=CASE WHEN nft_mints.status='failed' THEN 'queued' ELSE nft_mints.status END,
       error=CASE WHEN nft_mints.status='failed' THEN NULL ELSE nft_mints.error END,
       updated_at=NOW()
     RETURNING *`,
    [input.burnId,input.contentJson,input.contentSha256],
  );
  return result.rows[0];
}

export async function getNftMint(burnId: string): Promise<NftMintRow | null> {
  const result = await database().query<NftMintRow>("SELECT * FROM nft_mints WHERE burn_id=$1", [burnId]);
  return result.rows[0] || null;
}


export async function markNftIndexerVerified(input: {
  burnId: string;
  revealTxid: string;
  zcashHeight: number;
}): Promise<boolean> {
  const result = await database().query(
    `UPDATE nft_mints
     SET indexer_verified_at=NOW(),
         indexer_verified_height=$3,
         updated_at=NOW()
     WHERE burn_id=$1
       AND reveal_txid=$2
     RETURNING burn_id`,
    [input.burnId, input.revealTxid, input.zcashHeight],
  );
  return result.rowCount === 1;
}

export async function acquireNextNftMint(): Promise<NftMintRow | null> {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<NftMintRow>(
      `SELECT * FROM nft_mints
       WHERE status='queued'
          OR (
            status IN ('building','commit_broadcast','reveal_broadcast')
            AND updated_at < NOW() - INTERVAL '30 seconds'
          )
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
    );
    const row = selected.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null;
    }
    const claimed = await client.query<NftMintRow>(
      `UPDATE nft_mints
       SET status='building', attempts=attempts+1, error=NULL, updated_at=NOW()
       WHERE burn_id=$1 RETURNING *`,
      [row.burn_id],
    );
    await client.query("COMMIT");
    return claimed.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateNftMint(
  burnId: string,
  patch: {
    status: NftMintRow["status"];
    commitTxid?: string | null;
    commitVout?: number | null;
    commitRawHex?: string | null;
    revealTxid?: string | null;
    revealRawHex?: string | null;
    inscriptionId?: string | null;
    error?: string | null;
  },
): Promise<void> {
  await database().query(
    `UPDATE nft_mints SET
      status=$2,
      commit_txid=COALESCE($3,commit_txid),
      commit_vout=COALESCE($4,commit_vout),
      commit_raw_hex=COALESCE($5,commit_raw_hex),
      reveal_txid=COALESCE($6,reveal_txid),
      reveal_raw_hex=COALESCE($7,reveal_raw_hex),
      inscription_id=COALESCE($8,inscription_id),
      error=$9,
      updated_at=NOW()
     WHERE burn_id=$1`,
    [
      burnId,patch.status,patch.commitTxid ?? null,patch.commitVout ?? null,
      patch.commitRawHex ?? null,patch.revealTxid ?? null,patch.revealRawHex ?? null,
      patch.inscriptionId ?? null,patch.error ?? null,
    ],
  );
}

export type PublicNftRow = NftMintRow & {
  mint: string;
  amount_base_units: string;
  recipient: string;
  current_owner: string | null;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
};

export async function listNftMints(limit = 50): Promise<PublicNftRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const result = await database().query<PublicNftRow>(
    `SELECT n.*, c.mint, c.amount_base_units, c.recipient, c.current_owner,
            a.symbol, a.name, a.decimals
     FROM nft_mints n
     JOIN claims c ON c.burn_id=n.burn_id
     LEFT JOIN assets a ON a.mint=c.mint
     ORDER BY n.created_at DESC
     LIMIT $1`,
    [safeLimit],
  );
  return result.rows;
}


export type AssetStats = {
  verified_burns: number;
  burned_base_units: string;
  confirmed_nfts: number;
  pending_nfts: number;
};

export async function getAssetStats(mint: string): Promise<AssetStats> {
  const result = await database().query<{
    verified_burns: string;
    burned_base_units: string | null;
    confirmed_nfts: string;
    pending_nfts: string;
  }>(
    `SELECT
       COUNT(c.burn_id)::text AS verified_burns,
       COALESCE(SUM(c.amount_base_units), 0)::text AS burned_base_units,
       COUNT(*) FILTER (WHERE n.status='confirmed')::text AS confirmed_nfts,
       COUNT(*) FILTER (
         WHERE n.status IN ('queued','building','commit_broadcast','reveal_broadcast')
       )::text AS pending_nfts
     FROM claims c
     LEFT JOIN nft_mints n ON n.burn_id=c.burn_id
     WHERE c.mint=$1`,
    [mint],
  );
  const row = result.rows[0];
  return {
    verified_burns: Number(row?.verified_burns || "0"),
    burned_base_units: row?.burned_base_units || "0",
    confirmed_nfts: Number(row?.confirmed_nfts || "0"),
    pending_nfts: Number(row?.pending_nfts || "0"),
  };
}

export async function getNftQueueStats(): Promise<{
  queued: number;
  active: number;
  confirmed: number;
  failed: number;
}> {
  const result = await database().query<{
    queued: string;
    active: string;
    confirmed: string;
    failed: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status='queued')::text AS queued,
       COUNT(*) FILTER (WHERE status IN ('building','commit_broadcast','reveal_broadcast'))::text AS active,
       COUNT(*) FILTER (WHERE status='confirmed')::text AS confirmed,
       COUNT(*) FILTER (WHERE status='failed')::text AS failed
     FROM nft_mints`,
  );
  const row = result.rows[0];
  return {
    queued: Number(row?.queued || "0"),
    active: Number(row?.active || "0"),
    confirmed: Number(row?.confirmed || "0"),
    failed: Number(row?.failed || "0"),
  };
}


export type ServiceHealthRow = {
  service: string;
  status: string;
  details: string | null;
  heartbeat_at: string;
};

export async function heartbeatService(
  service: string,
  status: string,
  details?: string | null,
): Promise<void> {
  await database().query(
    `INSERT INTO service_health(service,status,details,heartbeat_at)
     VALUES ($1,$2,$3,NOW())
     ON CONFLICT(service) DO UPDATE SET
       status=EXCLUDED.status,
       details=EXCLUDED.details,
       heartbeat_at=NOW()`,
    [service, status, details || null],
  );
}

export async function getServiceHealth(service: string): Promise<ServiceHealthRow | null> {
  const result = await database().query<ServiceHealthRow>(
    "SELECT * FROM service_health WHERE service=$1",
    [service],
  );
  return result.rows[0] || null;
}


export type AssetDiscoverySort = "newest" | "trending" | "most-burned" | "recently-stamped";

export type AssetDiscoveryRow = AssetRow & {
  verified_burns: number;
  burned_base_units: string;
  confirmed_nfts: number;
  pending_nfts: number;
  burns_24h: number;
  nfts_24h: number;
  last_stamp_at: string | null;
  burned_percent: string;
};

export async function listAssetsForDiscovery(
  sort: AssetDiscoverySort = "newest",
  limit = 24,
): Promise<AssetDiscoveryRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const orderBy =
    sort === "most-burned"
      ? "burned_percent_numeric DESC, a.created_at DESC"
      : sort === "recently-stamped"
        ? "last_stamp_at DESC NULLS LAST, a.created_at DESC"
        : sort === "trending"
          ? "trend_score DESC, a.created_at DESC"
          : "a.created_at DESC";

  const result = await database().query<AssetDiscoveryRow>(
    `WITH burn_stats AS (
       SELECT
         c.mint,
         COUNT(*)::int AS verified_burns,
         COALESCE(SUM(c.amount_base_units), 0)::numeric AS burned_base_units_numeric,
         COUNT(*) FILTER (WHERE c.created_at >= NOW() - INTERVAL '24 hours')::int AS burns_24h
       FROM claims c
       GROUP BY c.mint
     ),
     nft_stats AS (
       SELECT
         c.mint,
         COUNT(*) FILTER (WHERE n.status='confirmed')::int AS confirmed_nfts,
         COUNT(*) FILTER (
           WHERE n.status IN ('queued','building','commit_broadcast','reveal_broadcast')
         )::int AS pending_nfts,
         COUNT(*) FILTER (
           WHERE n.status='confirmed' AND n.created_at >= NOW() - INTERVAL '24 hours'
         )::int AS nfts_24h,
         MAX(n.created_at) FILTER (WHERE n.status='confirmed') AS last_stamp_at
       FROM claims c
       JOIN nft_mints n ON n.burn_id=c.burn_id
       GROUP BY c.mint
     )
     SELECT
       a.*,
       COALESCE(b.verified_burns,0)::int AS verified_burns,
       COALESCE(b.burned_base_units_numeric,0)::text AS burned_base_units,
       COALESCE(n.confirmed_nfts,0)::int AS confirmed_nfts,
       COALESCE(n.pending_nfts,0)::int AS pending_nfts,
       COALESCE(b.burns_24h,0)::int AS burns_24h,
       COALESCE(n.nfts_24h,0)::int AS nfts_24h,
       n.last_stamp_at,
       COALESCE(b.burned_base_units_numeric,0) AS burned_base_units_numeric,
       CASE
         WHEN COALESCE(a.registered_supply_base_units,0) > 0
         THEN LEAST(
           100,
           COALESCE(b.burned_base_units_numeric,0) * 100 /
             a.registered_supply_base_units
         )
         ELSE 0
       END::numeric AS burned_percent_numeric,
       CASE
         WHEN COALESCE(a.registered_supply_base_units,0) > 0
         THEN LEAST(
           100,
           COALESCE(b.burned_base_units_numeric,0) * 100 /
             a.registered_supply_base_units
         )::text
         ELSE '0'
       END AS burned_percent,
       (
         COALESCE(b.burns_24h,0) * 4 +
         COALESCE(n.nfts_24h,0) * 8 +
         COALESCE(b.verified_burns,0)
       )::numeric AS trend_score
     FROM assets a
     LEFT JOIN burn_stats b ON b.mint=a.mint
     LEFT JOIN nft_stats n ON n.mint=a.mint
     WHERE a.enabled=TRUE
     ORDER BY ${orderBy}
     LIMIT $1`,
    [safeLimit],
  );
  return result.rows;
}


export type LaunchImageRow = {
  sha256: string;
  content_type: string;
  byte_size: number;
  data: Buffer;
  creator: string;
  created_at: string;
};

export async function putLaunchImage(input: {
  sha256: string;
  contentType: string;
  data: Buffer;
  creator: string;
}): Promise<void> {
  await database().query(
    `INSERT INTO launch_images (sha256, content_type, byte_size, data, creator)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (sha256) DO NOTHING`,
    [input.sha256, input.contentType, input.data.byteLength, input.data, input.creator],
  );
}

export async function getLaunchImage(sha256: string): Promise<LaunchImageRow | null> {
  const result = await database().query<LaunchImageRow>(
    "SELECT * FROM launch_images WHERE sha256=$1",
    [sha256],
  );
  return result.rows[0] || null;
}


export type AssetWatchCursorRow = {
  mint: string;
  start_slot: string;
  last_signature: string | null;
  last_slot: string | null;
  updated_at: string;
};

export async function ensureAssetWatchCursor(
  mint: string,
  startSlot: number,
): Promise<AssetWatchCursorRow> {
  const result = await database().query<AssetWatchCursorRow>(
    `INSERT INTO asset_watch_cursors(mint,start_slot)
     VALUES ($1,$2)
     ON CONFLICT(mint) DO UPDATE SET
       start_slot=LEAST(asset_watch_cursors.start_slot, EXCLUDED.start_slot)
     RETURNING *`,
    [mint, startSlot],
  );
  return result.rows[0];
}

export async function getAssetWatchCursor(
  mint: string,
): Promise<AssetWatchCursorRow | null> {
  const result = await database().query<AssetWatchCursorRow>(
    "SELECT * FROM asset_watch_cursors WHERE mint=$1",
    [mint],
  );
  return result.rows[0] || null;
}

export async function advanceAssetWatchCursor(input: {
  mint: string;
  signature: string;
  slot: number;
}): Promise<void> {
  await database().query(
    `UPDATE asset_watch_cursors
     SET last_signature=$2,last_slot=$3,updated_at=NOW()
     WHERE mint=$1`,
    [input.mint, input.signature, input.slot],
  );
}

export async function listAssetsForWatcher(): Promise<AssetRow[]> {
  const result = await database().query<AssetRow>(
    "SELECT * FROM assets WHERE enabled=TRUE ORDER BY created_at ASC",
  );
  return result.rows;
}
