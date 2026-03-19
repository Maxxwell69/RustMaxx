// RustChaos - uMod/Oxide plugin for Rust
//
// Purpose: Safe command interface for external systems (e.g. webhook listener connected to TikFinity)
// to trigger controlled in-game events via RCON.
//
// Webhook flow:
//   TikFinity → webhook listener → RCON command → rustchaos <action> <viewerName> <giftName>
//   → RustChaos executes the whitelisted action (effects, chat, NPC spawn).
//
// Install: copy this file into servers/Rust/oxide/plugins/

using System;
using System.Collections.Generic;
using UnityEngine;
using Oxide.Game.Rust.Cui;
using Oxide.Core;

namespace Oxide.Plugins
{
    [Info("RustChaos", "RustMaxx", "1.9.0")]
    [Description("RCON-only command for TikFinity webhook: rustchaos <action> <viewerName> <giftName>. Supply/likes call in an airdrop automatically at the streamer.")]
    public class RustChaos : RustPlugin
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
            /// <summary>Chaos wave: max distance (meters) from streamer that bears can spawn. Bears spawn between 6m and this radius.</summary>
            public float ChaosWaveBearRadius { get; set; } = 25f;
            /// <summary>Chaos wave: maximum distance (meters) a bear is allowed to roam from the streamer before it gets killed/returned.</summary>
            public float ChaosWaveBearLeashDistance { get; set; } = 18f;
            /// <summary>Healing Hands: amount of health added to the streamer per trigger.</summary>
            public float HealingHandsAmount { get; set; } = 10f;
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

        private const string LogPrefix = "[RustChaos]";

        // Whitelist of allowed actions. Only these are executed; no arbitrary commands.
        private static readonly string[] AllowedActions = { "test", "rose", "smoke", "fireworks", "scientist", "wolf", "bear", "shark", "pig", "supply", "likes", "chaos", "scientistboat", "chaoswave", "chaoswavecancel", "healinghands", "fullheal" };

        // Land chaos wave: 1 bear, then 2, then 3 … up to 10 (next wave when all current bears dead). 10s countdown between waves.
        private const string ChaosWaveUiName = "RustChaos_WaveUI";
        // Countdown seconds between waves:
        // wave 1 -> wave 2 = 20s, wave 2 -> wave 3 = 25s, and default to 30s for the rest (until you tell me different).
        // Index = completedWave - 1 (so [0] is after wave 1).
        private static readonly int[] ChaosWaveCountdownAfterWaveSeconds = { 20, 25, 30, 30, 30, 30, 30, 30, 30, 0 };
        private HashSet<NetworkableId> _chaosWaveBearIds;
        private int _chaosWaveNumber;
        private bool _chaosWaveSubscribed;
        private int _chaosWaveCountdown;
        private Timer _chaosWaveCountdownTimer;
        private ulong _chaosWaveStreamerUserId;
        private Timer _chaosWaveLeashTimer;
        private int _chaosWaveTargetBearCount;
        private int _chaosWaveSpawnedBearCount;
        private int _chaosWaveKilledBearCount;
        private bool _chaosWaveSpawning;

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

