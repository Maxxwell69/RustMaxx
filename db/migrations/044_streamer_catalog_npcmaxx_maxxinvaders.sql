-- Streamer TikFinity: MaxxInvaders spawn path (template / outfit / anchor in URL or connection).
INSERT INTO streamer_platform_action_catalog (action_key, is_active, label) VALUES
  ('maxxinvaders', true, 'MaxxInvaders Roaming spawn (template, outfit, anchor)')
ON CONFLICT (action_key) DO NOTHING;
