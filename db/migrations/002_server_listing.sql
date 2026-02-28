-- Optional public server list: servers can opt in and set listing details.

ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS listed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS listing_name text,
  ADD COLUMN IF NOT EXISTS listing_description text,
  ADD COLUMN IF NOT EXISTS game_host text,
  ADD COLUMN IF NOT EXISTS game_port int;

COMMENT ON COLUMN servers.listed IS 'When true, server appears on the public /server-list page';
COMMENT ON COLUMN servers.listing_name IS 'Optional display name for public listing (defaults to name)';
COMMENT ON COLUMN servers.listing_description IS 'Optional short description for public listing';
COMMENT ON COLUMN servers.game_host IS 'Join address for players (e.g. IP or hostname); not RCON host';
COMMENT ON COLUMN servers.game_port IS 'Game/join port (e.g. 28015); not RCON port';
