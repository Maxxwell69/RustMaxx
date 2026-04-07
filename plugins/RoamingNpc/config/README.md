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
| `bunny1`            | Bunny onesie + ears viewer bot (RustMaxx webhook `?action=bunny1npc` → MaxxInvaders, or `npcmaxx.spawn bunny1 …`) |

Set **`CREW_RNPC_TEMPLATE_KEY`** (Railway / `.env`) to **one** of these strings — exactly as written, case-sensitive.

Use the **same string** in TikFinity **Roaming NPC** connections (**Roaming template key**) and in webhook URLs:  
`?action=npcmaxx&template=bob_resources_farmer`

Each bot block must have **`"Enable bot?": true`** or `SpawnFromTemplateForBridge` will refuse to spawn.

### MaxxInvaders: `No bot key "bunny1" under Bots settings`

That message means **`oxide/config/RoamingNPCs.json` on the game server does not define** a bot template named **`bunny1`**. The RustMaxx repo includes it in the reference [`RoamingNPCs.json`](./RoamingNPCs.json), but you must **merge it into the file on the server** (or replace the file if you manage config only from the repo).

1. Open **`bunny1.merge-fragment.json`** in this folder — it contains only the **`bunny1`** object.
2. In your server’s **`oxide/config/RoamingNPCs.json`**, under **`"Bots settings"`** (English) or **`"Настройка ботов"`** (Russian), add a comma after the last existing bot and paste the **`"bunny1": { ... }`** entry from the fragment (merge into the same object that holds `bob_resources_farmer`, etc.).
3. Run **`oxide.reload RoamingNPCs`** (or restart the server).

To regenerate the fragment after editing the full template in `RoamingNPCs.json`:

```bash
python scripts/extract-roaming-bunny1-fragment.py
```

If you prefer not to use **`bunny1`**, point TikFinity at **`maxxinvaders`** with **`?template=`** set to a key that **already exists** on your server (e.g. `streamer_patrol`), or set **`ScientistFallbackEnabled=true`** in MaxxInvaders only if you accept vanilla scientist fallback when the template is missing.

## NPCMaxx RCON

```text
npcmaxx.spawn bob_resources_farmer ViewerName
```

See also: [docs/TIKFINITY_CREW_RNPC_SETUP.md](../../../docs/TIKFINITY_CREW_RNPC_SETUP.md).
