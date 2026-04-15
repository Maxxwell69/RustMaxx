-- Per-server streamer access requests (from public server list) + optional owner-approval gate.

ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS streamer_join_requires_owner_approval boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN servers.streamer_join_requires_owner_approval IS
  'When true with streamer interactions on: only allowlisted users or users with an approved streamer_server_requests row may use TikFinity webhooks for this server.';

CREATE TABLE IF NOT EXISTS streamer_server_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (server_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_streamer_server_requests_server_status
  ON streamer_server_requests (server_id, status);

COMMENT ON TABLE streamer_server_requests IS
  'Streamer asks to use TikFinity on a listed server; owner approves or rejects after RustMaxx staff approved their global streamer application.';
