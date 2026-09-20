-- ZApp v1 permits exactly one canonical BurnChecked instruction per Solana
-- transaction, so a finalized Solana signature can correspond to only one claim.
CREATE UNIQUE INDEX IF NOT EXISTS claims_solana_signature_v1_unique
  ON claims(solana_signature);

-- A persisted NFT content commitment belongs to exactly one canonical burn.
CREATE UNIQUE INDEX IF NOT EXISTS nft_mints_content_commitment_unique
  ON nft_mints(content_sha256);
