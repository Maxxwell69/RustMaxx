# MaxxInvaders (Rust Oxide / uMod)

Viewer-linked NPCs for TikFinity / RustMaxx relay events. **1.1.0+** can spawn **RoamingNPCs** bot templates (gather, hunt, roam — same AI as your roaming bots) with the viewer’s display name; if RoamingNPCs is missing or the bridge fails, it **falls back** to vanilla **Scientist** prefabs with light NavMesh steering.

## RoamingNPCs integration (recommended for “real” bot behavior)

1. Install **RoamingNPCs** (`oxide/plugins/RoamingNPCs.cs`) and configure **Bots settings** in `oxide/config/RoamingNPCs.json`. Each template you reference must exist and have **`"Enable bot?": true`** (see RoamingNPCs `config/README.md`).
2. In **MaxxInvaders** config, set **`UseRoamingNPCsWhenAvailable`** to `true` (default) and **`DefaultRoamingTemplateKey`** to a valid bot key (example: `bob_resources_farmer`). Optionally set **`RoamingTemplateKey`** per tier to use different personalities per gift tier.
3. MaxxInvaders calls `SpawnFromTemplateForBridge(templateKey, displayName, viewerId)`, then **teleports** the spawned NPC to the same validated spawn position it uses for scientists. RoamingNPCs owns movement and AI after that; MaxxInvaders only tracks lifecycle, GUI, and hooks.
4. **Kits** are **not** applied to roaming spawns (the template outfits the bot). Kits still apply to scientist fallback spawns.
5. Set **`UseRoamingNPCsWhenAvailable`** to `false` if you only want vanilla scientists.
6. Set **`ScientistFallbackEnabled`** to **`false`** if you **never** want scientists — spawns only succeed when the RoamingNPCs bridge returns a bot (otherwise you get error `roaming_only_failed`). Keep **`UseRoamingNPCsWhenAvailable`** `true` and RoamingNPCs loaded with valid templates.

## Ideas borrowed from RoamingNPCs (when using scientist fallback)

- **Spawn validation:** Navmesh-sampled positions, distance from players, optional monument / safe-zone blocks.
- **Registry + lifecycle:** Stable viewer keys, cleanup on death/unload.

## Install

1. Copy `plugins/MaxxInvaders/MaxxInvaders.cs` to `oxide/plugins/`.
2. **Config:** Copy the **full** file [MaxxInvaders.json](./MaxxInvaders.json) to `oxide/config/MaxxInvaders.json` on the server (or let the plugin generate defaults on first load). You do not need to merge partial keys if you use that file as-is.
3. Grant permissions: `maxxinvaders.admin`, `maxxinvaders.use`, `maxxinvaders.debug`.
4. Install **Kits** if you use kit names on **scientist** spawns; roaming spawns use the RoamingNPCs template loadout.
5. For RoamingNPCs-driven viewers, install and configure **RoamingNPCs** (see above).

## RustMaxx relay / API — how to trigger

**RCON (recommended for production):** same pattern as `npcmaxx` / RustChaos — your relay executes server console commands:

```text
maxxinvaders.spawn "<viewerName>" "<viewerId>" <tier> "<kitName>" -
maxxinvaders.spawn "<viewerName>" "<viewerId>" <tier> - hostile
maxxinvaders.spawn "<viewerName>" "<viewerId>" <tier> - roaming "streamer_patrol"
```

- Optional **6th argument** is a **RoamingNPCs bot key** (overrides `ViewerRoamingTemplateKey` / tier default for that spawn). RustMaxx TikFinity webhook defaults to **`streamer_patrol`** when you do not pass `?template=`.
- Use `-` for an empty kit name when you have no Kits entry.
- Quote viewer names that contain spaces.
- `viewerId` should be the **stable** TikTok / platform id from the relay (string).

**Other:**

- `maxxinvaders.upgrade "<viewerId>" <tier>`
- `maxxinvaders.remove "<viewerId>"`
- `maxxinvaders.clearall`

**Optional C# API** (another Oxide plugin on the same server):

```csharp
Interface.Call("SpawnInvader", viewerName, viewerId, tier, kitName, mode);
Interface.Call("RemoveInvader", viewerId);
```

## Chat / GUI

| Command | Permission | Notes |
|--------|------------|--------|
| `/maxxinvaders ui` or `/maxxinvaders.ui` | admin | Admin CUI |
| `/maxxinvaders.list` | use | Short list |
| `/maxxinvaders spawn <name> <tier>` | admin | Test spawn near you |
| `/maxxinvaders clear` | admin | Despawn all tracked |
| `/maxxinvaders debug on\|off` | debug | Verbose logging |

In the **GUI**, use tabs **Invaders** (spawn + list + bridge status), **Maxx** (edit **MaxxInvaders** options — saves `oxide/config/MaxxInvaders.json`), and **Roaming** (toggle **Enable bot?** per RoamingNPCs template — saves `oxide/config/RoamingNPCs.json`). You do not need to hand-edit JSON for those fields.

