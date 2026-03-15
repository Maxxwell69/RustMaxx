-- Add optional message and scrap amount to TikFinity connections.

ALTER TABLE tikfinity_connections
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS scrap_amount int NOT NULL DEFAULT 0;

COMMENT ON COLUMN tikfinity_connections.message IS 'Optional custom chat message when this connection triggers (plugin 5th arg)';
COMMENT ON COLUMN tikfinity_connections.scrap_amount IS 'Scrap to give streamer when this connection triggers (0 = none)';
