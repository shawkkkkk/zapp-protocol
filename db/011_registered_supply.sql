ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS registered_supply_base_units NUMERIC(20,0);

-- Existing pre-migration rows intentionally remain NULL. Their historical
-- registration-time supply cannot be reconstructed safely from burn totals.
-- New registrations populate this field from the finalized Solana mint.
