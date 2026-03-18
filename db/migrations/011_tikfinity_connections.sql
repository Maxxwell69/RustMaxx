-- Admin-defined TikFinity connections: event/action name → server action.
-- When TikFinity sends an event name that matches a connection, the mapped server action runs.

CREATE TABLE IF NOT EXISTS tikfinity_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  server_action text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tikfinity_connections_name_lower
  ON tikfinity_connections (lower(trim(name)));

CREATE INDEX IF NOT EXISTS idx_tikfinity_connections_created
  ON tikfinity_connections (created_at DESC);

COMMENT ON TABLE tikfinity_connections IS 'Admin map: TikFinity event/action name → RustChaos action (test, rose, smoke, etc.)';
