-- Streamer network: Steam link, Stripe billing, per-streamer TikFinity hooks and rules.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS steam_id text,
  ADD COLUMN IF NOT EXISTS steam_linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'inactive';

COMMENT ON COLUMN users.steam_id IS 'Steam64 from OpenID; unique when set';
COMMENT ON COLUMN users.subscription_status IS 'inactive|trialing|active|canceled|past_due';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_steam_id ON users(steam_id) WHERE steam_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- One TikFinity webhook endpoint per streamer (v1): picks one RustMaxx-managed server.
CREATE TABLE IF NOT EXISTS streamer_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE RESTRICT,
  public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  secret_hash text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_streamer_webhooks_public_id ON streamer_webhooks(public_id);
CREATE INDEX IF NOT EXISTS idx_streamer_webhooks_server ON streamer_webhooks(server_id);

COMMENT ON TABLE streamer_webhooks IS 'Per-streamer TikFinity URL segment + bcrypt webhook secret';

-- Event name → whitelisted action (same idea as tikfinity_connections, scoped to hook).
CREATE TABLE IF NOT EXISTS streamer_tikfinity_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  streamer_webhook_id uuid NOT NULL REFERENCES streamer_webhooks(id) ON DELETE CASCADE,
  name text NOT NULL,
  server_action text NOT NULL,
  message text,
  scrap_amount integer NOT NULL DEFAULT 0,
  npc_template_key text,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_streamer_tikfinity_rules_name
  ON streamer_tikfinity_rules(streamer_webhook_id, lower(trim(name)));

CREATE INDEX IF NOT EXISTS idx_streamer_tikfinity_rules_hook ON streamer_tikfinity_rules(streamer_webhook_id);

COMMENT ON TABLE streamer_tikfinity_rules IS 'Streamer-defined TikFinity event name → RCON action (whitelist)';