**Chat access:** **`/migrate-to-skills`** opens the **Maxx** tab (same permission as the GUI). Also **`/maxxinvaders maxx`**, **`/maxxinvaders roaming`**, **`/maxxinvaders ui`**. The Cursor **migrate-to-skills** *skill* (`.cursor/skills`) is only for migrating rules/commands in the editor — not required for Rust.

Use **Quick: spawn 1 demo NPC** for an instant test, or fill **viewer name**, **viewer id** (unique), **tier**, **mode**, **kit**, then **Spawn using fields below**. After editing a field, press **Enter** or click outside so Rust sends the value. **Reset form** gives a new random demo id.

## “Failed to create agent because it is not close enough to the NavMesh”

Spawns must land on **walkable NavMesh**. MaxxInvaders **1.1.3+** expands NavMesh sampling (up to ~28 m) for spawn points, scientist **Spawn()**, RoamingNPCs **Teleport**, and scientist steering targets. If this still spams the console, try **smaller** `DefaultSpawnRadius`, **more** `SpawnAttempts`, or test in open terrain away from cliffs, quarry edges, or monument gaps. **RoamingNPCs** bots use their own spawn logic first; we only snap positions after **Teleport**.

## “Couldn’t find prefab … scientistnpc_roam”

Facepunch moved many scientist prefabs under `assets/rust.ai/agents/npcplayer/humannpc/scientist/`. The old path `assets/prefabs/npc/scientist/scientistnpc_roam.prefab` often **does not exist** on current builds.

**Fix:** Use **MaxxInvaders 1.0.4+**, or edit `oxide/config/MaxxInvaders.json`: set `DefaultScientistPrefab` to `assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_roam.prefab` and keep `ScientistPrefabFallbacks` (the plugin tries fallbacks automatically). If you still see errors, run `PrefabSniffer` or `debug.lookingat` on a scientist in-game and paste that path into config.

## Behavior modes — scientist vs roaming

**RoamingNPCs spawns:** Behavior is defined by the **RoamingNPCs bot template** (personality, combat, gathering). MaxxInvaders does not steer or retarget these NPCs.

**Scientist fallback:** Rust **Scientist** AI is engine-driven. MaxxInvaders maps modes to **optional prefabs per mode** and **NavMesh destinations** (roam, move toward nearest player, follow admin).

**Player damage (v1.0.5+ on scientists):** Only modes **`hostile`** and **`attackplayer`** are allowed to **deal damage to real players**. Other modes have **damage to players cancelled** in a hook. RoamingNPCs templates follow their own plugin rules for targeting.

**Passive scientist modes** get stronger wander + steer-away from nearby players so they move more instead of standing in one spot.

## Data files

- **Config:** `oxide/config/MaxxInvaders.json`
- **Persisted history / counters:** `oxide/data/MaxxInvaders/MaxxInvadersData.json`

## TODO / future expansion

- [ ] Richer combat targeting (relationship components / NpcFact) where API allows on your server branch.
- [ ] Per-streamer anchor (spawn near specific Twitch streamer’s in-game player).
- [ ] Wave spawning, gift-tier mapping, boss templates.
- [ ] Overlay / RustMaxx web push when spawn fails (cooldown, cap).
- [ ] Stronger Kits integration (skin args) if your Kits plugin exposes them.
- [ ] Localization for GUI labels.

## Changelog (high level)

- **1.2.1:** RoamingNPCs bridge API is **embedded in `RoamingNPCs.cs`** (no separate `NPCMaxxApi.cs`). Clearer spawn failure messages (missing key vs disabled bot vs Respawn null).
- **1.2.0:** GUI tabs **Invaders | Maxx | Roaming**. **Maxx** edits core MaxxInvaders config in-game. **Roaming** toggles RoamingNPCs bot templates. Chat **`/migrate-to-skills`** opens the Maxx tab.
- **1.1.4:** Config **`ScientistFallbackEnabled`** (default `true`). Set to `false` to **disable vanilla scientist spawns** and require a successful RoamingNPCs bridge only.
- **1.1.3:** Stronger **NavMesh** snapping for spawns, roaming teleports, and scientist destinations to reduce “Failed to create agent…” console spam.
- **1.1.2:** Admin **GUI** has **Invaders** vs **Setup** tabs. **Setup** shows a read-only summary of **MaxxInvaders** config (caps, spawn rules, bridge, tiers, prefabs, logging) and **RoamingNPCs** config (bot keys + enabled flags, live count). RoamingNPCs adds **`GetMaxxInvadersGuiSummary`** for the right column.
- **1.1.1:** Admin **GUI** shows live RoamingNPCs bridge status (plugin loaded, default template key OK / missing / disabled) and lists each invader as **RoamingNPCs** vs **Scientist**. RoamingNPCs exposes **`IsBridgeTemplateReady`** for the check.
- **1.1.0:** Optional **RoamingNPCs** bridge (`UseRoamingNPCsWhenAvailable`, `DefaultRoamingTemplateKey`, per-tier `RoamingTemplateKey`). Viewer bots use full roaming AI when the bridge succeeds.
