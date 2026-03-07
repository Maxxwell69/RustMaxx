-- RustMaxx Twitch/Integration schema proposal
-- Run after existing migrations (users, servers, server_users, etc.).
-- This file is a PROPOSAL; apply via migrations when ready.

-- Link a server to the realtime gateway (one connection per server).
CREATE TABLE IF NOT EXISTS server_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  connection_token_hashed text NOT NULL,
  last_heartbeat_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE (server_id)
);

CREATE INDEX IF NOT EXISTS idx_server_connections_server ON server_connections(server_id);

-- Twitch accounts linked to RustMaxx users (for streamer features).
CREATE TABLE IF NOT EXISTS twitch_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  twitch_user_id text NOT NULL,
  twitch_login text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  linked_at timestamptz DEFAULT now(),
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

-- Event rules: when Twitch event X happens, run whitelist action Y on server Z.
CREATE TABLE IF NOT EXISTS event_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_connection_id uuid NOT NULL REFERENCES server_connections(id) ON DELETE CASCADE,
  event_kind text NOT NULL,
  action_id text NOT NULL,
  action_params jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_rules_connection ON event_rules(server_connection_id);

-- Event log (incoming Twitch events, for audit and debugging).
CREATE TABLE IF NOT EXISTS event_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_connection_id uuid REFERENCES server_connections(id) ON DELETE SET NULL,
  event_kind text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_logs_created ON event_logs(created_at DESC);

-- Command log (whitelist commands sent to plugin / acks).
CREATE TABLE IF NOT EXISTS command_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_connection_id uuid REFERENCES server_connections(id) ON DELETE SET NULL,
  command_id text NOT NULL,
  action_id text NOT NULL,
  payload jsonb,
  status text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_command_logs_created ON command_logs(created_at DESC);
