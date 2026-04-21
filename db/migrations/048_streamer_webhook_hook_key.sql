-- Opaque hook_key: single pasteable TikFinity URL (path is the secret; no ?token=).
-- Legacy: /api/tikfinity/hooks/{uuid}?token= still supported.

ALTER TABLE streamer_webhooks ADD COLUMN IF NOT EXISTS hook_key text;

-- Use core gen_random_uuid() (PG 13+) — avoids pgcrypto / gen_random_bytes on hosts without that extension.
UPDATE streamer_webhooks
SET hook_key = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
WHERE hook_key IS NULL;

ALTER TABLE streamer_webhooks ALTER COLUMN hook_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_streamer_webhooks_hook_key ON streamer_webhooks (hook_key);

COMMENT ON COLUMN streamer_webhooks.hook_key IS '64-char hex; unique URL segment — authenticates webhook without query token';
