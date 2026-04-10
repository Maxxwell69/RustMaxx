-- Streamer onboarding: detailed application for staff review before promoting to streamer tools.

CREATE TABLE IF NOT EXISTS streamer_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legal_name text NOT NULL,
  preferred_stream_name text NOT NULL,
  tiktok_url text,
  twitch_url text,
  kick_url text,
  youtube_url text,
  twitter_url text,
  instagram_url text,
  discord_username text,
  other_socials text,
  avg_live_viewers text,
  stream_schedule text,
  content_summary text NOT NULL,
  why_rustmaxx text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_streamer_applications_user_id ON streamer_applications (user_id);
CREATE INDEX IF NOT EXISTS idx_streamer_applications_status ON streamer_applications (status);
CREATE INDEX IF NOT EXISTS idx_streamer_applications_created ON streamer_applications (created_at DESC);

COMMENT ON TABLE streamer_applications IS 'One application per user; staff approves before streamer role / tooling.';
