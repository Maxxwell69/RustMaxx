-- Store listing logo bytes in Postgres so images survive container restarts / deploys
-- when the host has no persistent volume for local disk uploads.

ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS listing_logo_bytes bytea,
  ADD COLUMN IF NOT EXISTS listing_logo_mime text;

COMMENT ON COLUMN servers.listing_logo_bytes IS 'Optional image bytes for the public listing logo (persists across restarts).';
COMMENT ON COLUMN servers.listing_logo_mime IS 'MIME type for listing_logo_bytes (e.g. image/png).';
