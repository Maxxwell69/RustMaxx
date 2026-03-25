-- Optional default anchor for TikFinity maxxinvaders spawns (patrol near streamer / base owner).
ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS tikfinity_anchor_steam_id text;

COMMENT ON COLUMN servers.tikfinity_anchor_steam_id IS 'Optional 17-digit Steam64: used when webhook/body omit anchorSteam; player should be online or sleeping on this Rust server';
