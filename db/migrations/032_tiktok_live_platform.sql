-- Direct TikTok Live ingestion + boards + analytics.

CREATE TABLE IF NOT EXISTS tiktok_live_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  platform_user_id text,
  platform_username text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
  worker_session_id text,
  last_seen_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, server_id, platform_username)
);

CREATE INDEX IF NOT EXISTS tiktok_live_connections_user_idx
  ON tiktok_live_connections (user_id, status);
CREATE INDEX IF NOT EXISTS tiktok_live_connections_server_idx
  ON tiktok_live_connections (server_id, status);

CREATE TABLE IF NOT EXISTS tiktok_event_boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_kind text NOT NULL CHECK (scope_kind IN ('streamer', 'server', 'admin_template')),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  server_id uuid REFERENCES servers(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tiktok_event_boards_scope_consistency CHECK (
    (scope_kind = 'streamer' AND user_id IS NOT NULL)
    OR (scope_kind = 'server' AND server_id IS NOT NULL)
    OR (scope_kind = 'admin_template')
  )
);

CREATE INDEX IF NOT EXISTS tiktok_event_boards_scope_idx
  ON tiktok_event_boards (scope_kind, user_id, server_id, is_enabled);

CREATE TABLE IF NOT EXISTS tiktok_event_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES tiktok_event_boards(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_key text,
  min_value int NOT NULL DEFAULT 0,
  server_action text NOT NULL,
  message text,
  duration_seconds int NOT NULL DEFAULT 10,
  npc_template_key text,
  cooldown_seconds int NOT NULL DEFAULT 0,
  priority int NOT NULL DEFAULT 0,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tiktok_event_mappings_board_idx
  ON tiktok_event_mappings (board_id, is_enabled, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS tiktok_event_mappings_match_idx
  ON tiktok_event_mappings (event_type, event_key, min_value);

CREATE TABLE IF NOT EXISTS tiktok_live_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'tiktok_live_connector',
  dedupe_key text UNIQUE,
  connection_id uuid REFERENCES tiktok_live_connections(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  board_id uuid REFERENCES tiktok_event_boards(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_name text,
  viewer_name text,
  viewer_unique_id text,
  gift_name text,
  value int NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  matched_mapping_id uuid REFERENCES tiktok_event_mappings(id) ON DELETE SET NULL,
  action_status text NOT NULL DEFAULT 'queued'
    CHECK (action_status IN ('queued', 'processed', 'skipped', 'failed')),
  action_error text,
  action_response text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS tiktok_live_events_server_received_idx
  ON tiktok_live_events (server_id, received_at DESC);
CREATE INDEX IF NOT EXISTS tiktok_live_events_user_received_idx
  ON tiktok_live_events (user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS tiktok_live_events_status_idx
  ON tiktok_live_events (action_status, received_at DESC);

CREATE TABLE IF NOT EXISTS tiktok_event_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES tiktok_live_events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'done', 'failed', 'dead')),
  attempts int NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tiktok_event_jobs_queue_idx
  ON tiktok_event_jobs (status, next_run_at);

CREATE TABLE IF NOT EXISTS tiktok_event_analytics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_name text,
  events_count int NOT NULL DEFAULT 0,
  total_value int NOT NULL DEFAULT 0,
  processed_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day, user_id, server_id, event_type, event_name)
);

CREATE INDEX IF NOT EXISTS tiktok_event_analytics_daily_lookup_idx
  ON tiktok_event_analytics_daily (server_id, day DESC, event_type);

COMMENT ON TABLE tiktok_live_connections IS 'Direct TikTok channel/session links per streamer + server.';
COMMENT ON TABLE tiktok_event_boards IS 'Configurable event-to-action boards.';
COMMENT ON TABLE tiktok_event_mappings IS 'Board mapping rules from incoming event signals to RustMaxx actions.';
COMMENT ON TABLE tiktok_live_events IS 'Append-only normalized TikTok event log with dispatch outcome.';
COMMENT ON TABLE tiktok_event_jobs IS 'Dispatch queue/retry state for direct TikTok events.';
COMMENT ON TABLE tiktok_event_analytics_daily IS 'Daily rollups for TikTok event analytics dashboards.';
