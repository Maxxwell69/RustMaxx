-- RustChaos TikTok status effects (streamer policy ∩ platform catalog).
INSERT INTO streamer_platform_action_catalog (action_key, is_active, label) VALUES
  ('statusgodmode', true, 'Streamer: Time God Mode'),
  ('statusbullethell', true, 'Streamer: Bullet Hell'),
  ('statusflippers', true, 'Streamer: Flippers'),
  ('statusflash', true, 'Streamer: Flash (sprint)'),
  ('statushealthx3', true, 'Streamer: Health x3')
ON CONFLICT (action_key) DO NOTHING;
