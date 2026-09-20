ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS registered_supply_base_units NUMERIC(20,0);

UPDATE assets a
SET registered_supply_base_units = COALESCE(
  (
    SELECT SUM(c.amount_base_units)::numeric
    FROM claims c
    WHERE c.mint=a.mint
  ),
  0
)
WHERE registered_supply_base_units IS NULL;
