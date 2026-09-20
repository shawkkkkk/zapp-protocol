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
  ownership_state TEXT NOT NULL DEFAULT 'tracked'
    CHECK (ownership_state IN ('tracked','terminal')),
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
  txid TEXT NOT NULL,
  burn_id TEXT NOT NULL REFERENCES claims(burn_id) ON DELETE CASCADE,
  zcash_height BIGINT NOT NULL,
  zcash_tx_index INTEGER NOT NULL,
  from_txid TEXT NOT NULL,
  from_vout INTEGER NOT NULL,
  to_owner TEXT NOT NULL,
  to_vout INTEGER NOT NULL,
  payload_vout INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (txid, burn_id),
  UNIQUE (burn_id, zcash_height, zcash_tx_index)
);

CREATE INDEX IF NOT EXISTS transfers_burn_idx
  ON transfers (burn_id, zcash_height, zcash_tx_index);

CREATE TABLE IF NOT EXISTS assets (
  mint TEXT PRIMARY KEY,
  token_program TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 48),
  symbol TEXT NOT NULL CHECK (char_length(symbol) BETWEEN 1 AND 12),
  decimals INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 255),
  creator TEXT NOT NULL,
  image_url TEXT,
  description TEXT,
  website_url TEXT,
  x_url TEXT,
  launch_slot BIGINT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assets_created_idx ON assets (created_at DESC);

CREATE TABLE IF NOT EXISTS nft_mints (
  burn_id TEXT PRIMARY KEY REFERENCES claims(burn_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN (
    'queued','building','commit_broadcast','reveal_broadcast','confirmed','failed'
  )),
  content_json TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  commit_txid TEXT,
  commit_vout INTEGER,
  commit_raw_hex TEXT,
  reveal_txid TEXT UNIQUE,
  reveal_raw_hex TEXT,
  inscription_id TEXT UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nft_mints_status_idx ON nft_mints(status, updated_at);

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
