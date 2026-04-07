# TikFinity → RustMaxx webhook (complete)

This document is the end-to-end reference for wiring **TikFinity** to your **Rust** server through **RustMaxx** (RCON + whitelisted actions).

## 1. Webhook URL (what you paste in TikFinity)

Replace the host with your real public site (must match **`APP_URL`**, including `www` if you use it):

```text
https://www.rustmaxx.com/api/tikfinity/webhook
```

TikFinity is allowed to call this URL from the browser (CORS is set for `https://tikfinity.zerody.one`). Server-to-server POST is also fine.

## 2. Required environment (RustMaxx host)

| Variable | Purpose |
|----------|---------|
| `APP_URL` | Exact public origin, e.g. `https://www.rustmaxx.com` (no trailing slash). Used for correct links in admin. |
| `TIKFINITY_SERVER_ID` | UUID of the server row in RustMaxx (**Servers** → open server → copy id from URL `/servers/<uuid>`). The webhook always targets this server’s RCON. |
| `DATABASE_URL` | Postgres (migrations include `tikfinity_connections`, etc.). |

Optional:

| Variable | Purpose |
|----------|---------|
| `NPCMAXX_REQUIRE_CREW_REGISTRY` | `true` → `npcmaxx` / `maxxinvaders` only if viewer is in crew registry (`?event=join` first). |
| `CREW_RNPC_TEMPLATE_KEY` | RoamingNPCs bot key for auto-spawn on first crew join. |
| `TIKFINITY_MAXXINVADERS_ANCHOR_STEAM_ID` | Default anchor Steam64 for MaxxInvaders. |

## 3. How RustMaxx decides which action to run

Resolution order:

1. **Query string `?action=...`** (highest priority)  
   Example: `.../webhook?action=bunny1`  
   Works with **GET** or **POST** (empty body OK).

2. **JSON body explicit fields**  
   - `action`, `actionName`, or `event` set to a whitelisted action (e.g. `bunny1`, `wolf`).  
   - Leading `!` is ignored: `bunny1` and `!bunny1` are the same.

3. **Admin “TikFinity connection”** (Streamer interactions)  
   TikFinity sends a **name** that matches the connection row (case-insensitive; leading `!` stripped).  
   The row’s **server action** (e.g. `bunny1`) is executed.

4. **Gift name mapping**  
   Body fields such as `giftName`, `gift_name`, `gift`, `giftType` (flat or under `data` / `event` / `payload`) are mapped via the default gift table.  
   If the value looks like a chat command (`!bunny1` or `bunny1`), the **first token** is also checked as an action name.

5. **Chat-style fields** (fixes `!bunny1` from TikTok chat)  
   If steps 1–4 did not set an action, the server reads the **first word** from any of these string fields (root or nested under `data`, `event`, `payload`):  
   `message`, `text`, `comment`, `chatMessage`, `chat_message`, `msg`, `content`, `chatMsg`, `chat`, `body`, `fullMessage`, `chatText`, `diamondString`.  
   Example: `{"message":"!bunny1","nickname":"SomeViewer"}` → action `bunny1`.

## 4. Viewer name in RCON chat

RustChaos is called as:

`rustchaos <action> <viewerName> <giftName> [scrap] [message]`

The webhook picks **viewer name** from typical TikTok fields: `uniqueId`, `viewerName`, `nickname`, `userName`, nested `user` / `sender` / `author`, etc. If missing, it uses `Viewer`.

## 5. Bunny: streamer outfit vs spawning a character

| Action | What it does |
|--------|----------------|
| **`bunny1`** | Puts the **bunny costume on the streamer** only (clears wear, equips onesie + ears). **Does not spawn** a new character. |
| **`bunny1npc`** | Spawns a **viewer bot** through **MaxxInvaders** (`maxxinvaders.spawn` … Roaming template **`bunny1`**). This is **not** RustChaos. Requires **MaxxInvaders** + **RoamingNPCs**; optional anchor Steam (same as `maxxinvaders`). |
| **`maxxinvaders`** | General viewer spawn with tier/mode/kit and Roaming template (default `streamer_patrol` unless overridden). |
| **`npcmaxx` + `template=bunny1`** | Spawns via **NPCMaxx** only (`npcmaxx.spawn bunny1 Name`) — no MaxxInvaders tier/kit. Template must be **enabled**. |

If you expected a **character in the world** but used **`bunny1`**, use **`bunny1npc`** or **`maxxinvaders`** with `template=bunny1`, not the costume action.

