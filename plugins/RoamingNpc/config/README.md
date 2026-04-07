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
| `bunny1`            | Bunny onesie + ears viewer bot (RustChaos `bunny1npc` or `npcmaxx.spawn bunny1 …`) |

Set **`CREW_RNPC_TEMPLATE_KEY`** (Railway / `.env`) to **one** of these strings — exactly as written, case-sensitive.

Use the **same string** in TikFinity **Roaming NPC** connections (**Roaming template key**) and in webhook URLs:  
`?action=npcmaxx&template=bob_resources_farmer`

Each bot block must have **`"Enable bot?": true`** or `SpawnFromTemplateForBridge` will refuse to spawn.

## NPCMaxx RCON

```text
npcmaxx.spawn bob_resources_farmer ViewerName
```

See also: [docs/TIKFINITY_CREW_RNPC_SETUP.md](../../../docs/TIKFINITY_CREW_RNPC_SETUP.md).
