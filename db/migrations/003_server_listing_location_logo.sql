-- Location and logo for public server listing.

ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS logo_url text;

COMMENT ON COLUMN servers.location IS 'Optional location label for public listing (e.g. Quebec, US East)';
COMMENT ON COLUMN servers.logo_url IS 'Optional logo image URL for public listing';
