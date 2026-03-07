-- Twitch integration: accounts, streamer-server links, event rules, event logs.
-- Requires: users (004), servers (001, 006).

-- Twitch accounts linked to RustMaxx users (broadcaster identity + encrypted tokens).
CREATE TABLE IF NOT EXISTS twitch_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  twitch_user_id text NOT NULL,
  twitch_login text,
  twitch_display_name text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  linked_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id),
  UNIQUE (twitch_user_id)
);

CREATE INDEX IF NOT EXISTS idx_twitch_accounts_user ON twitch_accounts(user_id);

-- Which servers a streamer has linked for Twitch-driven actions.
CREATE TABLE IF NOT EXISTS streamer_server_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, server_id)
);

CREATE INDEX IF NOT EXISTS idx_streamer_server_links_user ON streamer_server_links(user_id);
CREATE INDEX IF NOT EXISTS idx_streamer_server_links_server ON streamer_server_links(server_id);

-- Event rules: when Twitch event X happens, run whitelist action Y (optionally scoped to server).
CREATE TABLE IF NOT EXISTS event_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id uuid REFERENCES servers(id) ON DELETE CASCADE,
  event_kind text NOT NULL,
  action_id text NOT NULL,
  action_params jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_rules_user ON event_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_event_rules_server ON event_rules(server_id);

-- Event log (incoming Twitch events); twitch_message_id for dedup.
CREATE TABLE IF NOT EXISTS event_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_kind text NOT NULL,
  twitch_message_id text,
  payload jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_logs_twitch_message_id ON event_logs(twitch_message_id) WHERE twitch_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_logs_user_created ON event_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_logs_created ON event_logs(created_at DESC);

COMMENT ON TABLE twitch_accounts IS 'Linked Twitch broadcaster; tokens stored encrypted';
COMMENT ON TABLE event_rules IS 'Map Twitch event kind to whitelist action (e.g. follow -> broadcast)';
COMMENT ON TABLE event_logs IS 'Normalized Twitch events for audit; twitch_message_id prevents duplicate processing';
