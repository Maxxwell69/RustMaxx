-- Per-server streamer access + platform catalog of actions admins can enable for streamers.
-- Excludes MaxxInvaders/NPCMaxx/RoamingNPC paths and chaos-wave style actions (enforced in app + catalog).

ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS streamer_interactions_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS streamer_allowed_actions text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS streamer_platform_action_catalog (
  action_key text PRIMARY KEY,
  is_active boolean NOT NULL DEFAULT true,
  label text,
  updated_at timestamptz DEFAULT now()
);

-- RustChaos / Squawk-style only (see lib/streamer-action-policy.ts STREAMER_BASE_ACTION_KEYS)
INSERT INTO streamer_platform_action_catalog (action_key, is_active, label) VALUES
  ('test', true, 'Test'),
  ('rose', true, 'Rose'),
  ('smoke', true, 'Smoke'),
  ('fireworks', true, 'Fireworks'),
  ('scientist', true, 'Scientist'),
  ('wolf', true, 'Wolf'),
  ('bear', true, 'Bear'),
  ('tiger', true, 'Tiger'),
  ('panther', true, 'Panther'),
  ('shark', true, 'Shark'),
  ('pig', true, 'Pig'),
  ('supply', true, 'Supply'),
  ('likes', true, 'Likes'),
  ('healinghands', true, 'Healing hands'),
  ('fullheal', true, 'Full heal'),
  ('bunny1', true, 'Bunny costume'),
  ('follow', true, 'Follow (Squawk)'),
  ('share', true, 'Share (Squawk)'),
  ('subscribe', true, 'Subscribe (Squawk)'),
  ('sociallike', true, 'Stream like (Squawk)')
ON CONFLICT (action_key) DO NOTHING;
