# TikFinity webhook not working — debug checklist

Work through these in order. Most issues are **wrong URL**, **TIKFINITY_SERVER_ID**, **RCON**, or **payload** (crew gate / template).

**Host must match `APP_URL`:** If production uses **`www`** (e.g. `https://www.rustmaxx.com`), TikFinity and curl must use that exact origin — apex (`https://rustmaxx.com`) and `www` are different URLs.

---

## 1. Confirm RustMaxx is reachable

From your PC (replace with your real host — same as **Admin → Streamer interactions**):

```bash
curl -sS "https://www.rustmaxx.com/api/tikfinity/webhook?action=likes" -X POST -H "Content-Type: application/json" -d "{\"viewerName\":\"Test\"}"
```

You should get JSON (e.g. `ok` or `skipped`). If you get **HTML**, **502**, or **timeout**, fix hosting/DNS/SSL first.

---

## 2. Admin diagnostics (logged in)

While logged in as **admin**, open (same browser session):

```text
https://www.rustmaxx.com/api/tikfinity/diagnostics
```

Optional RCON connectivity test (slow, a few seconds):

```text
https://www.rustmaxx.com/api/tikfinity/diagnostics?probeRcon=1
```

Check:

- `tikfinityServerId` = `configured`
- `tikfinityServerIdMatchesServer` = `true`
- `server` has `rconHostSet` / `rconPortSet` = true
- `webhookUrl` is your public HTTPS URL
- `rconProbe.ok` = `true` when using `probeRcon=1`

If `tikfinityServerIdMatchesServer` is **false**, the env UUID does not match any row in **Servers** — fix `TIKFINITY_SERVER_ID`.

---

## 3. RCON from the dashboard (before blaming TikFinity)

RustMaxx → **Servers** → your server → **Connect** → run `status` or `oxide.version`.

If Connect fails here, webhooks will fail too — fix **host / port / password / firewall** first.

---

## 4. Test the same path as TikFinity (spawn NPC)

Use the **Copy spawn URL** URL from **Admin → Streamer interactions** (includes `?action=npcmaxx&template=...`).

```bash
curl -sS "https://www.rustmaxx.com/api/tikfinity/webhook?action=npcmaxx&template=bob_resources_farmer" ^
  -X POST -H "Content-Type: application/json" ^
  -d "{\"viewerName\":\"CurlTest\"}"
```

- **`ok: true`** + `command` → RustMaxx sent RCON; check **game server** console for `[NPCMaxx]` / RoamingNPCs errors.
- **`502`** + `rcon_connect` → RCON from RustMaxx to the game server failed.
- **`skipped` / `not_in_crew_registry`** → Turn off `NPCMAXX_REQUIRE_CREW_REGISTRY` or register the viewer with `?event=join` first and send `userId` in TikFinity payloads.

### MaxxInvaders viewer spawn (`action=maxxinvaders`)

Sends RCON `maxxinvaders.spawn` with the **viewer’s display name** on the bot (so the NPC shows the TikTok viewer’s name). Pass the name in JSON **`viewerName`**, or use **`?viewerName=...`** in the URL (TikFinity can map a variable into the query string).

**Roaming template:** defaults to **`streamer_patrol`**. Override with **`?template=your_bot_key`** or JSON **`template`** / **`roamingTemplate`**, or a TikFinity connection (server action MaxxInvaders) with a Roaming template. Other defaults: **`tier=1`**, **`mode=roaming`**, **`kit=-`**.

**Stay near streamer / base (easiest):** in RustMaxx go to **Servers → [TIKFINITY_SERVER_ID server] → TikFinity patrol anchor** and save your **Steam64** once — no `?anchorSteam=` in the TikFinity URL. Resolution order: JSON **`anchorSteam`** → **`?anchorSteam=`** → **server dashboard field** → env **`TIKFINITY_MAXXINVADERS_ANCHOR_STEAM_ID`**. That Steam account must be **online or sleeping** on the server. Tune **`MaxDistanceFromAnchor`** in `MaxxInvaders.json` to tighten the patrol area. **MaxxInvaders 1.5.9+** refreshes the patrol center from the anchor player’s **current** position each tick while they are online (so the leash follows you; older builds only used the position at spawn time).

**RoamingNPCs 0.5.10+ (RustMaxx `RoamingNPCs.cs`):** bridge spawns with a non-zero anchor Steam id **always** set `BridgeProtectAnchorUserId` and turn on **Bridge patrol** + **protect anchor** when the template omitted those flags — otherwise the bot kept **full roam AI** and looked like it was “running away” from you.

**0.5.11+:** **Friendly** personality bots **flee players** (`RunAwayCoroutine`) — that fights patrol and causes **flee + leash zip** loops. For MaxxInvaders bridge spawns with an anchor, that flee path is **skipped** (target cleared / no run-away) so **BridgePatrol** can drive movement instead.

**0.5.12+:** For the same bridge + anchor spawns, **Hunter** (chase animals) and **Researcher** (monument visits) brain states are **disabled** so NPCs do not path to **far** animals or **monuments**. They still use **BridgePatrol** (radius in `streamer_patrol` → `BridgePatrol`), **Miner** (gather within controller radius), **Dropped**, etc. Tighten **`BridgePatrol.RadiusMeters`** and **`Controller` → find radius** in `RoamingNPCs.json` for your `streamer_patrol` template to keep activity local.

