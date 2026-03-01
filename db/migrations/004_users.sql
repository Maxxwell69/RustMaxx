-- Users and global roles for permission system.
-- Roles: super_admin, admin, moderator, support, streamer, player, guest

CREATE TYPE user_role AS ENUM (
  'super_admin',  -- can make admin
  'admin',        -- can make servers
  'moderator',    -- can create server users
  'support',
  'streamer',
  'player',
  'guest'
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role user_role NOT NULL DEFAULT 'guest',
  display_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

COMMENT ON TABLE users IS 'App users with global role; per-server access in server_users';
COMMENT ON COLUMN users.role IS 'super_admin=make admin, admin=make servers, moderator=create server users';
