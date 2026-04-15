-- Per-server and per-streamer billing tiers (Stripe checkout + webhook update these).

ALTER TABLE servers ADD COLUMN IF NOT EXISTS billing_tier text NOT NULL DEFAULT 'free';
ALTER TABLE servers DROP CONSTRAINT IF EXISTS servers_billing_tier_check;
ALTER TABLE servers ADD CONSTRAINT servers_billing_tier_check
  CHECK (billing_tier IN ('free', 'pro', 'analytics'));

ALTER TABLE servers ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
COMMENT ON COLUMN servers.billing_tier IS 'free=public list only; pro=streamer interactions; analytics=+server analytics (coming soon)';
COMMENT ON COLUMN servers.stripe_subscription_id IS 'Stripe subscription id for this server''s paid tier (one sub per server).';

ALTER TABLE users ADD COLUMN IF NOT EXISTS streamer_tier text NOT NULL DEFAULT 'free';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_streamer_tier_check;
ALTER TABLE users ADD CONSTRAINT users_streamer_tier_check
  CHECK (streamer_tier IN ('free', 'plus', 'max'));

COMMENT ON COLUMN users.streamer_tier IS 'TikFinity webhook slots: free=5, plus=12, max=25; Stripe updates this.';

-- Existing paying streamers (legacy single subscription on user): grant mid tier for webhook headroom.
UPDATE users
SET streamer_tier = 'plus'
WHERE streamer_tier = 'free'
  AND subscription_status IN ('active', 'trialing')
  AND stripe_subscription_id IS NOT NULL;
