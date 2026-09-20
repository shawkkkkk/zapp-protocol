ALTER TABLE assets
ADD COLUMN IF NOT EXISTS min_burn_base_units NUMERIC(20,0) NOT NULL DEFAULT 1;

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_min_burn_positive;
ALTER TABLE assets ADD CONSTRAINT assets_min_burn_positive
  CHECK (min_burn_base_units > 0);
