-- Recent fan-board button presses for streamer dashboard (who / what / which board).

CREATE TABLE IF NOT EXISTS streamer_fan_board_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  streamer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewer_label text NOT NULL,
  board_tier text NOT NULL CHECK (board_tier IN ('fan', 'superfan', 'mod')),
  action_key text NOT NULL,
  action_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fan_board_activity_streamer_created
  ON streamer_fan_board_activity (streamer_user_id, created_at DESC);

COMMENT ON TABLE streamer_fan_board_activity IS
  'Successful fan-board RCON triggers; streamer Fan club UI shows recent lines.';
