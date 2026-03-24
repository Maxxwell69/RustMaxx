# MaxxInvaders (Rust Oxide / uMod)

Viewer-linked Scientist NPCs for TikFinity / RustMaxx relay events. **Standalone** plugin — does not use RoamingNPCs, PersonalNPC, or `RoamingNPCex`.

## RoamingNPCs: what we learned vs what we did not copy

**Worth learning (ideas only, reimplemented here):**

- **Spawn validation:** Prefer navmesh-sampled positions, avoid water, keep distance from players, optionally block monument/safe-zone areas (RoamingNPCs uses overlap checks, `HeightMap`, monument lists).
- **Registry + lifecycle:** Track spawned entities by stable keys, remove on death/unload, clear invalid references in tick loops.
- **Separation of concerns:** Config tiers, logging, and entity cleanup are easier to reason about when kept in dedicated helpers (this plugin uses regions + small services).
- **Combat / AI reality:** Deep NPC personality and custom brains (RoamingNPCs `CustomPet`, state machines, Gen2 AI hooks) are powerful but heavy; MaxxInvaders uses **vanilla Scientist** prefabs and **light NavMesh steering** so behavior stays maintainable.

**Not carried into MaxxInvaders:**

- FrankensteinPet / player prefab hybrid, `CustomPet`, `RoamingNPCex`, bot personality states, mining/hunter/researcher substates, stash systems, or RoamingNPCs’ data file formats.
- Any dependency on RoamingNPCs hooks or templates.

## Install

1. Copy `plugins/MaxxInvaders/MaxxInvaders.cs` to `oxide/plugins/`.
2. Optional: merge `plugins/MaxxInvaders/MaxxInvaders.example.json` into `oxide/config/MaxxInvaders.json` (or let the plugin generate defaults on first load).
3. Grant permissions: `maxxinvaders.admin`, `maxxinvaders.use`, `maxxinvaders.debug`.
4. Install **Kits** if you use kit names; otherwise leave kits empty and rely on tier defaults.

## RustMaxx relay / API — how to trigger

**RCON (recommended for production):** same pattern as `npcmaxx` / RustChaos — your relay executes server console commands:

```text
maxxinvaders.spawn "<viewerName>" "<viewerId>" <tier> "<kitName>" -
maxxinvaders.spawn "<viewerName>" "<viewerId>" <tier> - hostile
```

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

In the **GUI**, use **Quick: spawn 1 demo NPC** for an instant test, or fill **viewer name**, **viewer id** (unique), **tier**, **mode**, **kit**, then **Spawn using fields below**. After editing a field, press **Enter** or click outside so Rust sends the value. **Reset form** gives a new random demo id.

## Behavior modes — limitations (honest)

Rust **Scientist** AI is engine-driven. MaxxInvaders maps modes to **optional prefabs per mode** and **NavMesh destinations** (roam, move toward nearest player, follow admin). It does **not** fully reimplement RoamingNPCs-style combat personalities. For “true” hostile tuning, prefer **prefab variants** (if your build exposes different scientist prefabs) and tier **health** — see `PrefabByBehaviorMode` in config.

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
