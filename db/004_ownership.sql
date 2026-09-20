ALTER TABLE claims ADD COLUMN IF NOT EXISTS ownership_state TEXT NOT NULL DEFAULT 'tracked';
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_ownership_state_check;
ALTER TABLE claims ADD CONSTRAINT claims_ownership_state_check
  CHECK (ownership_state IN ('tracked','terminal'));

ALTER TABLE transfers ALTER COLUMN payload_vout DROP NOT NULL;
ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_pkey;
ALTER TABLE transfers ADD PRIMARY KEY (txid, burn_id);

CREATE TABLE IF NOT EXISTS ownership_terminals (
  burn_id TEXT PRIMARY KEY REFERENCES claims(burn_id) ON DELETE CASCADE,
  txid TEXT NOT NULL,
  zcash_height BIGINT NOT NULL,
  zcash_tx_index INTEGER NOT NULL,
  from_txid TEXT NOT NULL,
  from_vout INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ownership_terminals_height_idx
  ON ownership_terminals (zcash_height);
