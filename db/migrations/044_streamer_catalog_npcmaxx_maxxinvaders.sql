-- Allow server owners to grant streamer TikFinity hooks for Roaming / MaxxInvaders spawns (intersection with STREAMER_BASE_ACTION_KEYS).
INSERT INTO streamer_platform_action_catalog (action_key, is_active, label) VALUES
  ('npcmaxx', true, 'Roaming NPC spawn (NPCMaxx / template in URL or connection)'),
  ('maxxinvaders', true, 'MaxxInvaders spawn (template, outfit, anchor)')
ON CONFLICT (action_key) DO NOTHING;
