-- Server owners: restrict which RustMaxx users may attach TikFinity webhooks to this server (empty = any eligible streamer).
ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS streamer_allowed_user_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN servers.streamer_allowed_user_ids IS
  'When non-empty, only these user IDs may create/use per-server streamer webhooks. Empty = legacy: any streamer with interactions enabled.';

-- Streamer TikFinity rules: default duration (seconds) for status-effect actions; still overridable by TikFinity URL/body duration.
ALTER TABLE streamer_tikfinity_rules
  ADD COLUMN IF NOT EXISTS duration_seconds integer NOT NULL DEFAULT 10;

ALTER TABLE streamer_tikfinity_rules
  DROP CONSTRAINT IF EXISTS streamer_tikfinity_rules_duration_seconds_check;

ALTER TABLE streamer_tikfinity_rules
  ADD CONSTRAINT streamer_tikfinity_rules_duration_seconds_check
  CHECK (duration_seconds >= 1 AND duration_seconds <= 120);
