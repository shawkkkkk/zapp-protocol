CREATE TABLE IF NOT EXISTS launch_images (
  sha256 CHAR(64) PRIMARY KEY,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 2097152),
  data BYTEA NOT NULL,
  creator TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS launch_images_creator_idx
  ON launch_images(creator, created_at DESC);
