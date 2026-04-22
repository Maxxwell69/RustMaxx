-- RustMaxx-made plugins for the public /plugins directory.

INSERT INTO plugin_directory (slug, title, tagline, description, marketing_href, sort_order, published)
VALUES
  (
    'basebotch',
    'BaseBotch',
    'Put NPCs to work at your base — cooking, crafting, meds, and more.',
    'Rust (Oxide) plugin: assign friendly NPCs to handle production chores for your crew, from cooking meals to crafting medical supplies, so you can spend less time on the workbench and more time on the map.',
    NULL,
    1,
    true
  ),
  (
    'rustchaos',
    'RustChaos',
    'Controlled mayhem — residents, survival pressure, and moments built for streamers.',
    'Rust (Oxide) plugin: layers chaos and spectacle onto the server so players battle the world and each other in tense, unpredictable situations — ideal alongside gifts, webhooks, and RustMaxx streamer tooling.',
    NULL,
    2,
    true
  ),
  (
    'maxxraiders',
    'MaxxRaiders',
    'Chaos-linked NPC raids — your base is on the line when the system comes for you.',
    'Rust (Oxide) plugin: ties into the RustChaos ecosystem so hostile NPCs can scout, pressure, and raid player bases — a hard counter to complacency when you want the map to fight back.',
    NULL,
    3,
    true
  )
ON CONFLICT (slug) DO NOTHING;
