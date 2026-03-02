-- Each user has their own server list (owner_id). Servers are isolated per user.

ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_servers_owner ON servers (owner_id);

-- Backfill: assign existing servers to the first super_admin so they are not orphaned
UPDATE servers
SET owner_id = (SELECT id FROM users WHERE role = 'super_admin' ORDER BY created_at ASC LIMIT 1)
WHERE owner_id IS NULL;

COMMENT ON COLUMN servers.owner_id IS 'User who owns this server; only they can see and manage it';
