# Map feature setup

## Overview

The Map feature fetches **seed**, **world size**, and **level** from your Rust server via RCON, stores them in the database, and can display a map preview image.

- **Map page:** `/servers/:id/map` — shows seed, world size, level, last fetched time, and a preview image.
- **Fetch from RCON:** Use the button to pull live values (requires the server to be reachable via WebRCON).
- **Manual fallback:** If RCON fetch fails or you use a custom map provider, you can paste a map preview URL and save it.

## Shockbyte (and similar) RCON setup

1. **Enable RCON in the Shockbyte panel**
   - In your game server control panel, find the RCON / Console section.
   - Enable RCON and note the **host**, **port**, and **password**. (Shockbyte often uses the same port as the game or a separate RCON port.)

2. **Set host, port, and password in RustMaxx**
   - In RustMaxx, open your server → **Connect** (or ensure the server is added with correct RCON details in the server settings).
   - The server’s RCON host, port, and password are stored when you add or edit the server. Ensure they match the panel.

3. **Confirm with “Fetch from RCON”**
   - Go to **Map** tab for that server.
   - Click **Fetch from RCON**. If the server is online and RCON is correct, seed, world size, and level will appear and the map preview URL will be set (if the provider is configured).

## Environment variables

| Variable | Description |
|----------|-------------|
| `MAP_PREVIEW_PROVIDER` | `rustmaps` (default), `playrust`, or `custom`. Controls how the preview URL is built from seed/size/level. |
| `MAP_PREVIEW_URL_TEMPLATE` | For `custom` provider: URL template with `{seed}`, `{size}` or `{worldSize}`, `{level}`. |
| `MAP_REFRESH_ENABLED` | Set to `true` to allow the background refresh endpoint. Default `false`. |
| `MAP_REFRESH_INTERVAL_HOURS` | Suggested interval for cron (e.g. `6`). Not read by the app; use your cron schedule. |
| `CRON_SECRET` | Secret for calling `POST /api/internal/refresh-maps`. Required if you use the cron endpoint. |

## Background refresh (optional)

To refresh map info for all servers on a schedule (e.g. every 6 hours):

1. Set `MAP_REFRESH_ENABLED=true` and `CRON_SECRET` to a long random string.
2. Call from your cron or scheduler:
   ```bash
   curl -X POST "https://your-rustmaxx-domain.com/api/internal/refresh-maps" \
     -H "Authorization: Bearer YOUR_CRON_SECRET"
   ```
   Or use the header `x-cron-secret: YOUR_CRON_SECRET`.

The endpoint updates map info for every server that has RCON configured. If a server is offline, that server is skipped and the rest continue.
