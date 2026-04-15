-- Last login tracking, public streamer directory fields, owner kick (revoked) on access requests.

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS streamer_directory_visible boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS streamer_directory_avatar_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS streamer_directory_bio text;

COMMENT ON COLUMN users.last_login_at IS 'Updated on each successful password login.';
COMMENT ON COLUMN users.streamer_directory_visible IS 'When true, user may appear on public /streamers (API also requires approved streamer application).';
COMMENT ON COLUMN users.streamer_directory_avatar_url IS 'Public directory / profile image URL (https).';
COMMENT ON COLUMN users.streamer_directory_bio IS 'Short public bio for /streamers/[id].';

ALTER TABLE streamer_server_requests DROP CONSTRAINT IF EXISTS streamer_server_requests_status_check;

ALTER TABLE streamer_server_requests
  ADD CONSTRAINT streamer_server_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'revoked'));

COMMENT ON COLUMN streamer_server_requests.status IS 'revoked = owner removed access after approve (kick).';