### 5a. Bunny costume (`bunny1`) — working setups

**A. Query (simplest, recommended for a dedicated TikFinity action)**

```http
POST https://www.rustmaxx.com/api/tikfinity/webhook?action=bunny1
Content-Type: application/json

{"nickname":"TestViewer"}
```

**B. Body only**

```json
{ "action": "bunny1", "nickname": "TestViewer" }
```

**C. Chat text (what failed before code looked at `message` / `text`)**

```json
{ "message": "!bunny1", "nickname": "TestViewer" }
```

**D. Admin connection**

1. RustMaxx → **Admin → Streamer interactions** → add connection **name** `!bunny1` or `bunny1`, **server action** `Bunny costume` / `bunny1`.  
2. In TikFinity, point the webhook at the **same base URL** (no `?action=` required if the payload includes the connection name in `event` / `action` / chat fields as configured).

### 5b. Bunny viewer bot (`bunny1npc`) — MaxxInvaders spawn

**Query:**

```http
POST https://www.rustmaxx.com/api/tikfinity/webhook?action=bunny1npc
Content-Type: application/json

{"nickname":"TikTokViewer"}
```

**Chat-style:**

```json
{ "message": "!bunny1npc", "nickname": "TikTokViewer" }
```

**Server:** **MaxxInvaders** + **RoamingNPCs**; **`bunny1`** template enabled in `RoamingNPCs.json`. The webhook sends **`maxxinvaders.spawn`** (see JSON field **`spawnEngine`: `"maxxinvaders"`**). Optional: **`?template=other_key`** to use another Roaming bot key instead of `bunny1`.

**RustChaos** is only for **`bunny1`** (costume on streamer), not for **`bunny1npc`**.

## 6. Game server checklist (why it might still “not work”)

- **RustChaos** loaded on the server; **`oxide.reload RustChaos`** after updating the plugin.  
- **`StreamerName`** in `oxide/config/RustChaos.json` matches the in-game name of the streamer (for **`bunny1`** costume and **`bunny1npc`** anchor).  
- For **viewer bots** (`bunny1npc`, `maxxinvaders`): **MaxxInvaders** + **RoamingNPCs**; **`bunny1`** (or chosen template) **enabled**; watch **F1** for `[MaxxInvaders]` / `[RoamingNPCs]`.  
- **RCON** in RustMaxx matches the live server (host/port/password; firewall).  
- Webhook response **`ok: true`** but no effect → check server console for `[RustChaos]` lines and RCON errors.

## 7. Other actions (same URL pattern)

| Pattern | Example |
|---------|---------|
| Query | `.../webhook?action=wolf` |
| Roaming NPC | `.../webhook?action=npcmaxx&template=bob_resources_farmer` |
| Bunny viewer bot | `.../webhook?action=bunny1npc` |
| Crew registry | `.../webhook?event=join` (see `TIKFINITY_CREW_RNPC_SETUP.md`) |

## 8. Quick PowerShell test (replace host and body)

```powershell
$uri = "https://www.rustmaxx.com/api/tikfinity/webhook?action=bunny1"
$body = '{"nickname":"CLI_Test"}'
Invoke-RestMethod -Uri $uri -Method POST -ContentType "application/json; charset=utf-8" -Body $body
```

Expect JSON with `"ok": true` and a `command` containing `rustchaos bunny1`.

Chat-style test:

```powershell
$uri = "https://www.rustmaxx.com/api/tikfinity/webhook"
$body = '{"message":"!bunny1","nickname":"CLI_Chat"}'
Invoke-RestMethod -Uri $uri -Method POST -ContentType "application/json; charset=utf-8" -Body $body
```

## 9. Related files in this repo

- Webhook handler: `app/api/tikfinity/webhook/route.ts`  
- Action list + chat parsing: `lib/tikfinity.ts`  
- Admin connections: `lib/tikfinity-connections.ts`  
- Crew + Roaming NPC setup: `docs/TIKFINITY_CREW_RNPC_SETUP.md`  
- Costume: `plugins/RustChaos/RustChaos.cs` → `bunny1`  
- Viewer spawns: `plugins/MaxxInvaders/MaxxInvaders.cs` → `maxxinvaders.spawn`; webhook `bunny1npc` uses that path  
- Roaming template: `plugins/RoamingNpc/config/RoamingNPCs.json` → key `bunny1`
