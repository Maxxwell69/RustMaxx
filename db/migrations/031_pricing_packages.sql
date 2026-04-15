-- Editable marketing copy for /pricing and GET /api/billing/tiers (Stripe still uses env price IDs + tier_key).

CREATE TABLE IF NOT EXISTS pricing_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_kind text NOT NULL CHECK (package_kind IN ('server', 'streamer')),
  tier_key text NOT NULL,
  name text NOT NULL,
  price_display text NOT NULL DEFAULT '',
  price_usd numeric(10, 2),
  period_display text NOT NULL DEFAULT '',
  billing_note text,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_highlighted boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_kind, tier_key),
  CONSTRAINT pricing_packages_tier_valid CHECK (
    (package_kind = 'server' AND tier_key IN ('free', 'pro', 'analytics'))
    OR (package_kind = 'streamer' AND tier_key IN ('free', 'plus', 'max'))
  )
);

CREATE INDEX IF NOT EXISTS pricing_packages_published_kind_sort_idx
  ON pricing_packages (is_published, package_kind, sort_order);

COMMENT ON TABLE pricing_packages IS 'Public pricing cards; super_admin edits via /admin/pricing-packages.';

INSERT INTO pricing_packages (
  package_kind, tier_key, name, price_display, price_usd, period_display, billing_note, features, is_highlighted, sort_order
) VALUES
(
  'server', 'free', 'Free', '$0', 0, '', 'Per server',
  '["Listed on the public server list"]'::jsonb, false, 10
),
(
  'server', 'pro', 'Pro', '$19.99', 19.99, '/mo', 'Per server',
  '["Everything in Free", "Streamer interaction (TikFinity) enabled on this server"]'::jsonb, true, 20
),
(
  'server', 'analytics', 'Analytics', '$29.99', 29.99, '/mo', 'Per server',
  '["Everything in Pro", "Server analytics dashboard (coming soon)"]'::jsonb, false, 30
),
(
  'streamer', 'free', 'Free', '$0', 0, '', 'Per account',
  '["Up to 5 TikFinity server webhooks"]'::jsonb, false, 10
),
(
  'streamer', 'plus', 'Plus', '$19.99', 19.99, '/mo', 'Per account',
  '["Up to 12 server webhooks"]'::jsonb, true, 20
),
(
  'streamer', 'max', 'Max', '$39.99', 39.99, '/mo', 'Per account',
  '["Up to 25 server webhooks", "More viewer-based perks — coming soon"]'::jsonb, false, 30
)
ON CONFLICT (package_kind, tier_key) DO NOTHING;
