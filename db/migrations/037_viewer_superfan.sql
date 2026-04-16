-- Viewer "superfan" program: site-wide application (staff) then per-streamer approval.

CREATE TABLE IF NOT EXISTS viewer_superfan_site_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_viewer_superfan_site_status ON viewer_superfan_site_applications (status);
CREATE INDEX IF NOT EXISTS idx_viewer_superfan_site_created ON viewer_superfan_site_applications (created_at DESC);

COMMENT ON TABLE viewer_superfan_site_applications IS
  'Viewers apply once; staff approves before they can request access to individual streamers.';

CREATE TABLE IF NOT EXISTS viewer_streamer_superfan_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  streamer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (viewer_user_id, streamer_user_id),
  CHECK (viewer_user_id <> streamer_user_id)
);

CREATE INDEX IF NOT EXISTS idx_superfan_memberships_streamer_status
  ON viewer_streamer_superfan_memberships (streamer_user_id, status);
CREATE INDEX IF NOT EXISTS idx_superfan_memberships_viewer ON viewer_streamer_superfan_memberships (viewer_user_id);

COMMENT ON TABLE viewer_streamer_superfan_memberships IS
  'Per-streamer superfan access; streamer approves after viewer has site-wide approval.';
