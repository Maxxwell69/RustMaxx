-- Optional signup intent: viewer / superfan (per-streamer approval flow).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS signup_interested_fan boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.signup_interested_fan IS 'User indicated viewer/superfan use case at registration.';
