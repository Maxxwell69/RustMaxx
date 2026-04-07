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
| **`bunny1npc`** | **MaxxInvaders** viewer spawn with the **same Roaming template as usual** (default **`streamer_patrol`**). Always uses outfit profile **`bunny1`** (bunny onesie + ears); **`?outfit=`** is ignored. **No** separate `bunny1` bot key in JSON. Optional **`?template=`** for another Roaming key. |
| **`maxxinvaders`** | Same pipeline. **Outfit:** default **`default`** / **`crew`** = template clothes only; **`bunny1`** = same wear as `bunny1npc`; or **`?outfit=`** with a **pipe-separated** list of item shortnames. Named profiles live in **`lib/maxxinvaders-outfit-profiles.ts`** (add more there). |
| **`gingynpc`** | **MaxxInvaders** spawn with fixed Roaming template **`gingy`** (gingerbread suit, AK, jackhammer, pickaxe, tree hatchet, meds + gathering). **`?template=`** / **`?outfit=`** ignored. Requires **`gingy`** under **Bots settings** in RoamingNPCs. |
| **`eggnpc`** | Same, template **`egg`** (egg suit, LR-300, chainsaw, meds + gathering). Requires **`egg`** in RoamingNPCs. |
| **`vampnpc`** | Same, template **`vamp`** (Dracula cape, mask, pants, bow + baseball bat, meds + gathering). Requires **`vamp`** in RoamingNPCs. |
| **`npcmaxx` + `template=…`** | **NPCMaxx** direct spawn (`npcmaxx.spawn …`) — separate from MaxxInvaders; still needs that template key in RoamingNPCs. |

If you expected a **character in the world** but used **`bunny1`** (RustChaos), use **`bunny1npc`** or **`maxxinvaders`**, not the costume action.

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

**Server:** **MaxxInvaders 1.7.8+** + **RoamingNPCs 0.5.26+** (0.5.23+ minimum for wear pipe); your normal viewer template (**`streamer_patrol`** by default) must exist and be enabled. The webhook sends **`maxxinvaders.spawn`** with an **8th argument** wear pipe (see **`spawnEngine`: `"maxxinvaders"`**, **`roamingWearPipe`** in JSON). Optional **`?template=`** changes the Roaming bot key; outfit override still applies on top. To **open the bot’s inventory while it walks**: RoamingNPCs **0.5.26+** (same idea as **PersonalNPC** inventory) — **Use (E)** while looking at the bot, or **`/lootnpc`**.

**RustChaos `bunny1`** only dresses the **streamer**, not the viewer bot.

### 5c. MaxxInvaders outfit profiles (`?outfit=`)

Same **`maxxinvaders.spawn`** path as plain **`maxxinvaders`**; only the **8th RCON argument** (wear pipe) changes.

- **`?outfit=default`** or **`?outfit=crew`** — no wear override (Roaming JSON defines clothes, e.g. normal **crew** look on **`streamer_patrol`**).
- **`?outfit=bunny1`** — same bunny pipe as **`bunny1npc`**.
- **`?outfit=gingy`**, **`egg`**, **`vamp`** — wear-only pipes (clothes). For the **full** weapon/tool loadouts, spawn with **`?action=gingynpc`**, **`eggnpc`**, or **`vampnpc`** (or **`?template=gingy`** / **`egg`** / **`vamp`** on **`maxxinvaders`**), not just the outfit name on **`streamer_patrol`**.
- **`?outfit=item.one|item.two`** — custom pipe (sanitized server-side).
- JSON body: **`outfit`** or **`outfitProfile`** (query wins if both are set).

Register new named profiles in **`lib/maxxinvaders-outfit-profiles.ts`**.

## 6. Game server checklist (why it might still “not work”)

- **RustChaos** loaded on the server; **`oxide.reload RustChaos`** after updating the plugin.  
- **`StreamerName`** in `oxide/config/RustChaos.json` matches the in-game name of the streamer (for **`bunny1`** costume and **`bunny1npc`** anchor).  
- For **viewer bots** (`bunny1npc`, `maxxinvaders`, **`gingynpc`** / **`eggnpc`** / **`vampnpc`**): **MaxxInvaders** and **RoamingNPCs** must both be loaded. If the webhook JSON shows **`rconResponse`** like **`RoamingNPCs is not loaded`**, the site is working — fix the game host: install **`RoamingNPCs`**, run **`oxide.reload RoamingNPCs`**, confirm **`RoamingNPCs`** appears under **`oxide.plugins`**. Then ensure **`oxide/config/RoamingNPCs.json`** contains the bot keys you use (**`streamer_patrol`**, **`gingy`**, **`egg`**, **`vamp`**, etc.) and **`Enable bot?`** is true.  
- **`streamer_patrol`** (or your `?template=`) **enabled**; **`bunny1npc`** / wear pipes need compatible **MaxxInvaders** + **RoamingNPCs** versions (see above).  
- **RCON** in RustMaxx matches the live server (host/port/password; firewall).  
- Webhook response **`ok: true`** but no effect → check server console for `[RustChaos]` lines and RCON errors.

## 7. Other actions (same URL pattern)

| Pattern | Example |
|---------|---------|
| Query | `.../webhook?action=wolf` |
| Roaming NPC | `.../webhook?action=npcmaxx&template=bob_resources_farmer` |
| Bunny viewer bot | `.../webhook?action=bunny1npc` |
| Gingy / Egg / Vamp viewer bots | `.../webhook?action=gingynpc` · `.../webhook?action=eggnpc` · `.../webhook?action=vampnpc` |
| MaxxInvaders + bunny outfit (same as bunny1npc) | `.../webhook?action=maxxinvaders&outfit=bunny1` |
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
- Viewer spawns: `plugins/MaxxInvaders/MaxxInvaders.cs` → `maxxinvaders.spawn`; webhook `bunny1npc` = **`streamer_patrol`** + wear pipe  
- Roaming: `plugins/RoamingNpc/RoamingNPCs.cs` → `SpawnFromTemplateForBridge` (optional wear pipe, 0.5.23+; live player loot **0.5.26+**)
