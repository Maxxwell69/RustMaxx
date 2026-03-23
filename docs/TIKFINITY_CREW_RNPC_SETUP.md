# TikFinity + crew registry + Roaming NPC — setup & testing

Step-by-step to get webhooks, crew (subscriber) registration, and `npcmaxx.spawn` working end-to-end.

**Production site:** `https://rustmaxx.com` — set `APP_URL` to this (no trailing slash) unless you use another host.

---

## 1. Prerequisites

- A **RustMaxx** deployment (e.g. Railway) with **Postgres** linked.
- Your **Rust game server** reachable from the internet with **RCON** (RustMaxx cannot use `localhost` for the game server from the cloud).
- **Oxide** on the game server with plugins:
  - **RoamingNPCs** (with your bot templates in config)
  - **NPCMaxx** (RCON bridge: `npcmaxx.spawn <templateKey> <displayName>`)

---

## 2. Environment variables (Railway or `.env`)

Set on the **RustMaxx web** service:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Usually auto-set when Postgres is linked. |
| `ADMIN_PASSWORD` | Admin login. |
| `SESSION_SECRET` | Long random string for cookies. |
| `APP_URL` | `https://rustmaxx.com` — public base URL so admin shows correct webhook URLs. |
| `TIKFINITY_SERVER_ID` | **UUID of the server row** in RustMaxx (see step 4). |
| `CREW_RNPC_TEMPLATE_KEY` | *(Optional)* RoamingNPCs **`bots`** key (e.g. `bob_resources_farmer`). If set, a viewer’s **first** successful crew join also runs `npcmaxx.spawn` for that viewer. |
| `NPCMAXX_REQUIRE_CREW_REGISTRY` | *(Optional)* Set to `true` so **gift/connection** `npcmaxx` webhooks only run if that TikTok user id is already in the **crew registry** (joined via `?event=join` first). Requires `userId` / `uniqueId` in the payload. |

### Template key (what to put in `CREW_RNPC_TEMPLATE_KEY`)

It must match a **key** under **`"Bots settings"`** in your RoamingNPCs JSON on the **game server** (same structure as the reference file in this repo).

**Reference config in this repo:** [`plugins/RoamingNpc/config/RoamingNPCs.json`](../plugins/RoamingNpc/config/RoamingNPCs.json) — see also [`plugins/RoamingNpc/config/README.md`](../plugins/RoamingNpc/config/README.md).

**Template keys in that file** (copy the string exactly):

| Key | Notes |
|-----|--------|
| `bob_resources_farmer` | Default gather/resource bot |
| `john_looter` | Looter preset |
| `alfred_hunter` | Hunter preset |
| `austin_fighter` | Fighter preset |

Wrong key or disabled bot → `npcmaxx.spawn` fails on the server.

Redeploy after changing env vars.

---

## 3. Run database migrations

Migrations add TikFinity tables, `rnpc_spawn_events`, `crew_rnpc_registrations`, etc.

**Option A — Railway dashboard:** open your **RustMaxx** service → **Shell** → run:

```bash
npm run migrate
```

**Option B — from your PC** with a **public** Postgres URL (not `postgres.railway.internal`):

```bash
set DATABASE_URL=postgresql://...public...
npm run migrate
```

**Option C — Railway CLI** (only works if `railway run` injects a URL your PC can reach; often you need the public proxy URL from Postgres → Connect).

---

## 4. Set `TIKFINITY_SERVER_ID`

1. Log into RustMaxx → **Servers**.
2. Open the Rust server that should receive **TikFinity / RCON** commands.
3. Copy the **UUID from the browser URL**:  
   `https://rustmaxx.com/servers/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
4. In Railway → Variables →  
   `TIKFINITY_SERVER_ID` = that UUID (no quotes).

This must match the server whose RCON settings you configured in RustMaxx.

---

## 5. Verify RCON on the game server

1. In RustMaxx, open that server → **Connect** (RCON).
2. In the console/command area, run a harmless command (e.g. `status` or `oxide.version`).
3. If connection fails, fix host/port/password/firewall **before** testing webhooks.

---

## 6. Test Roaming NPC on the server (no website yet)

In **server RCON** (F1 or RustMaxx console), with a real template key from RoamingNPCs config:

```text
npcmaxx.spawn YOUR_TEMPLATE_KEY TestBot
```

- Success → NPCMaxx + RoamingNPCs are wired.
- Failure → fix template name, plugins, or config first.

---

## 7. Test RustMaxx → RCON

Same command through RustMaxx’s server console/RCON for that server. If it fails here but works in F1, check that RustMaxx is using the same RCON host/port/password.

---

## 8. Test TikFinity webhook (Roaming NPC)

Use the URL shown in **Admin → Streamer interactions** (base: `https://rustmaxx.com/api/tikfinity/webhook` when `APP_URL` is set).

**POST** (replace template key):

```http
POST https://rustmaxx.com/api/tikfinity/webhook?action=npcmaxx&template=YOUR_TEMPLATE_KEY
Content-Type: application/json

{"viewerName": "TestViewer"}
```

