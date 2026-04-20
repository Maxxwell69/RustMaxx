-- Persist streamer directory profile images in Postgres (survives deploys without disk).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS streamer_directory_avatar_bytes bytea,
  ADD COLUMN IF NOT EXISTS streamer_directory_avatar_mime text;

COMMENT ON COLUMN users.streamer_directory_avatar_bytes IS 'Optional avatar bytes for public streamer directory (persists across restarts).';
COMMENT ON COLUMN users.streamer_directory_avatar_mime IS 'MIME type for streamer_directory_avatar_bytes.';
