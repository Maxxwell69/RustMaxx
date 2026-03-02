-- Per-server permission groups and their members.

CREATE TABLE IF NOT EXISTS server_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_server_groups_server_name
  ON server_groups (server_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_server_groups_server
  ON server_groups (server_id);

COMMENT ON TABLE server_groups IS 'Named permission groups scoped to a single server (e.g. VIP, Staff).';

CREATE TABLE IF NOT EXISTS server_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES server_groups(id) ON DELETE CASCADE,
  player_id text NOT NULL,
  player_name text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (group_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_server_group_members_group
  ON server_group_members (group_id);

COMMENT ON TABLE server_group_members IS 'Players assigned to a given server group by Rust ID.';