**0.5.13+:** On plugin load, persisted keys like **`streamer_patrol_anon_…`** (MaxxInvaders bridge dynamic keys) are recognized and removed **without** the “Bot config not found” warning — they are not separate `Bots settings` entries.

Ensure **`streamer_patrol`** exists in `RoamingNPCs.json` and **`"Enable bot?": true`**.

```bash
curl -sS "https://www.rustmaxx.com/api/tikfinity/webhook?action=maxxinvaders&viewerName=CurlTest" \
  -X POST -H "Content-Type: application/json" \
  -d "{\"uniqueId\":\"tiktok_test_uid_123\"}"
```

With **`NPCMAXX_REQUIRE_CREW_REGISTRY`** on, include TikTok **`uniqueId`** or **`userId`** and register the viewer like npcmaxx. Connection event names **`maxxinvaders`**, **`invaders`**, and **`invader`** map to this action.

**If Streamer Patrol “used to work” and stopped:** read the JSON response body from one trigger.

| Response | Likely cause |
|----------|----------------|
| `ok: false`, `skipped`, `missing_tiktok_unique_id` | Crew gate on but TikFinity no longer sends `userId` / `uniqueId` — fix payload mapping or disable crew gate. |
| `ok: false`, `skipped`, `not_in_crew_registry` | Viewer not in crew table — they must use `?event=join` first, or relax the gate. |
| `ok: false`, `502`, `step: rcon_connect` | RustMaxx cannot reach RCON — host/port/password / firewall / WebRCON port. |
| `ok: false`, `502`, `rconResponse` with `Error:` | Game/plugin rejected spawn — check **`streamer_patrol`** exists, **Enable bot?** true, MaxxInvaders + RoamingNPCs loaded. |
| `ok: true` but wrong bot / not patrol | A TikFinity **connection** row may set a different **Roaming template** for that event, or you added **`?template=`** pointing at another bot. Remove override or set template to `streamer_patrol`. |

Webhook spawns have **no in-game streamer anchor**; patrol/bodyguard tied to the streamer’s Steam ID need an in-game spawn path.

---

## TikFinity URL placeholders (viewer display name)

TikFinity documents these **placeholder parameters** for the user who triggered the event (see [Streamer.bot integration](https://tikfinity.zerody.one/streamerbot-integration) on `tikfinity.zerody.one` — same placeholders apply to **Trigger WebHook** URL / body text in Actions):

| Placeholder | Meaning |
|-------------|---------|
| **`%nickname%`** | TikTok **display name** (what you usually want on the NPC) |
| **`%username%`** | TikTok **@handle** (unique text handle) |
| **`%userId%`** | Numeric TikTok **user id** (use for crew / `uniqueId` style fields) |

**Authentic MaxxInvaders URL (GET or TikFinity-substituted query):**

```text
https://www.rustmaxx.com/api/tikfinity/webhook?action=maxxinvaders&viewerName=%nickname%
```

Use **`%nickname%`** for the viewer’s **visible name** on the bot. Use **`%username%`** only if you want the **@handle** as the name instead.

RustMaxx also reads these JSON fields if you use **POST** with a custom body: `viewerName`, `nickname`, `userName`, `username`, `displayName`, or nested `user` / `viewer` / `sender` objects (see `extractViewerNameFromWebhookBody` in `lib/tikfinity.ts`).

---

## 5. TikFinity-specific issues

| Symptom | What to check |
|--------|----------------|
| Nothing hits RustMaxx | TikFinity action URL wrong; must be **HTTPS** public URL, not localhost. |
| CORS / blocked | TikFinity runs from **tikfinity.zerody.one** — webhook allows that origin. |
| Empty body | TikFinity must send JSON with **viewer** fields if the action needs a name. |
| Works in curl, not in TikFinity | Compare Raw payload in TikFinity; match `action`, `giftName`, or event name to your **connections**. |

---

## 6. Where to read logs

| Place | What you see |
|-------|----------------|
| **Railway** (or host) logs for RustMaxx | `[tikfinity webhook]` lines, stack traces. |
| **Admin → Roaming NPC spawns** | `npcmaxx.spawn` attempts and failures. |
| **Rust game server** F1 / host console | Plugin errors, wrong template key, NPCMaxx messages. |

---

## 7. Quick reference — JSON responses

| Response | Meaning |
|----------|---------|
| `ok: true`, `command` | RCON command was sent. |
| `503` `TIKFINITY_SERVER_ID` | Env not set on the **web** service. |
| `503` server not found | UUID wrong or server deleted from RustMaxx. |
| `502` `rcon_connect` | RustMaxx cannot open WebRCON to the game server. |
| `skipped` `not_in_crew_registry` | Crew gate on; viewer not in registry. |
| `skipped` missing template | npcmaxx URL missing `template=` or connection has no template key. |

See also: [TIKFINITY_CREW_RNPC_SETUP.md](./TIKFINITY_CREW_RNPC_SETUP.md).
