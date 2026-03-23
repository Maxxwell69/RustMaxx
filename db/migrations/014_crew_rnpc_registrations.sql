-- TikTok LIVE crew (subscriber) viewers who joined the stream and were registered for Roaming NPC eligibility (deduped per server + TikTok unique id).

CREATE TABLE IF NOT EXISTS crew_rnpc_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  tiktok_unique_id text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (server_id, tiktok_unique_id)
);

CREATE INDEX IF NOT EXISTS idx_crew_rnpc_registrations_server_created
  ON crew_rnpc_registrations (server_id, created_at DESC);

COMMENT ON TABLE crew_rnpc_registrations IS 'Crew/subscriber viewers registered on stream join for RNPC; one row per TikTok unique id until removed.';
