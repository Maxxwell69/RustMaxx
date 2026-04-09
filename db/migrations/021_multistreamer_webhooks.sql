-- Allow multiple TikFinity webhook rows per streamer (one per server).

ALTER TABLE streamer_webhooks DROP CONSTRAINT IF EXISTS streamer_webhooks_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_streamer_webhooks_user_server
  ON streamer_webhooks (user_id, server_id);

COMMENT ON TABLE streamer_webhooks IS 'Per-streamer per-server TikFinity URL (public_id) + bcrypt secret; rules hang off streamer_webhook_id.';
