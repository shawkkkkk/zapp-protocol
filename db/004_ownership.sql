ALTER TABLE claims ADD COLUMN IF NOT EXISTS ownership_state TEXT NOT NULL DEFAULT 'tracked';
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_ownership_state_check;
ALTER TABLE claims ADD CONSTRAINT claims_ownership_state_check
  CHECK (ownership_state IN ('tracked','terminal'));

ALTER TABLE transfers ALTER COLUMN payload_vout DROP NOT NULL;
ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_pkey;
ALTER TABLE transfers ADD PRIMARY KEY (txid, burn_id);
