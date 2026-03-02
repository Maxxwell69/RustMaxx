-- Items that a server admin has enabled for the player give-items UI.

CREATE TABLE IF NOT EXISTS server_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  shortname text NOT NULL,
  label text NOT NULL,
  amount int NOT NULL DEFAULT 1,
  category text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (server_id, shortname)
);

CREATE INDEX IF NOT EXISTS idx_server_items_server
  ON server_items (server_id);

COMMENT ON TABLE server_items IS 'Per-server selection of items that appear on the player page give-items UI.';

