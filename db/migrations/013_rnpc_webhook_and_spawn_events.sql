-- Roaming NPC (NPCMaxx) webhook: optional template key per TikFinity connection + audit trail.

ALTER TABLE tikfinity_connections
  ADD COLUMN IF NOT EXISTS npc_template_key text;

COMMENT ON COLUMN tikfinity_connections.npc_template_key IS 'RoamingNPCs template key when server_action is npcmaxx (required for that action).';

CREATE TABLE IF NOT EXISTS rnpc_spawn_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES tikfinity_connections(id) ON DELETE SET NULL,
  tikfinity_event_name text,
  viewer_name text NOT NULL,
  template_key text NOT NULL,
  command text NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rnpc_spawn_events_server_created
  ON rnpc_spawn_events (server_id, created_at DESC);

COMMENT ON TABLE rnpc_spawn_events IS 'Audit log for npcmaxx.spawn RCON commands triggered via TikFinity webhook.';
