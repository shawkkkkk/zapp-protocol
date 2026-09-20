CREATE TABLE IF NOT EXISTS service_health (
  service TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  details TEXT,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
