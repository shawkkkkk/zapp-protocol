ALTER TABLE nft_mints
  ADD COLUMN IF NOT EXISTS indexer_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS indexer_verified_height BIGINT;
