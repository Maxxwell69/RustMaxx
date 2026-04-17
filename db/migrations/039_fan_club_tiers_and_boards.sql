-- Fan club: tiers (fan / superfan / mod), revoked status, streamer-configured action boards per tier.

ALTER TABLE viewer_streamer_superfan_memberships
  DROP CONSTRAINT IF EXISTS viewer_streamer_superfan_memberships_status_check;

ALTER TABLE viewer_streamer_superfan_memberships
  ADD CONSTRAINT viewer_streamer_superfan_memberships_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'revoked'));

ALTER TABLE viewer_streamer_superfan_memberships
  ADD COLUMN IF NOT EXISTS club_tier text;

ALTER TABLE viewer_streamer_superfan_memberships
  DROP CONSTRAINT IF EXISTS viewer_streamer_superfan_memberships_club_tier_check;

ALTER TABLE viewer_streamer_superfan_memberships
  ADD CONSTRAINT viewer_streamer_superfan_memberships_club_tier_check
  CHECK (club_tier IS NULL OR club_tier IN ('fan', 'superfan', 'mod'));

COMMENT ON COLUMN viewer_streamer_superfan_memberships.club_tier IS
  'When status=approved: fan (default), superfan, or mod. NULL when pending/rejected/revoked.';

-- Existing approved memberships → fan tier (streamer can promote in dashboard).
UPDATE viewer_streamer_superfan_memberships
SET club_tier = 'fan'
WHERE status = 'approved' AND club_tier IS NULL;

CREATE TABLE IF NOT EXISTS streamer_fan_board_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  streamer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_tier text NOT NULL CHECK (board_tier IN ('fan', 'superfan', 'mod')),
  action_key text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  server_id uuid REFERENCES servers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (streamer_user_id, board_tier, action_key)
);

CREATE INDEX IF NOT EXISTS idx_streamer_fan_board_slots_streamer
  ON streamer_fan_board_slots (streamer_user_id, board_tier, sort_order);

COMMENT ON TABLE streamer_fan_board_slots IS
  'Actions from the RustChaos catalog shown on fan / superfan / mod boards; optional per-slot server overrides RCON target.';
