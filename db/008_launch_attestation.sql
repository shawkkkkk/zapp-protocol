ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS creation_signature TEXT,
  ADD COLUMN IF NOT EXISTS registration_signature TEXT;
