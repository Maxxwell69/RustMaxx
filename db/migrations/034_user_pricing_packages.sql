-- Allow assigning multiple current pricing packages to a user from admin.

CREATE TABLE IF NOT EXISTS user_pricing_packages (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_kind text NOT NULL CHECK (package_kind IN ('server', 'streamer', 'combo')),
  tier_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, package_kind, tier_key)
);

CREATE INDEX IF NOT EXISTS user_pricing_packages_user_idx
  ON user_pricing_packages (user_id);
