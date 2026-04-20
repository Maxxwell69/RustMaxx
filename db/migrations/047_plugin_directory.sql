-- Public directory of RustMaxx-developed Oxide plugins (admin-managed).

CREATE TABLE IF NOT EXISTS plugin_directory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  tagline TEXT,
  description TEXT,
  marketing_href TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plugin_directory_published_sort
  ON plugin_directory (published, sort_order, title);

INSERT INTO plugin_directory (slug, title, tagline, description, marketing_href, sort_order, published)
VALUES (
  'maxxinvaders',
  'MaxxInvaders',
  'Viewer-linked NPCs for Rust — TikFinity, webhooks, RoamingNPCs bridge, INVADERS HUD.',
  'Rust (Oxide) plugin: spawn viewer-named scientists or full Roaming NPC bots from TikFinity / RCON. Patrol, gather, protect, deposit-to-storage, and a streamer-facing INVADERS HUD. Works with RoamingNPCs when available.',
  '/maxxinvaders',
  0,
  true
)
ON CONFLICT (slug) DO NOTHING;
