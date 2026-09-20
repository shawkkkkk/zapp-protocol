ALTER TABLE service_health
  ADD COLUMN IF NOT EXISTS metadata JSONB;
