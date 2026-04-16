# Marketing images & media (optional)

RustMaxx works **without** custom photography: the UI uses the logo, CSS gradients, grid texture, and placeholder components (`DashboardFrame`, etc.).

When you want **Crowd Control–level** polish, add real assets over time. You do **not** need to supply images for the site to function.

## Recommended assets (priority order)

| Asset | Where it helps | Spec notes |
| --- | --- | --- |
| **Product screenshots** | Home hero, Features, Streamer Interaction | PNG or WebP, 2× resolution; crop to ~16:9 or 4:3; dark UI shots read best on our dark theme. |
| **Dashboard / RCON** | Home second column, Features admin section | Real or sanitized server name; blur secrets if needed. |
| **TikFinity or webhook UI** | Streamer pages | Shows gift → action mapping; no API keys in frame. |
| **Streamer directory or profile** | Home, `/streamers` marketing | Public-safe only. |
| **OG image** | Social previews (`opengraph-image` or metadata) | 1200×630 JPG/PNG; logo + short tagline. |

## What we generate in code (no files required)

- Background grid and cyan ambient gradients (`globals.css` + `MarketingLayout`).
- Placeholder frames (`components/marketing/placeholders/`).
- Logo via `components/marketing/Logo` (SVG or image — whatever you already ship).

## How to add screenshots later

1. Put files under `public/marketing/` e.g. `public/marketing/hero-dashboard.webp`.
2. Use Next.js `<Image />` with explicit `width` / `height` (or `fill` in a sized box).
3. Replace placeholder components on specific pages only — keep scope small per PR.

## Stock vs original

- **Original** product UI is strongest for trust (like [Crowd Control](https://crowdcontrol.live/tiktok/) product shots).
- Stock gaming photos are optional; avoid clashing with RustMaxx’s dark + cyan brand.
