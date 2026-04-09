-- Admin-assignable membership tier (three levels); separate from role and Stripe subscription.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS membership_level text NOT NULL DEFAULT 'standard';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_membership_level_check;

ALTER TABLE users
  ADD CONSTRAINT users_membership_level_check
  CHECK (membership_level IN ('standard', 'pro', 'elite'));

COMMENT ON COLUMN users.membership_level IS 'Admin tier: standard (base), pro (mid), elite (top); use for perks/limits.';

CREATE INDEX IF NOT EXISTS idx_users_membership_level ON users(membership_level);
