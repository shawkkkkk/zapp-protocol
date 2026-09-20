ALTER TABLE claims ADD COLUMN IF NOT EXISTS current_owner TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS owner_txid TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS owner_vout INTEGER;

CREATE TABLE IF NOT EXISTS transfers (
  txid TEXT PRIMARY KEY,
  burn_id TEXT NOT NULL REFERENCES claims(burn_id) ON DELETE CASCADE,
  zcash_height BIGINT NOT NULL,
  zcash_tx_index INTEGER NOT NULL,
  from_txid TEXT NOT NULL,
  from_vout INTEGER NOT NULL,
  to_owner TEXT NOT NULL,
  to_vout INTEGER NOT NULL,
  payload_vout INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (burn_id, zcash_height, zcash_tx_index)
);

CREATE INDEX IF NOT EXISTS transfers_burn_idx
  ON transfers (burn_id, zcash_height, zcash_tx_index);
