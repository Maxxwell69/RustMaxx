-- Allow streamer TikFinity hooks for newer RustChaos solo actions (intersection with STREAMER_BASE_ACTION_KEYS).
INSERT INTO streamer_platform_action_catalog (action_key, is_active, label) VALUES
  ('chicken', true, 'Chicken'),
  ('scientistflame', true, 'Flame scientist'),
  ('pistolammo50', true, '50 pistol ammo')
ON CONFLICT (action_key) DO NOTHING;
