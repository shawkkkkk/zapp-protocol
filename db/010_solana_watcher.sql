CREATE TABLE IF NOT EXISTS asset_watch_cursors (
  mint TEXT PRIMARY KEY REFERENCES assets(mint) ON DELETE CASCADE,
  start_slot BIGINT NOT NULL CHECK (start_slot >= 0),
  last_signature TEXT,
  last_slot BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS asset_watch_cursors_updated_idx
  ON asset_watch_cursors(updated_at);
