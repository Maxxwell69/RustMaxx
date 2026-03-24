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

Sends RCON `maxxinvaders.spawn` using **MaxxInvaders** + RoamingNPCs (set **`ViewerRoamingTemplateKey`** in `oxide/config/MaxxInvaders.json`). Defaults: **`tier=1`**, **`mode=roaming`**, **`kit=-`**. Query string (`tier`, `mode`, `kit`) overrides JSON body.

```bash
curl -sS "https://www.rustmaxx.com/api/tikfinity/webhook?action=maxxinvaders&tier=2&mode=roaming&kit=-" \
  -X POST -H "Content-Type: application/json" \
  -d "{\"viewerName\":\"CurlTest\",\"uniqueId\":\"tiktok_test_uid_123\"}"
```

With **`NPCMAXX_REQUIRE_CREW_REGISTRY`** on, include TikTok **`uniqueId`** or **`userId`** and register the viewer like npcmaxx. Connection event names **`maxxinvaders`**, **`invaders`**, and **`invader`** map to this action.

Webhook spawns have **no in-game streamer anchor**; patrol/bodyguard tied to the streamer’s Steam ID need an in-game spawn path.

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
