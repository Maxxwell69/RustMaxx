-- Rust items the platform offers for streamer interactions; server owners pick a subset.

CREATE TABLE IF NOT EXISTS streamer_platform_items (
  shortname text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  default_amount int NOT NULL DEFAULT 1 CHECK (default_amount >= 1 AND default_amount <= 999999),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_streamer_platform_items_active ON streamer_platform_items (is_active);

ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS streamer_allowed_item_shortnames text[] NOT NULL DEFAULT '{}';

COMMENT ON TABLE streamer_platform_items IS 'Admin-curated Rust items streamers may reference; intersects with servers.streamer_allowed_item_shortnames.';
