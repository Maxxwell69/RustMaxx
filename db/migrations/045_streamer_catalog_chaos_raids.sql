-- RustChaos progressive RandomRaids presets (RustChaos + RandomRaids plugins).

INSERT INTO streamer_platform_action_catalog (action_key, is_active, label) VALUES
  ('chaosraid_easy', true, 'Chaos raid Easy (4 waves → boss)'),
  ('chaosraid_medium', true, 'Chaos raid Medium (8 waves → 2 bosses)'),
  ('chaosraid_hard', true, 'Chaos raid Hard (10 waves + attack heli)')
ON CONFLICT (action_key) DO UPDATE SET
  label = EXCLUDED.label,
  is_active = true;
