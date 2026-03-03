-- Map info per server: seed, world size, level, preview URL, last fetched.
-- Filled via RCON (global.printvar server.seed etc.) or manual fallback.

ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS seed int NULL,
  ADD COLUMN IF NOT EXISTS world_size int NULL,
  ADD COLUMN IF NOT EXISTS level text NULL,
  ADD COLUMN IF NOT EXISTS map_preview_url text NULL,
  ADD COLUMN IF NOT EXISTS map_last_fetched_at timestamptz NULL;

COMMENT ON COLUMN servers.seed IS 'Rust procedural map seed from server';
COMMENT ON COLUMN servers.world_size IS 'Rust world size (e.g. 3500) from server';
COMMENT ON COLUMN servers.level IS 'Map level: procedural, barren, hapis, etc.';
COMMENT ON COLUMN servers.map_preview_url IS 'URL to map preview image; generated from seed/size or set manually';
COMMENT ON COLUMN servers.map_last_fetched_at IS 'When map info was last fetched via RCON';
