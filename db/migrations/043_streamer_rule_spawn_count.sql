-- Solo RustChaos spawns (wolf, bear, scientist, …): repeat RCON once per unit (see spawn_count).
ALTER TABLE streamer_tikfinity_rules
  ADD COLUMN IF NOT EXISTS spawn_count integer NOT NULL DEFAULT 1;

ALTER TABLE streamer_tikfinity_rules
  DROP CONSTRAINT IF EXISTS streamer_tikfinity_rules_spawn_count_check;

ALTER TABLE streamer_tikfinity_rules
  ADD CONSTRAINT streamer_tikfinity_rules_spawn_count_check
  CHECK (spawn_count >= 1 AND spawn_count <= 15);

COMMENT ON COLUMN streamer_tikfinity_rules.spawn_count IS
  'For RustChaos solo animal/scientist spawns: how many entities (1–15); webhook runs rustchaos once per unit. Overridable via ?count= on the hook URL.';
