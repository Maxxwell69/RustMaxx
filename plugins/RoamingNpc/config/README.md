# RoamingNPCs config (reference copy)

This folder holds a **reference** `RoamingNPCs.json` shipped with the RustMaxx repo so you can see valid **bot template keys** and tune bots in an editor before deploying to your game server.

## On your Rust server (Oxide)

After you install **RoamingNPCs**, the live file is usually:

- `oxide/config/RoamingNPCs.json`  

(or next to your plugin’s data folder — match your host’s layout). Edit that file on the server, then reload the plugin or restart as required.

## Template keys (for RustMaxx / TikFinity / `npcmaxx.spawn`)

Each **top-level key** under `"Bots settings"` is a **template key** you can use in:

| Template key        | Use for |
|---------------------|---------|
| `bob_resources_farmer` | Default resource/gather style bot |
| `john_looter`       | Looter preset |
| `alfred_hunter`     | Hunter preset |
| `austin_fighter`    | Fighter preset |
| `bunny1`            | *(Optional)* Full bot preset with bunny clothes — only if you use **`npcmaxx.spawn bunny1`**. RustMaxx **`bunny1npc`** uses **`streamer_patrol`** + wear override instead (no `bunny1` key required). |
| `gingy`, `egg`, `vamp` | **Optional** full weapon/tool presets (AK, LR-300, bow, etc.). TikFinity actions **`gingynpc`** / **`eggnpc`** / **`vampnpc`** use **`streamer_patrol`** + wear only (like **`bunny1npc`**) — **no merge required** to spawn. Merge **`gingy-egg-vamp.merge-fragment.json`** into the server’s **`Bots settings`** if you want those loadouts with **`maxxinvaders&template=gingy`** (etc.). |
| `snipemb` | **Sniper preset:** L96 + 8x scope, blue jumpsuit, Clatter helmet, boots, gloves; long weapon range (~120 m) in reference `RoamingNPCs.json`. Merge **`snipemb.merge-fragment.json`** into the server config if your live file does not yet include this key. **Note:** `jumpsuit.suit.blue` is a **full-body** slot in Rust — boots/gloves may not equip on top; remove those wear rows if they conflict on your server. |

Set **`CREW_RNPC_TEMPLATE_KEY`** (Railway / `.env`) to **one** of these strings — exactly as written, case-sensitive.

Use the **same string** in TikFinity **Roaming NPC** connections (**Roaming template key**) and in webhook URLs:  
`?action=npcmaxx&template=bob_resources_farmer`

Each bot block must have **`"Enable bot?": true`** or `SpawnFromTemplateForBridge` will refuse to spawn.

### MaxxInvaders + RustMaxx **`bunny1npc`** (bunny outfit, `streamer_patrol` brain)

**You do not need a `bunny1` bot key** for TikFinity **`bunny1npc`**. RustMaxx calls **`maxxinvaders.spawn`** with your normal Roaming template (**`streamer_patrol`** by default) and a **wear pipe** (bunny onesie + ears). Update **RoamingNPCs 0.5.26+** and **MaxxInvaders 1.7.8+** on the server.

### MaxxInvaders: runtime tasks + deposit box (bridge bots)

**RoamingNPCs 0.5.27+** adds **`ApplyBridgeTask`** (wood / stone / cloth / hunt / protect / gather / idle) and **`SetBridgeDepositBox`** so **`deposit`** prefers a **specific** anchor-owned **`StorageContainer`**. **MaxxInvaders 1.7.9+** exposes **`maxxinvaders.task`**, **`maxxinvaders.box`**, and chat **`/maxxinvaders task`** / **`/maxxinvaders box … look`**. See [docs/MAXXINVADERS.md](../../../docs/MAXXINVADERS.md).

### Opening a live bot’s inventory (viewer / streamer patrol bots)

Rust’s **client** usually does **not** show a loot prompt on **awake** humanoid NPCs. RoamingNPCs **0.5.26+** uses the same technique as **PersonalNPC** `OpenInventory`: a short-lived **`player_corpse`** proxy, **`SendAsSnapshot`** to your client, **`PositionChecks = false`**, then the bot’s real **main / wear / belt** containers — plus **`RPC_OpenLootPanel`** after a **0.25s** delay. Press **Use (E)** while looking at the bot (~2.5m ray, ~3.5m max separation) or use **`/lootnpc`** near an allowed bot.

Who is allowed (any one is enough):

- Bots spawned via **`SpawnFromTemplateForBridge`** (MaxxInvaders + **NPCMaxx** viewer spawns): always **`SpawnedFromMaxxInvadersBridge`**.
- Templates with **MaxxInvaders patrol** enabled: **`BridgePatrol.Enable`** **`true`** (e.g. **`streamer_patrol`** when an anchor Steam id is applied at spawn).
- Or per-template: **`AllowPlayerLootInventoryWhileAlive`** **`true`** (`Allow players to open this bot's inventory while alive…` in JSON).

The auto-created **`streamer_patrol`** preset still sets **`AllowPlayerLootInventoryWhileAlive`** to **`true`**. Other presets stay off unless you enable one of the rules above.

### MaxxInvaders: `No bot key "…" under Bots settings`

The **6th RCON argument** must match a **template key** that exists under **`Bots settings`**. If you still use **`bunny1`** in a URL or old connection, add that key to JSON or switch to **`bunny1npc`** / **`maxxinvaders`** with **`streamer_patrol`**.

Optional: merge **`bunny1.merge-fragment.json`** only if you want a standalone **`npcmaxx.spawn bunny1`** template. Regenerate with `python scripts/extract-roaming-bunny1-fragment.py`.

## NPCMaxx RCON

```text
npcmaxx.spawn bob_resources_farmer ViewerName
```

See also: [docs/TIKFINITY_CREW_RNPC_SETUP.md](../../../docs/TIKFINITY_CREW_RNPC_SETUP.md).
