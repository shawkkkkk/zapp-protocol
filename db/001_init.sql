CREATE TABLE IF NOT EXISTS claims (
  burn_id TEXT PRIMARY KEY,
  solana_signature TEXT NOT NULL,
  instruction_locator TEXT NOT NULL,
  solana_slot BIGINT NOT NULL,
  mint TEXT NOT NULL,
  amount_base_units NUMERIC(20, 0) NOT NULL CHECK (amount_base_units > 0),
  recipient TEXT NOT NULL,
  payload_hex TEXT NOT NULL,
  zcash_txid TEXT UNIQUE,
  zcash_height BIGINT,
  zcash_tx_index INTEGER,
  recipient_vout INTEGER,
  carrier_vout INTEGER,
  current_owner TEXT,
  owner_txid TEXT,
  owner_vout INTEGER,
  status TEXT NOT NULL CHECK (status IN ('reserved','relaying','broadcast','confirmed','failed','invalidated')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS claims_mint_idx ON claims (mint);
CREATE INDEX IF NOT EXISTS claims_status_idx ON claims (status);

CREATE TABLE IF NOT EXISTS indexer_state (
  name TEXT PRIMARY KEY,
  height BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS zcash_blocks (
  height BIGINT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
