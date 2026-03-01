-- Per-server user access (moderators can create server users).

CREATE TABLE IF NOT EXISTS server_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'player',
  created_at timestamptz DEFAULT now(),
  UNIQUE (server_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_server_users_server ON server_users (server_id);
CREATE INDEX IF NOT EXISTS idx_server_users_user ON server_users (user_id);

COMMENT ON TABLE server_users IS 'User access to a specific server; moderator can create these';
