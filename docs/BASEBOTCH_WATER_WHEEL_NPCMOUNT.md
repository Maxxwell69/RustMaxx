# BaseBotch: NPC on electric water wheel (paused handoff)

**Status:** Tabled. Resume here instead of rediscovering behavior from scratch.

## Goal

Make a Roaming / MaxxInvaders NPC **mount and “drive”** the deployable **electric water wheel** (hamster-wheel style): real walking/pedaling input where possible, not a fake always-on power hack unless nothing else works.

## Where the code lives

- **`plugins/BaseBotch/BaseBotch.cs`** — mount, `serverInput` injection, Roaming / `NPCPlayerNavigator` integration, optional reflection on `WaterWheelMountable` / `ElectricWaterWheel`.
- Check the Oxide `[Info("BaseBotch", "RustMaxx", "x.y.z")]` line for the current version (last work bumped to **1.4.16** area).

## What we learned (important)

1. **`UpdateFromInput(int, int)`** is **IO slot indexing** for **incoming wired power**, not rider/hamster input. If **`GetConnectedInputCount() == 0`**, calling it throws (array index out of range). **Do not treat “failed” `UpdateFromInput` as missing pedal power** when nothing is wired in.
2. **`ShouldUpdateOutputs == false`** while **`IsPowered` / `CurrentEnergy` look fine** is often **normal** — it means the engine doesn’t need to refresh outputs that tick. It is **not** by itself proof that pedaling failed.
3. **`MaximalPowerOutput` / water flow** can already show power from **map water / wheel simulation** independent of NPC button spam.
4. **`Invalid Position: … egg … (destroying)`** in logs was **unrelated** to the wheel (something else spawning an egg badly).

## Debug toggles (when you turn it back on)

- **`DebugWheelAutorun`** (or equivalent in config) surfaces:
  - **`wheelSignal`** — power-ish metrics (`MaximalPowerOutput`, `IsPowered`, `GetCurrentEnergy`, `ShouldUpdateOutputs`).
  - **`wheelIo`** — **`GetConnectedInputCount`**, **`GetConnectedOutputCount`**, **`HasConnections`** (see actual wiring).
  - **`wheelPublish` / `wheelPublishFailed`** — reflection “kick the wheel” attempts; **`UpdateFromInput`** is **omitted from failed list** when skipped due to **zero input connections** (1.4.16+).

## Suggested next session (when resumed)

1. Wire the wheel’s **output** to a **real load** (battery, lights, etc.) and compare **`wheelIo`** + in-game behavior.
2. Separate **“NPC mounted + input written”** from **“wheel physics / power network”** — validate each layer independently.
3. Re-read **`BaseBotch.cs`** around mount timers, `PlayerServerInput`, and any `WaterUpdate` / `PowerUpdate` / `VehicleFixedUpdate` hooks before adding new hacks.

## Related plugins (context only)

- **MaxxInvaders** — spawn / UI / mount into BaseBotch.
- **RoamingNPCs** — bridge task hooks (`ApplyBridgeTask`, etc.).
