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

ALTER TABLE nft_mints ADD COLUMN IF NOT EXISTS commit_raw_hex TEXT;
ALTER TABLE nft_mints ADD COLUMN IF NOT EXISTS reveal_raw_hex TEXT;