Expect JSON with `"ok": true` and a `command` like `npcmaxx.spawn ...`.

**Admin → Roaming NPC spawns (webhook log)** should show a row.

---

## 9. Test crew subscriber registry (join)

1. In **Admin → Streamer interactions**, use **Copy join URL** or:  
   `https://rustmaxx.com/api/tikfinity/webhook?event=join`
2. Expand **Test crew registration (PowerShell)** and run the sample against your live URL, or:

```powershell
$body = '{"teamMember":true,"userId":"YOUR_TIKTOK_UNIQUE_ID","viewerName":"YourName"}'
Invoke-RestMethod -Uri "https://rustmaxx.com/api/tikfinity/webhook?event=join" `
  -Method POST -ContentType "application/json; charset=utf-8" -Body $body
```

- First call: `"registered": true`
- Second call with same `userId`: `"alreadyRegistered": true`
- **Crew subscribers (RNPC registry)** table lists the row until you remove it.

**Note:** Real TikFinity join payloads must include **crew/subscriber flags** and a **stable viewer id**; see `lib/tikfinity-crew.ts` for recognized fields.

---

## 10. Configure TikFinity

1. **Spawn roaming NPC on a trigger (gift, goal, etc.):** In RustMaxx **Admin → Streamer interactions**, use **Spawn roaming NPC — TikFinity trigger → bot on server**: pick the template key, click **Copy spawn URL**, and paste that **full URL** (includes `?action=npcmaxx&template=...`) into TikFinity → New Action → **Trigger WebHook**. When the action fires, the webhook runs and your server receives `npcmaxx.spawn`.
2. **Gifts / RustChaos:** use the per-action URL chips (e.g. `?action=wolf`) or **TikFinity connections** (event name → server action).
3. **Viewer joined LIVE:** separate action → URL with `?event=join` (crew registry).
4. If **NPCMAXX_REQUIRE_CREW_REGISTRY** is on, roaming spawns only work for viewers already in the crew registry; include `userId` / `uniqueId` in TikFinity payloads.

---

## 11. Full pipeline (how it fits together)

1. **Crew join** (`?event=join`) + subscriber payload + TikTok id → row in **Crew subscribers** table (once per id).
2. If **`CREW_RNPC_TEMPLATE_KEY`** is set → same request also sends `npcmaxx.spawn <key> <viewer>` (first registration only; duplicates get `alreadyRegistered` with no second spawn from join).
3. **Gifts / other webhooks** mapped to **Roaming NPC** use the template from the TikFinity connection or `?template=`.
4. If **`NPCMAXX_REQUIRE_CREW_REGISTRY=true`**, those `npcmaxx` triggers only run if the viewer is already in the crew table (join first, gifts after).

**Admin → Streamer interactions** shows whether the two optional env flags are active.

---

## 12. Quick checklist

- [ ] Migrations applied (`npm run migrate`)
- [ ] `APP_URL=https://rustmaxx.com` (or your real public URL)
- [ ] `TIKFINITY_SERVER_ID` = server UUID from `/servers/[id]`
- [ ] (Optional) `CREW_RNPC_TEMPLATE_KEY` = valid Roaming `bots` key
- [ ] (Optional) `NPCMAXX_REQUIRE_CREW_REGISTRY=true` if gifts should require prior crew join
- [ ] RCON works from RustMaxx to the game server
- [ ] `npcmaxx.spawn` works in RCON
- [ ] Webhook test returns `ok` and spawn log updates
- [ ] Crew PowerShell test registers once, then `alreadyRegistered`; if crew template env is set, check `npcSpawn` in JSON and in-game bot
- [ ] TikFinity actions point at the URLs you copied from admin

---

## 13. Troubleshooting

| Symptom | What to check |
|--------|----------------|
| `TIKFINITY_SERVER_ID not set` | Env on the **web** service, redeploy. |
| `TikFinity server not found` | UUID must match a server in **Servers** list. |
| `postgres.railway.internal` when migrating locally | Use **public** `DATABASE_URL` or Railway **Shell**. |
| Crew test always `not_crew_subscriber` | Payload missing flags; add `teamMember` / `isSubscriber` or adjust TikFinity. |
| `missing_tiktok_unique_id` | Include `userId` or `uniqueId` in JSON. |
| `not_in_crew_registry` on `npcmaxx` | Turn off `NPCMAXX_REQUIRE_CREW_REGISTRY` or register the viewer with the `?event=join` crew webhook first. |
| Crew join returns `npcSpawn.ok: false` | RCON/template issue; verify `CREW_RNPC_TEMPLATE_KEY` matches a real `bots` key and NPCMaxx loads. |
| RCON 502 from webhook | RCON connect failed; test **Connect** in dashboard first. |

**Webhook not working?** See [TIKFINITY_WEBHOOK_DEBUG.md](./TIKFINITY_WEBHOOK_DEBUG.md).

For deeper Railway notes, see [RAILWAY_DEPLOY.md](../RAILWAY_DEPLOY.md).
