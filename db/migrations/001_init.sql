-- RustMaxx initial schema

CREATE TABLE IF NOT EXISTS servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  rcon_host text NOT NULL,
  rcon_port int NOT NULL,
  rcon_password text NOT NULL,  /* MVP: plaintext; TODO: encrypt in Phase 2 */
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS logs (
  id bigserial PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  type text NOT NULL,  -- 'console' | 'chat'
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logs_server_created ON logs (server_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text NOT NULL,  -- 'admin'
  action text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);