        [ConsoleCommand("rustchaos")]
        private void CmdRustChaos(ConsoleSystem.Arg arg)
        {
            // Only allow from server console or RCON (no in-game player execution).
            if (arg.Connection != null)
            {
                arg.ReplyWith("This command can only be run from server console or RCON.");
                return;
            }

            if (!arg.HasArgs(3))
            {
                arg.ReplyWith("Usage: rustchaos <action> <viewerName> <giftName> [scrapAmount] [customMessage]");
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

        // User-side cancel so waves can be stopped even if RCON is unavailable/bugged.
        // Usage in-game (by the streamer who started the wave):
        //   /chaoswavecancel
        [ChatCommand("chaoswavecancel")]
        private void ChatChaosWaveCancel(BasePlayer player, string command, string[] args)
        {
            if (player == null || !player.IsConnected) return;
            if (_chaosWaveBearIds == null || _chaosWaveBearIds.Count == 0)
            {
                SendReply(player, "No chaos wave is currently active.");
                return;
            }

            // Allow the configured streamer OR server admin to cancel.
            if (!player.IsAdmin && _chaosWaveStreamerUserId != 0ul && player.userID != _chaosWaveStreamerUserId)
            {
                SendReply(player, "Only the chaos wave streamer can cancel the wave.");
                return;
            }

            CancelChaosWave("Chaos wave cancelled by user.");
            SendReply(player, "Chaos wave cancelled.");
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

                case "healinghands":
                    if (target != null)
                    {
                        float amount = Mathf.Max(0f, _config?.HealingHandsAmount ?? 10f);
                        target.Heal(amount);
                        BroadcastChat(ChatMsg($"{viewerName} triggered HEALING HANDS! +{amount:0} health"));
                        Puts($"{LogPrefix} Healed streamer {target.displayName} by {amount}");
                    }
                    break;

                case "fullheal":
                    if (target != null)
                    {
                        // Heal() should cap at the player's max health.
                        float big = 99999f;
                        target.Heal(big);
                        BroadcastChat(ChatMsg($"{viewerName} triggered FULL HEALTH!"));
                        Puts($"{LogPrefix} Set streamer {target.displayName} to full health (Heal({big})).");
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

                case "chaoswave":
                    if (target != null)
                    {
                        ChaosLocation loc = GetStreamerChaosLocation(target);
                        if (loc != ChaosLocation.Land)
                        {
                            BroadcastChat(ChatMsg($"Chaos wave is land only. {viewerName} sent {giftName}!"));
                            break;
                        }
                        if (_chaosWaveBearIds != null && _chaosWaveBearIds.Count > 0)
                        {
                            BroadcastChat(ChatMsg("Chaos wave already in progress!"));
                            break;
                        }
                        BroadcastChat(ChatMsg($"{viewerName} started a CHAOS WAVE! Kill the bears…"));
                        StartLandChaosWave(target);
                    }
                    break;

                case "chaoswavecancel":
                    // Admin/admin-like RCON stop button for a glitched wave.
                    CancelChaosWave(ChatMsg("Chaos wave cancelled."));
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
                                PrintWarning($"{LogPrefix} Scientist boat spawn failed. Set ScientistRhibPrefabPath or ScientistPtBoatPrefabPath in oxide/config/RustChaos.json if paths differ on your build.");
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
            return action == "smoke" ||
                   action == "fireworks" ||
                   action == "scientist" ||
                   action == "wolf" ||
                   action == "bear" ||
                   action == "healinghands" ||
                   action == "fullheal" ||
                   action == "shark" ||
                   action == "pig" ||
                   action == "supply" ||
                   action == "likes" ||
                   action == "chaos" ||
                   action == "scientistboat" ||
                   action == "chaoswave";
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
        /// Land chaos wave: spawn 1 bear; when all dead spawn 2, then 3 … up to 10. Requires Land.
        /// </summary>
        private void StartLandChaosWave(BasePlayer streamer)
        {
            _chaosWaveBearIds = new HashSet<NetworkableId>();
            _chaosWaveNumber = 1;
            _chaosWaveStreamerUserId = streamer != null ? streamer.userID : 0ul;
            // Full heal at the moment the wave starts.
            if (streamer != null && streamer.IsValid())
            {
                streamer.Heal(99999f);
            }
            GiveChaosWaveLoadout(streamer, 1);
            if (!_chaosWaveSubscribed)
            {
                Subscribe(nameof(OnEntityDeath));
                _chaosWaveSubscribed = true;
            }
            StartChaosWaveLeashTimer();
            _chaosWaveTargetBearCount = 1;
            _chaosWaveSpawnedBearCount = 0;
            _chaosWaveKilledBearCount = 0;
            _chaosWaveSpawning = true;
            int firstWaveSpawnDelaySeconds = 20;
            ShowChaosWaveUIToAll("Chaos Bear Wave", $"Wave 1\nFirst enemy in {firstWaveSpawnDelaySeconds}s");
            timer.Once(firstWaveSpawnDelaySeconds, () =>
            {
                if (_chaosWaveBearIds == null) return;
                BasePlayer s = GetStreamerPlayer();
                if (s == null || !s.IsValid())
                {
                    CancelChaosWave("Chaos wave cancelled (streamer offline).");
                    return;
                }
                SpawnChaosWaveBears(s, 1);
                BroadcastChat("Chaos wave 1! 1 bear spawned.");
                Puts($"{LogPrefix} Chaos wave 1: 1 bear spawned after delay.");
                ShowChaosWaveUIToAll("Chaos Bear Wave", "Wave 1\nEnemies left: 1");
            });
            Puts($"{LogPrefix} Chaos wave started: wave 1 queued (20s delay).");
        }

        private void StartChaosWaveLeashTimer()
        {
            _chaosWaveLeashTimer?.Destroy();
            _chaosWaveLeashTimer = null;
            float leash = Mathf.Clamp(_config?.ChaosWaveBearLeashDistance ?? 18f, 5f, 80f);
            _chaosWaveLeashTimer = timer.Repeat(1f, 0, () => CheckChaosWaveLeash(leash));
        }

        private void CheckChaosWaveLeash(float leashDistance)
        {
            if (_chaosWaveBearIds == null || _chaosWaveBearIds.Count == 0) return;

            // Find the current streamer position by userID (stable even if name changes).
            Vector3? streamerPos = null;
            foreach (var p in BasePlayer.activePlayerList)
            {
                if (p != null && p.IsConnected && p.userID == _chaosWaveStreamerUserId)
                {
                    streamerPos = p.transform.position;
                    break;
                }
            }
            if (streamerPos == null)
            {
                // streamer offline -> cancel wave
                CancelChaosWave("Chaos wave cancelled (streamer offline).");
                return;
            }

            float leashSqr = leashDistance * leashDistance;
            // Copy ids to avoid mutation during enumeration.
            var ids = new List<NetworkableId>(_chaosWaveBearIds);
            foreach (var nid in ids)
            {
                try
                {
                    var ent = BaseNetworkable.serverEntities.Find(nid) as BaseEntity;
                    if (ent == null || ent.IsDestroyed) continue;
                    Vector3 d = ent.transform.position - streamerPos.Value;
                    if (d.sqrMagnitude > leashSqr)
                    {
                        // Don't kill (player expects bears to "run back" and not disappear).
                        // Instead, steer them back toward the streamer:
                        // 1) rotate toward streamer
                        // 2) if NavMeshAgent exists, SetDestination()
                        // 3) otherwise, push rigidbody velocity in that direction
                        Vector3 toStreamer = streamerPos.Value - ent.transform.position;
                        toStreamer.y = 0f;
                        if (toStreamer.sqrMagnitude > 0.01f)
                            toStreamer.Normalize();

                        // Turn to face streamer.
                        try { ent.transform.rotation = Quaternion.LookRotation(toStreamer); } catch { }

                        // Prefer navigation if present.
                        try
                        {
                            var agent = ent.GetComponent<UnityEngine.AI.NavMeshAgent>();
                            if (agent != null)
                            {
                                agent.isStopped = false;
                                agent.SetDestination(streamerPos.Value);
                            }
                        }
                        catch { }

                        // Fallback: adjust rigidbody velocity.
                        try
                        {
                            var rb = ent.GetComponent<Rigidbody>();
                            if (rb != null && toStreamer.sqrMagnitude > 0.01f)
                            {
                                float speed = rb.velocity.magnitude;
                                if (speed < 2f) speed = 2f;
                                rb.velocity = toStreamer * speed;
                                rb.angularVelocity = Vector3.zero;
                            }
                        }
                        catch { }
                    }
                }
                catch { }
            }
        }

        private void OnEntityDeath(BaseCombatEntity entity, HitInfo info)
        {
            if (entity == null || _chaosWaveBearIds == null) return;

            // If the streamer dies mid-wave, cancel the entire wave.
            BasePlayer deadPlayer = entity as BasePlayer;
            if (deadPlayer != null && _chaosWaveStreamerUserId != 0ul && deadPlayer.userID == _chaosWaveStreamerUserId)
            {
                CancelChaosWave("Chaos wave cancelled (streamer died).");
                return;
            }

            if (!_chaosWaveBearIds.Remove(entity.net.ID)) return;
            _chaosWaveKilledBearCount++;
            int bearsLeftThisWave = Math.Max(0, _chaosWaveTargetBearCount - _chaosWaveKilledBearCount);
            ShowChaosWaveUIToAll("Chaos Bear Wave", $"Wave {_chaosWaveNumber}\nEnemies left: {bearsLeftThisWave}");
            if (_chaosWaveBearIds.Count > 0) return;

            // If we're still in the middle of staged spawning, don't advance the wave yet.
            // This prevents "wave complete" when the first group of bears died but later bears haven't spawned.
            if (_chaosWaveSpawning || _chaosWaveSpawnedBearCount < _chaosWaveTargetBearCount) return;

            int completedWave = _chaosWaveNumber;
            if (completedWave < 1) completedWave = 1;
            if (completedWave > 10) completedWave = 10;

            BasePlayer streamer = GetStreamerPlayer();
            if (streamer == null || !streamer.IsValid())
            {
                Puts($"{LogPrefix} Chaos wave aborted: streamer offline.");
                CancelChaosWave("Chaos wave cancelled (streamer offline).");
                return;
            }

            if (completedWave >= 10)
            {
                // Final reward after wave 10 cleared
                _chaosWaveBearIds = null;
                _chaosWaveSpawning = false;
                _chaosWaveTargetBearCount = 0;
                _chaosWaveSpawnedBearCount = 0;
                _chaosWaveKilledBearCount = 0;
                _chaosWaveLeashTimer?.Destroy();
                _chaosWaveLeashTimer = null;
                if (_chaosWaveSubscribed) { Unsubscribe(nameof(OnEntityDeath)); _chaosWaveSubscribed = false; }
                DestroyChaosWaveUIForAll();
                GiveItemWithLog(streamer, 1, "rocket.launcher", "ChaosWave final reward (rocket launcher)");
                GiveItemWithLog(streamer, 3, "ammo.rocket.basic", "ChaosWave final reward (rockets)");
                BroadcastChat("Chaos wave complete! All 10 waves cleared. Final rockets inbound.");
                Puts($"{LogPrefix} Chaos wave finished.");
                return;
            }

            // Give rewards at the end of the wave (between waves), except wave 1.
            if (completedWave >= 2)
                GiveChaosWaveLoadout(streamer, completedWave);

            // Advance to next wave and start countdown.
            _chaosWaveNumber = completedWave + 1;
            _chaosWaveCountdown = ChaosWaveCountdownAfterWaveSeconds[completedWave - 1];
            if (_chaosWaveCountdown < 0) _chaosWaveCountdown = 0;
            _chaosWaveCountdownTimer?.Destroy();
            _chaosWaveCountdownTimer = timer.Repeat(1f, 0, ChaosWaveCountdownTick);
            ShowChaosWaveUIToAll("Chaos Bear Wave", $"Wave {completedWave} complete\nNext wave in {_chaosWaveCountdown}s");
        }

        private void ChaosWaveCountdownTick()
        {
            _chaosWaveCountdown--;
            ShowChaosWaveUIToAll("Chaos Bear Wave", $"Wave {_chaosWaveNumber - 1} complete\nNext wave in {_chaosWaveCountdown}s");
            if (_chaosWaveCountdown > 0) return;

            _chaosWaveCountdownTimer?.Destroy();
            _chaosWaveCountdownTimer = null;
            BasePlayer streamer = GetStreamerPlayer();
            if (streamer == null || !streamer.IsValid())
            {
                _chaosWaveBearIds = null;
                _chaosWaveLeashTimer?.Destroy();
                _chaosWaveLeashTimer = null;
                if (_chaosWaveSubscribed) { Unsubscribe(nameof(OnEntityDeath)); _chaosWaveSubscribed = false; }
                DestroyChaosWaveUIForAll();
                return;
            }
            SpawnChaosWaveBears(streamer, _chaosWaveNumber);
            BroadcastChat($"Chaos wave {_chaosWaveNumber}! {_chaosWaveNumber} bears spawned.");
            Puts($"{LogPrefix} Chaos wave {_chaosWaveNumber}: {_chaosWaveNumber} bears.");
            ShowChaosWaveUIToAll("Chaos Bear Wave", $"Wave {_chaosWaveNumber}\nEnemies left: {_chaosWaveTargetBearCount}");
        }

        private void ShowChaosWaveUIToAll(string line1, string line2)
        {
            foreach (var player in BasePlayer.activePlayerList)
            {
                if (player != null && player.IsConnected)
                    ShowChaosWaveUI(player, line1, line2);
            }
        }

        private void ShowChaosWaveUI(BasePlayer player, string line1, string line2)
        {
            if (player == null) return;
            CuiHelper.DestroyUi(player, ChaosWaveUiName);
            var container = new CuiElementContainer();
            container.Add(new CuiPanel
            {
                Image = { Color = "0.1 0.1 0.15 0.85" },
                RectTransform = { AnchorMin = "0.02 0.88", AnchorMax = "0.28 0.98" }
            }, "Overlay", ChaosWaveUiName);
            string text = line1;
            if (!string.IsNullOrEmpty(line2)) text += "\n" + line2;
            container.Add(new CuiLabel
            {
                Text = { Text = text, FontSize = 14, Align = TextAnchor.UpperLeft, Color = "1 0.9 0.3 1" },
                RectTransform = { AnchorMin = "0.05 0.1", AnchorMax = "0.95 0.9" }
            }, ChaosWaveUiName);
            CuiHelper.AddUi(player, container);
        }

        private void DestroyChaosWaveUIForAll()
        {
            foreach (var player in BasePlayer.activePlayerList)
            {
                if (player != null && player.IsConnected)
                    CuiHelper.DestroyUi(player, ChaosWaveUiName);
            }
        }

        /// <summary>
        /// Spawns N bears within ChaosWaveBearRadius of the streamer and adds their net IDs to _chaosWaveBearIds.
        /// </summary>
        private void SpawnChaosWaveBears(BasePlayer streamer, int count)
        {
            // Wave spawn state used by OnEntityDeath so we don't "complete the wave"
            // until all staged spawns have happened.
            _chaosWaveTargetBearCount = count;
            _chaosWaveSpawnedBearCount = 0;
            _chaosWaveKilledBearCount = 0;
            _chaosWaveSpawning = count >= 4;

            float maxRadius = Mathf.Clamp(_config?.ChaosWaveBearRadius ?? 25f, 10f, 80f);
            float minRadius = 6f;
            // Ensure we spawn bears within leash distance so they don't get corrected/killed immediately.
            float leashDistance = Mathf.Clamp(_config?.ChaosWaveBearLeashDistance ?? 18f, 5f, 80f);
            float effectiveMaxRadius = Mathf.Min(maxRadius, leashDistance - 1f);
            if (effectiveMaxRadius < minRadius)
                effectiveMaxRadius = minRadius;

            // Spawn everything at once for waves 1-3.
            if (!_chaosWaveSpawning)
            {
                for (int i = 0; i < count; i++)
                {
                    Vector3 pos = GetPositionWithinRadius(streamer, minRadius, effectiveMaxRadius);
                    if (pos == Vector3.zero) pos = GetPositionNear(streamer);
                    BaseEntity bear = GameManager.server.CreateEntity(BearPrefab, pos, Quaternion.identity, true);
                    if (bear != null)
                    {
                        bear.Spawn();
                        _chaosWaveBearIds.Add(bear.net.ID);
                    }
                }
                _chaosWaveSpawnedBearCount = count;
                return;
            }

            // From wave 4 onward: staged group spawns.
            // Even waves: spawn 2 bears per group.
            // Odd waves: spawn 1 bear per group.
            int groupSize = (count % 2 == 0) ? 2 : 1;
            float interval = (count % 2 == 0) ? 1.5f : 1f;

            int spawnedSoFar = 0;
            int groupIndex = 0;
            while (spawnedSoFar < count)
            {
                int thisGroupCount = Math.Min(groupSize, count - spawnedSoFar);
                float delay = groupIndex * interval;
                int scheduledCount = thisGroupCount;
                groupIndex++;
                spawnedSoFar += thisGroupCount;

                timer.Once(delay, () =>
                {
                    // If wave was canceled, stop spawning.
                    if (_chaosWaveBearIds == null || scheduledCount <= 0) return;

                    BasePlayer s = GetStreamerPlayer();
                    if (s == null || !s.IsValid())
                    {
                        CancelChaosWave("Chaos wave cancelled (streamer offline).");
                        return;
                    }

                    for (int i = 0; i < scheduledCount; i++)
                    {
                        Vector3 pos = GetPositionWithinRadius(s, minRadius, effectiveMaxRadius);
                        if (pos == Vector3.zero) pos = GetPositionNear(s);
                        BaseEntity bear = GameManager.server.CreateEntity(BearPrefab, pos, Quaternion.identity, true);
                        if (bear != null)
                        {
                            bear.Spawn();
                            _chaosWaveBearIds.Add(bear.net.ID);
                        }
                    }

                    _chaosWaveSpawnedBearCount += scheduledCount;
                    if (_chaosWaveSpawnedBearCount >= _chaosWaveTargetBearCount)
                        _chaosWaveSpawning = false;
                });
            }
        }

        private void GiveItemWithLog(BasePlayer player, int amount, string shortName, string context)
        {
            if (player == null || !player.IsValid() || amount <= 0 || string.IsNullOrWhiteSpace(shortName)) return;
            var def = ItemManager.FindItemDefinition(shortName);
            if (def == null)
            {
                PrintWarning($"{LogPrefix} ChaosWave: item not found '{shortName}' ({context}).");
                return;
            }
            Item item = ItemManager.Create(def, amount, 0ul);
            if (item == null) return;
            item.MoveToContainer(player.inventory.containerMain);
        }

        private void GiveItemToBeltWithLog(BasePlayer player, int amount, string shortName, string context)
        {
            if (player == null || !player.IsValid() || amount <= 0 || string.IsNullOrWhiteSpace(shortName)) return;
            var def = ItemManager.FindItemDefinition(shortName);
            if (def == null)
            {
                PrintWarning($"{LogPrefix} ChaosWave: item not found '{shortName}' ({context}).");
                return;
            }
            Item item = ItemManager.Create(def, amount, 0ul);
            if (item == null) return;
            // Belt is the typical "quick/arm" slot players expect for holding weapons.
            item.MoveToContainer(player.inventory.containerBelt);
        }

        private void GiveFirstItemWithLog(BasePlayer player, int amount, string[] candidates, string context)
        {
            if (player == null || !player.IsValid() || amount <= 0 || candidates == null || candidates.Length == 0) return;
            foreach (var s in candidates)
            {
                if (string.IsNullOrWhiteSpace(s)) continue;
                var def = ItemManager.FindItemDefinition(s);
                if (def == null) continue;
                Item item = ItemManager.Create(def, amount, 0ul);
                if (item == null) return;
                item.MoveToContainer(player.inventory.containerMain);
                return;
            }
            PrintWarning($"{LogPrefix} ChaosWave: none of the wall/med candidates were found ({context}).");
        }

        private void GiveFirstItemToBeltWithLog(BasePlayer player, int amount, string[] candidates, string context)
        {
            if (player == null || !player.IsValid() || amount <= 0 || candidates == null || candidates.Length == 0) return;
            foreach (var s in candidates)
            {
                if (string.IsNullOrWhiteSpace(s)) continue;
                var def = ItemManager.FindItemDefinition(s);
                if (def == null) continue;
                Item item = ItemManager.Create(def, amount, 0ul);
                if (item == null) return;
                item.MoveToContainer(player.inventory.containerBelt);
                return;
            }
            PrintWarning($"{LogPrefix} ChaosWave: none of the belt item candidates were found ({context}).");
        }

        private void GiveChaosWaveLoadout(BasePlayer streamer, int wave)
        {
            // "Wall" handling: give wooden barricades (as requested).
            // If your server uses a different mapping, plugin will log which item shortnames are missing.
            string[] wallCandidates = { "barricade.cover.wood", "barricade.cover.wood_double", "barricade.wood.cover", "barricade.wood", "barricade.woodwire" };
            string[] buildingPlanCandidates = { "planner", "building.planner" };

            // Med stick + bandage (cloth bandage) shortnames
            string[] medCandidates = { "medstick" };
            const string bandageShort = "bandage";

            // Weapons & ammo
            switch (wave)
            {
                case 1:
                    GiveItemToBeltWithLog(streamer, 1, "bow.hunting", "Round 1 bow (belt/arm slot)");
                    GiveItemWithLog(streamer, 100, "arrow.wooden", "Round 1 arrows (100)");
                    GiveFirstItemWithLog(streamer, 1, buildingPlanCandidates, "Round 1 building plan");
                    GiveItemWithLog(streamer, 750, "wood", "Round 1 wood (750)");
                    GiveFirstItemToBeltWithLog(streamer, 2, wallCandidates, "Round 1 wooden barricades (2, belt/arm slot)");
                    GiveFirstItemWithLog(streamer, 1, medCandidates, "Round 1 med stick");
                    GiveItemWithLog(streamer, 3, bandageShort, "Round 1 bandages (3)");
                    break;

                case 2:
                    GiveFirstItemWithLog(streamer, 2, medCandidates, "Round 2 med sticks");
                    GiveItemWithLog(streamer, 2, bandageShort, "Round 2 cloth bandages");
                    GiveFirstItemWithLog(streamer, 1, wallCandidates, "Round 2 wall");
                    break;

                case 3:
                    GiveItemWithLog(streamer, 1, "smg.2", "Round 3 custom SMG");
                    // End-of-wave rewards are granted between waves; give 100 so level 4 starts with 100 pistol bullets.
                    GiveItemWithLog(streamer, 100, "ammo.pistol", "Round 3 pistol ammo (100)");
                    GiveFirstItemWithLog(streamer, 2, medCandidates, "Round 3 med sticks");
                    GiveItemWithLog(streamer, 3, bandageShort, "Round 3 bandages (3)");
                    break;

                case 4:
                    GiveItemWithLog(streamer, 100, "ammo.pistol", "Round 4 pistol ammo (100)");
                    GiveFirstItemWithLog(streamer, 3, medCandidates, "Round 4 med sticks");
                    GiveItemWithLog(streamer, 2, bandageShort, "Round 4 bandages (2)");
                    GiveFirstItemWithLog(streamer, 2, wallCandidates, "Round 4 walls (2)");
                    break;

                case 5:
                    GiveItemWithLog(streamer, 1, "rifle.semiauto", "Round 5 semi-auto rifle");
                    GiveItemWithLog(streamer, 25, "ammo.rifle", "Round 5 5.56 ammo (25)");
                    GiveFirstItemWithLog(streamer, 3, medCandidates, "Round 5 med sticks");
                    GiveItemWithLog(streamer, 2, bandageShort, "Round 5 bandages (2)");
                    GiveFirstItemWithLog(streamer, 1, wallCandidates, "Round 5 wall (1)");
                    break;

                case 6:
                    GiveItemWithLog(streamer, 100, "ammo.rifle", "Round 6 5.56 ammo (100)");
                    GiveFirstItemWithLog(streamer, 2, medCandidates, "Round 6 med sticks");
                    GiveItemWithLog(streamer, 2, bandageShort, "Round 6 bandages (2)");
                    break;

                case 7:
                    GiveItemWithLog(streamer, 5, "grenade.f1", "Round 7 grenades (5)");
                    GiveItemWithLog(streamer, 100, "ammo.rifle", "Round 7 5.56 ammo (100)");
                    GiveFirstItemWithLog(streamer, 3, medCandidates, "Round 7 med sticks");
                    GiveItemWithLog(streamer, 2, bandageShort, "Round 7 bandages (2)");
                    break;

                case 8:
                    GiveItemWithLog(streamer, 1, "rifle.ak", "Round 8 AK");
                    GiveItemWithLog(streamer, 100, "ammo.rifle", "Round 8 5.56 ammo (100)");
                    GiveFirstItemWithLog(streamer, 3, medCandidates, "Round 8 med sticks");
                    break;

                case 9:
                    GiveItemWithLog(streamer, 100, "ammo.rifle", "Round 9 5.56 ammo (100)");
                    GiveFirstItemWithLog(streamer, 2, medCandidates, "Round 9 med sticks");
                    GiveItemWithLog(streamer, 3, bandageShort, "Round 9 bandages (3)");
                    break;

                case 10:
                    GiveItemWithLog(streamer, 100, "ammo.rifle", "Round 10 5.56 ammo (100)");
                    GiveFirstItemWithLog(streamer, 2, medCandidates, "Round 10 med sticks");
                    GiveItemWithLog(streamer, 3, "grenade.f1", "Round 10 grenades (3)");
                    break;
            }
        }

        private void CancelChaosWave(string chatMessage)
        {
            // Kill tracked bears (if any) and reset wave state.
            try
            {
                if (_chaosWaveBearIds != null)
                {
                    foreach (var nid in _chaosWaveBearIds)
                    {
                        try
                        {
                            // Lookup by NetworkableId (serverEntities.Find signature differs across Rust builds).
                            var ent = BaseNetworkable.serverEntities.Find(nid) as BaseCombatEntity;
                            if (ent != null && !ent.IsDestroyed)
                                ent.Kill();
                        }
                        catch { }
                    }
                }
            }
            finally
            {
                _chaosWaveBearIds = null;
                _chaosWaveNumber = 0;
                _chaosWaveTargetBearCount = 0;
                _chaosWaveSpawnedBearCount = 0;
                _chaosWaveKilledBearCount = 0;
                _chaosWaveSpawning = false;
                _chaosWaveCountdown = 0;
                _chaosWaveStreamerUserId = 0ul;
                _chaosWaveLeashTimer?.Destroy();
                _chaosWaveLeashTimer = null;
                _chaosWaveCountdownTimer?.Destroy();
                _chaosWaveCountdownTimer = null;
                if (_chaosWaveSubscribed)
                {
                    Unsubscribe(nameof(OnEntityDeath));
                    _chaosWaveSubscribed = false;
                }
                DestroyChaosWaveUIForAll();
                if (!string.IsNullOrEmpty(chatMessage))
                    BroadcastChat(chatMessage);
            }
        }

        /// <summary>
        /// Random position on the horizontal plane within minRadius..maxRadius of the player. Used for chaos wave bears.
        /// </summary>
        private static Vector3 GetPositionWithinRadius(BasePlayer player, float minRadius, float maxRadius)
        {
            if (player == null || !player.IsValid() || maxRadius < minRadius) return Vector3.zero;
            Vector3 pos = player.transform.position;
            Vector3 offset = UnityEngine.Random.insideUnitSphere;
            offset.y = 0f;
            if (offset.sqrMagnitude < 0.01f) offset = Vector3.forward;
            offset.Normalize();
            float distance = UnityEngine.Random.Range(minRadius, maxRadius);
            return pos + offset * distance;
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
                UnityEngine.Debug.LogWarning($"[RustChaos] CreateEntity failed for {prefabPath} at {position}");
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
            UnityEngine.Debug.LogWarning($"[RustChaos] Shark spawn failed. Set SharkPrefabPath in config (oxide/config/RustChaos.json) to your shark prefab path. To find it: install PrefabSniffer and run 'prefab find shark', or look at a shark in-game and run 'debug.lookingat' in F1.");
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
                "assets/content/vehicles/boats/rhib/rhib.deepsea.prefab",
                "assets/content/vehicles/boats/ptboat/ptboat.deepsea.prefab",
                "assets/content/vehicles/boats/rhib/rhib.prefab",
                "assets/content/vehicles/boats/ptboat/ptboat.prefab",
                "assets/content/vehicles/boats/rhib/rhibaidriver.prefab",
                "assets/content/vehicles/boats/ptboat/ptboataidriver.prefab",
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
            UnityEngine.Debug.LogWarning("[RustChaos] Scientist boat spawn failed. Your server build likely doesn't include these prefabs. " +
                                         "Set ScientistRhibPrefabPath / ScientistPtBoatPrefabPath in oxide/config/RustChaos.json to your correct prefab paths. " +
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
                "assets/content/vehicles/boats/rhib/rhib.deepsea.prefab",
                "assets/content/vehicles/boats/rhib/rhib.prefab",
                "assets/content/vehicles/boats/rhib/rhibaidriver.prefab",
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
                "assets/content/vehicles/boats/ptboat/ptboat.deepsea.prefab",
                "assets/content/vehicles/boats/ptboat/ptboat.prefab",
                "assets/content/vehicles/boats/ptboat/ptboataidriver.prefab",
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
