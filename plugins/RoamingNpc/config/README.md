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

Set **`CREW_RNPC_TEMPLATE_KEY`** (Railway / `.env`) to **one** of these strings — exactly as written, case-sensitive.

Use the **same string** in TikFinity **Roaming NPC** connections (**Roaming template key**) and in webhook URLs:  
`?action=npcmaxx&template=bob_resources_farmer`

Each bot block must have **`"Enable bot?": true`** or `SpawnFromTemplateForBridge` will refuse to spawn.

### MaxxInvaders + RustMaxx **`bunny1npc`** (bunny outfit, `streamer_patrol` brain)

**You do not need a `bunny1` bot key** for TikFinity **`bunny1npc`**. RustMaxx calls **`maxxinvaders.spawn`** with your normal Roaming template (**`streamer_patrol`** by default) and a **wear pipe** (bunny onesie + ears). Update **RoamingNPCs 0.5.23+** and **MaxxInvaders 1.7.8+** on the server.

### MaxxInvaders: `No bot key "…" under Bots settings`

The **6th RCON argument** must match a **template key** that exists under **`Bots settings`**. If you still use **`bunny1`** in a URL or old connection, add that key to JSON or switch to **`bunny1npc`** / **`maxxinvaders`** with **`streamer_patrol`**.

Optional: merge **`bunny1.merge-fragment.json`** only if you want a standalone **`npcmaxx.spawn bunny1`** template. Regenerate with `python scripts/extract-roaming-bunny1-fragment.py`.

## NPCMaxx RCON

```text
npcmaxx.spawn bob_resources_farmer ViewerName
```

See also: [docs/TIKFINITY_CREW_RNPC_SETUP.md](../../../docs/TIKFINITY_CREW_RNPC_SETUP.md).
