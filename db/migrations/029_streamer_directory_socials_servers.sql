-- Public streamer profile: optional social overrides + opt-in listed servers.

ALTER TABLE users ADD COLUMN IF NOT EXISTS streamer_directory_socials jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS streamer_directory_show_servers boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.streamer_directory_socials IS
  'Optional per-field overrides for public profile (URLs / text). Empty object uses approved streamer application only.';
COMMENT ON COLUMN users.streamer_directory_show_servers IS
  'When true, public profile lists listed RustMaxx servers this user has approved streamer access on.';
