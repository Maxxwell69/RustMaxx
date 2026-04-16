-- RustChaos: crocodile solo spawn (owner enables for streamers via platform catalog).
INSERT INTO streamer_platform_action_catalog (action_key, is_active, label) VALUES
  ('crocodile', true, 'Crocodile')
ON CONFLICT (action_key) DO NOTHING;
