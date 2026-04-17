-- Per-tier cooldown between fan-board button triggers; last trigger time per viewer/streamer/board.

CREATE TABLE IF NOT EXISTS streamer_fan_board_settings (
  streamer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_tier text NOT NULL CHECK (board_tier IN ('fan', 'superfan', 'mod')),
  cooldown_seconds int NOT NULL CHECK (cooldown_seconds >= 0 AND cooldown_seconds <= 3600),
  PRIMARY KEY (streamer_user_id, board_tier)
);

COMMENT ON TABLE streamer_fan_board_settings IS
  'Cooldown between any two button presses on that board tier for the same viewer. Defaults when row missing: fan 30s, superfan 30s, mod 0.';

CREATE TABLE IF NOT EXISTS viewer_fan_board_last_trigger (
  viewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  streamer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_tier text NOT NULL CHECK (board_tier IN ('fan', 'superfan', 'mod')),
  last_trigger_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_user_id, streamer_user_id, board_tier)
);

CREATE INDEX IF NOT EXISTS idx_viewer_fan_board_last_streamer
  ON viewer_fan_board_last_trigger (streamer_user_id);

COMMENT ON TABLE viewer_fan_board_last_trigger IS
  'Last time this viewer triggered any action on this streamer board tier (for cooldown enforcement).';
