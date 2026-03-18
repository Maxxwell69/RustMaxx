// RustMaxxTikTrigger - uMod/Oxide plugin for Rust
//
// Purpose: Safe command interface for external systems (e.g. webhook listener connected to TikFinity)
// to trigger controlled in-game events via RCON.
//
// Webhook flow:
//   TikFinity → webhook listener → RCON command → tiktrigger <action> <viewerName> <giftName>
//   → RustMaxxTikTrigger executes the whitelisted action (effects, chat, NPC spawn).
//
// Install: copy RustMaxxTikTrigger.cs into servers/Rust/oxide/plugins/

using System;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("RustMaxxTikTrigger", "RustMaxx", "1.7.0")]
    [Description("RCON-only command for TikFinity webhook: tiktrigger <action> <viewerName> <giftName>. Supply/likes call in an airdrop automatically at the streamer.")]
    public class RustMaxxTikTrigger : RustPlugin
    {
        #region Configuration

        private class PluginConfig
        {
            public string StreamerName { get; set; } = "pirate maxx";
            /// <summary>Optional. If your Rust build uses a different shark prefab path, set it here (e.g. from PrefabSniffer or debug.lookingat). Leave empty to use built-in list.</summary>
            public string SharkPrefabPath { get; set; } = "";
            /// <summary>Optional. Override scientist RHIB prefab for scientistboat (default: assets/content/vehicles/boats/rhib/rhib_scientist.prefab).</summary>
            public string ScientistRhibPrefabPath { get; set; } = "";
            /// <summary>Optional. Override scientist PT boat prefab (default: assets/content/vehicles/boats/ptboat/ptboat_scientist.prefab).</summary>
            public string ScientistPtBoatPrefabPath { get; set; } = "";
        }

        private PluginConfig _config;

        protected override void LoadDefaultConfig() => _config = new PluginConfig();

        protected override void LoadConfig()
        {
            base.LoadConfig();
            try
            {
                _config = Config.ReadObject<PluginConfig>();
                if (_config == null || string.IsNullOrWhiteSpace(_config.StreamerName))
                    _config = new PluginConfig();
            }
            catch
            {
                LoadDefaultConfig();
            }
            SaveConfig();
        }

        private void SaveConfig() => Config.WriteObject(_config);

        #endregion

        #region Constants

        private const string LogPrefix = "[RustMaxxTikTrigger]";

        // Whitelist of allowed actions. Only these are executed; no arbitrary commands.
        private static readonly string[] AllowedActions = { "test", "rose", "smoke", "fireworks", "scientist", "wolf", "bear", "shark", "pig", "supply", "likes", "chaos", "scientistboat" };

        /// <summary>Streamer location for chaos event: determines which timer rules run.</summary>
        private enum ChaosLocation { Land, Sea, Swimming, ModularBoat }

        // Effect prefab paths (full paths; short names like "fx/..." are not valid in current Rust).
        private const string EffectSmoke = "assets/bundled/prefabs/fx/smoke_signal_full.prefab";
        private const string EffectFireworks = "assets/bundled/prefabs/fx/fireball_small.prefab";

        private const string ScientistPrefab = "assets/prefabs/npc/scientist/scientist.prefab";
        private const string WolfPrefab = "assets/rust.ai/agents/wolf/wolf.prefab";
        private const string BearPrefab = "assets/rust.ai/agents/bear/bear.prefab";
        private const string BoarPrefab = "assets/rust.ai/agents/boar/boar.prefab";
        private const string CargoPlanePrefab = "assets/prefabs/npc/cargo plane/cargo_plane.prefab";

        #endregion

        #region Command

        [ConsoleCommand("tiktrigger")]
        private void CmdTikTrigger(ConsoleSystem.Arg arg)
        {
            // Only allow from server console or RCON (no in-game player execution).
            if (arg.Connection != null)
            {
                arg.ReplyWith("This command can only be run from server console or RCON.");
                return;
            }

            if (!arg.HasArgs(3))
            {
                arg.ReplyWith("Usage: tiktrigger <action> <viewerName> <giftName> [scrapAmount] [customMessage]");
                return;
            }

            string action = arg.GetString(0).ToLowerInvariant();
            string viewerName = arg.GetString(1);
            string giftName = arg.GetString(2);
            int scrapAmount = arg.HasArgs(4) || arg.HasArgs(5) ? arg.GetInt(3, 0) : 0;
            string customMessage = arg.HasArgs(5) ? arg.GetString(4) : null;
            if (string.IsNullOrWhiteSpace(customMessage)) customMessage = null;

            if (!IsAllowedAction(action))
            {
                PrintWarning($"{LogPrefix} Unknown action '{action}' from viewer '{viewerName}' gift '{giftName}'. Ignored.");
                arg.ReplyWith($"Unknown action: {action}");
                return;
            }

            // Log every trigger to server console.
            Puts($"{LogPrefix} {viewerName} triggered action '{action}' from gift '{giftName}'" + (scrapAmount > 0 ? $" (+{scrapAmount} scrap)" : ""));

            ExecuteAction(action, viewerName, giftName, scrapAmount, customMessage);
            arg.ReplyWith($"OK: {action}" + (scrapAmount > 0 ? $" +{scrapAmount} scrap" : ""));
        }

        private static bool IsAllowedAction(string action)
        {
            foreach (string a in AllowedActions)
                if (a == action) return true;
            return false;
        }

        #endregion

        #region Action execution

        private void ExecuteAction(string action, string viewerName, string giftName, int scrapAmount, string customMessage = null)
        {
            BasePlayer target = GetStreamerPlayer();
            if (target == null && ActionRequiresPlayer(action))
            {
                PrintWarning($"{LogPrefix} Streamer '{_config.StreamerName}' not online. Action '{action}' cancelled.");
                return;
            }

            string ChatMsg(string fallback) => !string.IsNullOrEmpty(customMessage) ? customMessage : fallback;

            switch (action)
            {
                case "test":
                    BroadcastChat(ChatMsg($"{viewerName} triggered a TikTok test event!"));
                    break;

                case "rose":
                    BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}!"));
                    break;

                case "smoke":
                    if (target != null)
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}!"));
                        SpawnEffect(EffectSmoke, GetPositionNear(target));
                    }
                    break;

                case "fireworks":
                    if (target != null)
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}!"));
                        Vector3 pos = GetPositionNear(target);
                        SpawnEffect(EffectFireworks, pos);
                    }
                    break;

                case "scientist":
                    if (target == null)
                        PrintWarning($"{LogPrefix} Scientist skipped: streamer not online. Set StreamerName in config (current: '{_config?.StreamerName ?? ""}').");
                    else
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}!"));
                        Vector3 pos = GetPositionBehind(target);
                        if (pos == Vector3.zero) pos = GetPositionNear(target);
                        if (pos != Vector3.zero && SpawnScientist(pos))
                            Puts($"{LogPrefix} Spawned 1 scientist near {target.displayName}");
                    }
                    break;

                case "wolf":
                    if (target != null)
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}!"));
                        SpawnNPC(WolfPrefab, GetPositionNear(target));
                        Puts($"{LogPrefix} Spawned 1 wolf near {target.displayName}");
                    }
                    break;

                case "bear":
                    if (target != null)
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}!"));
                        SpawnNPC(BearPrefab, GetPositionNear(target));
                        Puts($"{LogPrefix} Spawned 1 bear near {target.displayName}");
                    }
                    break;

                case "shark":
                    if (target != null)
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}!"));
                        if (SpawnShark(GetPositionNear(target), _config?.SharkPrefabPath))
                            Puts($"{LogPrefix} Spawned 1 shark near {target.displayName}");
                    }
                    break;

                case "pig":
                    if (target != null)
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}!"));
                        SpawnNPC(BoarPrefab, GetPositionNear(target));
                        Puts($"{LogPrefix} Spawned 1 pig (boar) near {target.displayName}");
                    }
                    break;

                case "supply":
                case "likes":
                    if (target != null)
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}!"));
                        SpawnSupplyDropAt(GetPositionNear(target));
                    }
                    break;

                case "chaos":
                    if (target != null)
                    {
                        ChaosLocation loc = GetStreamerChaosLocation(target);
                        BroadcastChat(ChatMsg($"{viewerName} triggered CHAOS! ({loc})"));
                        RunChaosEvent(loc, viewerName, giftName, ChatMsg);
                    }
                    break;

                case "scientistboat":
                    if (target != null)
                    {
                        ChaosLocation loc = GetStreamerChaosLocation(target);
                        if (loc == ChaosLocation.Sea || loc == ChaosLocation.Swimming || loc == ChaosLocation.ModularBoat)
                        {
                            Vector3 waterPos = target.transform.position;
                            if (SpawnScientistBoat(waterPos, _config?.ScientistRhibPrefabPath, _config?.ScientistPtBoatPrefabPath))
                            {
                                BroadcastChat(ChatMsg($"{viewerName} sent a scientist boat!"));
                                Puts($"{LogPrefix} Spawned scientist boat (RHIB or PT) at {target.displayName} (water)");
                            }
                            else
                            {
                                BroadcastChat(ChatMsg($"{viewerName} tried to send a scientist boat but spawn failed. Check ScientistRhibPrefabPath / ScientistPtBoatPrefabPath in config."));
                                PrintWarning($"{LogPrefix} Scientist boat spawn failed. Set ScientistRhibPrefabPath or ScientistPtBoatPrefabPath in oxide/config/RustMaxxTikTrigger.json if paths differ on your build.");
                            }
                        }
                        else
                        {
                            BroadcastChat(ChatMsg($"Scientist boat requires streamer to be in water (sea or swimming). {viewerName} sent {giftName}!"));
                        }
                    }
                    break;

                default:
                    // Whitelist guarantees we don't reach here; defensive.
                    PrintWarning($"{LogPrefix} Unhandled action: {action}");
                    break;
            }

            if (scrapAmount > 0 && target != null)
            {
                GiveScrapToPlayer(target, scrapAmount);
                Puts($"{LogPrefix} Gave {scrapAmount} scrap to streamer {target.displayName}");
            }
            else if (scrapAmount > 0 && target == null)
            {
                PrintWarning($"{LogPrefix} Streamer not online – scrap not given ({scrapAmount} would have been given).");
            }
        }

        /// <summary>
        /// Gives an item (e.g. supply.signal) to the player. Used for supply/likes trigger.
        /// </summary>
        private static void GiveItemToPlayer(BasePlayer player, string shortName, int amount)
        {
            if (player == null || !player.IsValid() || amount <= 0 || string.IsNullOrEmpty(shortName)) return;
            ItemDefinition def = ItemManager.FindItemDefinition(shortName);
            if (def == null) return;
            Item item = ItemManager.Create(def, amount, 0ul);
            if (item == null) return;
            item.MoveToContainer(player.inventory.containerMain);
        }

        /// <summary>
        /// Gives scrap to the streamer (gift value from TikTok). Capped per call to avoid abuse.
        /// </summary>
        private static void GiveScrapToPlayer(BasePlayer player, int amount)
        {
            if (player == null || !player.IsValid() || amount <= 0) return;
            const int maxScrapPerTrigger = 10000;
            int give = Math.Min(amount, maxScrapPerTrigger);
            ItemDefinition scrapDef = ItemManager.FindItemDefinition("scrap");
            if (scrapDef == null) return;
            Item item = ItemManager.Create(scrapDef, give, 0ul);
            if (item == null) return;
            item.MoveToContainer(player.inventory.containerMain);
        }

        private static bool ActionRequiresPlayer(string action)
        {
            return action == "smoke" || action == "fireworks" || action == "scientist" || action == "wolf" || action == "bear" || action == "shark" || action == "pig" || action == "supply" || action == "likes" || action == "chaos" || action == "scientistboat";
        }

        private static Vector3 GetPositionNear(BasePlayer player)
        {
            if (player == null || !player.IsValid()) return Vector3.zero;
            Vector3 pos = player.transform.position;
            // Spawn at a comfortable distance so NPCs/animals are not on top of the player.
            Vector3 offset = UnityEngine.Random.insideUnitSphere;
            offset.y = 0f;
            if (offset.sqrMagnitude < 0.01f) offset = Vector3.forward;
            offset.Normalize();
            float distance = 8f + UnityEngine.Random.Range(0f, 4f);
            return pos + offset * distance;
        }

        /// <summary>
        /// Position a few meters behind the player (based on their look direction). Used for scientist spawn so they appear behind the streamer.
        /// Falls back to position near player if look direction is invalid.
        /// </summary>
        private static Vector3 GetPositionBehind(BasePlayer player)
        {
            if (player == null || !player.IsValid()) return Vector3.zero;
            Vector3 pos = player.transform.position;
            Vector3 forward = Vector3.zero;
            try
            {
                if (player.eyes != null)
                    forward = player.eyes.HeadForward();
            }
            catch { }
            if (forward.sqrMagnitude < 0.01f)
                forward = -player.transform.forward;
            forward.y = 0f;
            if (forward.sqrMagnitude < 0.01f)
                return GetPositionNear(player);
            forward.Normalize();
            float distance = 7f + UnityEngine.Random.Range(0f, 3f);
            return pos - forward * distance;
        }

        #endregion

        #region Helpers

        /// <summary>
        /// Detects streamer location for chaos event: Land (on ground), Sea (mounted on boat), or Swimming (in water, not on boat).
        /// </summary>
        private static ChaosLocation GetStreamerChaosLocation(BasePlayer player)
        {
            if (player == null || !player.IsValid()) return ChaosLocation.Land;

            BaseMountable mount = player.GetMounted();
            if (mount != null)
            {
                BaseEntity mountEntity = mount as BaseEntity;
                if (mountEntity != null)
                {
                    string prefab = mountEntity.ShortPrefabName ?? "";
                    if (prefab.IndexOf("boat", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        prefab.IndexOf("rhib", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        prefab.IndexOf("rowboat", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        prefab.IndexOf("submarine", StringComparison.OrdinalIgnoreCase) >= 0)
                        return ChaosLocation.Sea;
                }
            }

            // Modular boats (Naval Update): treat standing on a hull piece as "Sea"
            // Example from debug.lookingat:
            // assets/prefabs/building boat/hull.square/hull_square.wood.prefab (ShortPrefabName: hull_square_wood)
            try
            {
                // Parent entity is often null when merely standing on a surface.
                // Raycast down to identify the entity directly under the player's feet.
                var origin = player.transform.position + Vector3.up * 0.25f;
                RaycastHit hit;
                // Use all layers to avoid build-specific layer constants.
                if (Physics.Raycast(origin, Vector3.down, out hit, 4f, ~0, QueryTriggerInteraction.Ignore))
                {
                    BaseEntity under = hit.collider != null ? hit.collider.GetComponentInParent<BaseEntity>() : null;
                    if (under != null)
                    {
                        string shortName = under.ShortPrefabName ?? "";
                        string prefabName = under.PrefabName ?? "";
                        if (shortName.IndexOf("hull_", StringComparison.OrdinalIgnoreCase) >= 0 ||
                            prefabName.IndexOf("building boat/hull", StringComparison.OrdinalIgnoreCase) >= 0 ||
                            prefabName.IndexOf("building_boat/hull", StringComparison.OrdinalIgnoreCase) >= 0)
                            return ChaosLocation.ModularBoat;
                    }
                }
            }
            catch { }

            if (player.IsSwimming())
                return ChaosLocation.Swimming;

            return ChaosLocation.Land;
        }

        /// <summary>
        /// Runs chaos event rules on a timer based on streamer location (Land / Sea / Swimming).
        /// Each location has its own sequence of delayed spawns and effects.
        /// </summary>
        private void RunChaosEvent(ChaosLocation loc, string viewerName, string giftName, Func<string, string> chatMsg)
        {
            BasePlayer GetStreamer() => GetStreamerPlayer();

            void at(float delaySec, Action run)
            {
                timer.Once(delaySec, () =>
                {
                    if (run == null) return;
                    run();
                });
            }

            switch (loc)
            {
                case ChaosLocation.Land:
                    at(3f, () => { var t = GetStreamer(); if (t != null) { SpawnNPC(WolfPrefab, GetPositionNear(t)); Puts($"{LogPrefix} Chaos (Land): wolf"); } });
                    at(6f, () => { var t = GetStreamer(); if (t != null) { SpawnNPC(BearPrefab, GetPositionNear(t)); Puts($"{LogPrefix} Chaos (Land): bear"); } });
                    at(9f, () => { var t = GetStreamer(); if (t != null) { SpawnNPC(BoarPrefab, GetPositionNear(t)); Puts($"{LogPrefix} Chaos (Land): pig"); } });
                    break;
                case ChaosLocation.Sea:
                    at(2f, () => { var t = GetStreamer(); if (t != null) { SpawnShark(GetPositionNear(t), _config?.SharkPrefabPath); Puts($"{LogPrefix} Chaos (Sea): shark"); } });
                    at(5f, () => { var t = GetStreamer(); if (t != null) { SpawnShark(GetPositionNear(t), _config?.SharkPrefabPath); Puts($"{LogPrefix} Chaos (Sea): shark 2"); } });
                    at(8f, () => { var t = GetStreamer(); if (t != null) { SpawnEffect(EffectFireworks, GetPositionNear(t)); Puts($"{LogPrefix} Chaos (Sea): fireworks"); } });
                    at(11f, () => { var t = GetStreamer(); if (t != null) { SpawnShark(GetPositionNear(t), _config?.SharkPrefabPath); Puts($"{LogPrefix} Chaos (Sea): shark 3"); } });
                    break;
                case ChaosLocation.Swimming:
                    at(1f, () => { var t = GetStreamer(); if (t != null) { SpawnShark(GetPositionNear(t), _config?.SharkPrefabPath); SpawnShark(GetPositionNear(t), _config?.SharkPrefabPath); Puts($"{LogPrefix} Chaos (Swimming): 2 sharks"); } });
                    at(4f, () => { var t = GetStreamer(); if (t != null) { SpawnShark(GetPositionNear(t), _config?.SharkPrefabPath); Puts($"{LogPrefix} Chaos (Swimming): shark"); } });
                    at(7f, () => { var t = GetStreamer(); if (t != null) { SpawnShark(GetPositionNear(t), _config?.SharkPrefabPath); Puts($"{LogPrefix} Chaos (Swimming): shark"); } });
                    break;
                case ChaosLocation.ModularBoat:
                    // Standing on modular boat hull: port in patrol boats (scientist RHIB + PT boat)
                    at(2f, () =>
                    {
                        var t = GetStreamer();
                        if (t == null) return;
                        if (SpawnScientistRhib(GetPositionNear(t), _config?.ScientistRhibPrefabPath))
                            Puts($"{LogPrefix} Chaos (Modular Boat): scientist RHIB");
                    });
                    at(6f, () =>
                    {
                        var t = GetStreamer();
                        if (t == null) return;
                        if (SpawnScientistPtBoat(GetPositionNear(t), _config?.ScientistPtBoatPrefabPath))
                            Puts($"{LogPrefix} Chaos (Modular Boat): scientist PT boat");
                    });
                    break;
            }
        }

        /// <summary>
        /// Returns the streamer (player whose display name matches config). Effects and NPCs spawn at/near this player.
        /// If not found or not online, returns null.
        /// </summary>
        private BasePlayer GetStreamerPlayer()
        {
            if (string.IsNullOrWhiteSpace(_config?.StreamerName)) return null;
            string name = _config.StreamerName.Trim();
            foreach (var player in BasePlayer.activePlayerList)
            {
                if (player == null || !player.IsConnected || player.IsDead()) continue;
                if (string.Equals(player.displayName, name, StringComparison.OrdinalIgnoreCase))
                    return player;
            }
            return null;
        }

        /// <summary>
        /// Spawns a one-shot effect at the given world position.
        /// Effect names are from the game manifest (e.g. fx/gas_explosion_small, fx/explosion_01).
        /// </summary>
        private static void SpawnEffect(string effectName, Vector3 position)
        {
            if (string.IsNullOrEmpty(effectName) || position == Vector3.zero) return;
            Effect.server.Run(effectName, position, Vector3.up, null, true);
        }

        /// <summary>
        /// Spawns an NPC (e.g. scientist) at the given position. Clean entry point to add more NPC types later.
        /// </summary>
        private static void SpawnNPC(string prefabPath, Vector3 position)
        {
            if (string.IsNullOrEmpty(prefabPath) || position == Vector3.zero) return;
            BaseEntity entity = GameManager.server.CreateEntity(prefabPath, position, Quaternion.identity, true);
            if (entity != null)
            {
                entity.Spawn();
            }
            else
            {
                UnityEngine.Debug.LogWarning($"[RustMaxxTikTrigger] CreateEntity failed for {prefabPath} at {position}");
            }
        }

        /// <summary>
        /// Spawn one scientist at position. Tries PrefabSniffer path first, then fallbacks. Returns true if spawned.
        /// </summary>
        private static bool SpawnScientist(Vector3 position)
        {
            string[] prefabs = {
                "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_full_lr300.prefab",
                "assets/prefabs/npc/scientist/scientist.prefab",
                "assets/content/npc/scientist/scientist.prefab"
            };
            foreach (string path in prefabs)
            {
                BaseEntity entity = GameManager.server.CreateEntity(path, position, Quaternion.identity, true);
                if (entity != null)
                {
                    entity.Spawn();
                    return true;
                }
            }
            return false;
        }

        /// <summary>
        /// Spawn one shark at position. Shark is a water entity – best results when streamer is in or near water.
        /// If config SharkPrefabPath is set, that path is tried first. Otherwise tries built-in list. To find your path: PrefabSniffer "prefab find shark" or debug.lookingat on a shark in-game.
        /// </summary>
        private static bool SpawnShark(Vector3 position, string configSharkPath = null)
        {
            if (!string.IsNullOrWhiteSpace(configSharkPath))
            {
                BaseEntity entity = GameManager.server.CreateEntity(configSharkPath.Trim(), position, Quaternion.identity, true);
                if (entity != null)
                {
                    entity.Spawn();
                    return true;
                }
            }
            string[] prefabs = {
                // Confirmed from debug.lookingat (Ent: simpleshark):
                "assets/rust.ai/agents/fish/simpleshark.prefab",
                "assets/rust.ai/agents/fish/shark/shark.prefab",
                "assets/content/water/ocean/simpleshark.prefab",
                "assets/content/water/ocean/greatwhite.prefab",
                "assets/content/water/ocean/greatwhiteshark.prefab",
                "assets/prefabs/npc/ocean/simpleshark.prefab",
                "assets/prefabs/npc/ocean/simpleshark_full.prefab",
                "assets/prefabs/npc/ocean/greatwhite.prefab",
                "assets/prefabs/npc/ocean/greatwhiteshark.prefab",
                "assets/bundled/prefabs/autospawn/animals/simpleshark.prefab",
                "assets/bundled/prefabs/autospawn/animals/shark.prefab",
                "assets/bundled/prefabs/autospawn/water/simpleshark.prefab",
                "assets/rust.ai/agents/greatwhite/greatwhite.prefab",
                "assets/rust.ai/agents/simpleshark/simpleshark.prefab",
                "assets/content/entities/ocean/simpleshark.prefab",
                "assets/content/props/underwater/simpleshark.prefab"
            };
            foreach (string path in prefabs)
            {
                BaseEntity entity = GameManager.server.CreateEntity(path, position, Quaternion.identity, true);
                if (entity != null)
                {
                    entity.Spawn();
                    return true;
                }
            }
            UnityEngine.Debug.LogWarning($"[RustMaxxTikTrigger] Shark spawn failed. Set SharkPrefabPath in config (oxide/config/RustMaxxTikTrigger.json) to your shark prefab path. To find it: install PrefabSniffer and run 'prefab find shark', or look at a shark in-game and run 'debug.lookingat' in F1.");
            return false;
        }

        /// <summary>
        /// Spawn a scientist boat (RHIB or PT boat variant with AI and turrets) at position in water.
        /// Tries config overrides first, then Scientist RHIB, then Scientist PT Boat prefabs.
        /// </summary>
        private static bool SpawnScientistBoat(Vector3 position, string configRhibPath = null, string configPtBoatPath = null)
        {
            if (position == Vector3.zero) return false;

            if (!string.IsNullOrWhiteSpace(configRhibPath))
            {
                BaseEntity entity = GameManager.server.CreateEntity(configRhibPath.Trim(), position, Quaternion.identity, true);
                if (entity != null) { entity.Spawn(); return true; }
            }
            if (!string.IsNullOrWhiteSpace(configPtBoatPath))
            {
                BaseEntity entity = GameManager.server.CreateEntity(configPtBoatPath.Trim(), position, Quaternion.identity, true);
                if (entity != null) { entity.Spawn(); return true; }
            }

            string[] prefabs = {
                // Naval Update scientist patrol boats (newer builds)
                "assets/content/vehicles/boats/rhib/rhib_scientist.prefab",
                "assets/content/vehicles/boats/ptboat/ptboat_scientist.prefab",

                // Common legacy / alternate locations (server builds differ)
                "assets/content/vehicles/boats/rhib/rhib.prefab",
                "assets/content/vehicles/boats/ptboat/ptboat.prefab",
                "assets/prefabs/boats/rhib/rhib_scientist.prefab",
                "assets/prefabs/boats/rhib/rhib.prefab",
                "assets/prefabs/boats/ptboat/ptboat_scientist.prefab",
                "assets/prefabs/boats/ptboat/ptboat.prefab"
            };
            foreach (string path in prefabs)
            {
                BaseEntity entity = GameManager.server.CreateEntity(path, position, Quaternion.identity, true);
                if (entity != null)
                {
                    entity.Spawn();
                    return true;
                }
            }
            UnityEngine.Debug.LogWarning("[RustMaxxTikTrigger] Scientist boat spawn failed. Your server build likely doesn't include these prefabs. " +
                                         "Set ScientistRhibPrefabPath / ScientistPtBoatPrefabPath in oxide/config/RustMaxxTikTrigger.json to your correct prefab paths. " +
                                         "To find them: look at a spawned patrol boat and run 'debug.lookingat' in F1, or use PrefabSniffer 'prefab find rhib' / 'prefab find ptboat'.");
            return false;
        }

        private static bool SpawnScientistRhib(Vector3 position, string configRhibPath = null)
        {
            if (position == Vector3.zero) return false;
            if (!string.IsNullOrWhiteSpace(configRhibPath))
            {
                BaseEntity e = GameManager.server.CreateEntity(configRhibPath.Trim(), position, Quaternion.identity, true);
                if (e != null) { e.Spawn(); return true; }
            }
            string[] prefabs = {
                "assets/content/vehicles/boats/rhib/rhib_scientist.prefab",
                "assets/prefabs/boats/rhib/rhib_scientist.prefab",
                "assets/content/vehicles/boats/rhib/rhib.prefab",
                "assets/prefabs/boats/rhib/rhib.prefab"
            };
            foreach (string p in prefabs)
            {
                BaseEntity e = GameManager.server.CreateEntity(p, position, Quaternion.identity, true);
                if (e != null) { e.Spawn(); return true; }
            }
            return false;
        }

        private static bool SpawnScientistPtBoat(Vector3 position, string configPtBoatPath = null)
        {
            if (position == Vector3.zero) return false;
            if (!string.IsNullOrWhiteSpace(configPtBoatPath))
            {
                BaseEntity entity = GameManager.server.CreateEntity(configPtBoatPath.Trim(), position, Quaternion.identity, true);
                if (entity != null) { entity.Spawn(); return true; }
            }
            string[] prefabs = {
                "assets/content/vehicles/boats/ptboat/ptboat_scientist.prefab",
                "assets/prefabs/boats/ptboat/ptboat_scientist.prefab",
                "assets/content/vehicles/boats/ptboat/ptboat.prefab",
                "assets/prefabs/boats/ptboat/ptboat.prefab"
            };
            foreach (string p in prefabs)
            {
                BaseEntity e = GameManager.server.CreateEntity(p, position, Quaternion.identity, true);
                if (e != null) { e.Spawn(); return true; }
            }
            return false;
        }

        /// <summary>
        /// Calls in a supply drop at the given world position (cargo plane flies in and drops the crate automatically).
        /// </summary>
        private static void SpawnSupplyDropAt(Vector3 dropPosition)
        {
            if (dropPosition == Vector3.zero) return;
            BaseEntity ent = GameManager.server.CreateEntity(CargoPlanePrefab, Vector3.zero, Quaternion.identity, true);
            if (ent == null) return;
            var plane = ent as CargoPlane;
            if (plane == null)
            {
                ent.Kill();
                return;
            }
            plane.InitDropPosition(dropPosition);
            ent.Spawn();
        }

        #endregion

        #region Chat

        private void BroadcastChat(string message)
        {
            if (string.IsNullOrEmpty(message)) return;
            foreach (var player in BasePlayer.activePlayerList)
                if (player != null && player.IsConnected)
                    PrintToChat(player, message);
        }

        #endregion
    }
}
