-- Sign-up role intent: used to surface onboarding (e.g. streamer application) on first profile visit.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS signup_interested_server_owner boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS signup_interested_streamer boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.signup_interested_server_owner IS 'User indicated server owner use case at registration.';
COMMENT ON COLUMN users.signup_interested_streamer IS 'User indicated streamer use case at registration; drives profile onboarding.';
