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
using System.Linq;
using System.Reflection;
using UnityEngine;
using Rust;
using Oxide.Game.Rust.Cui;
using Oxide.Core;

namespace Oxide.Plugins
{
    [Info("RustChaos", "RustMaxx", "1.15.31")]
    [Description("RCON-only command for TikFinity webhook: rustchaos <action> <viewerName> <giftName>. Viewer bots: use MaxxInvaders maxxinvaders.spawn from RustMaxx webhook (bunny1npc action). chaosheli: crate + patrol heli + homing launcher.")]
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

            /// <summary>Heli Chaos: seconds after trigger before spawning the locked (hackable) crate near the streamer.</summary>
            public float HeliChaosCrateDelaySeconds { get; set; } = 6f;
            /// <summary>Heli Chaos: seconds after trigger before spawning the patrol helicopter.</summary>
            public float HeliChaosPatrolDelaySeconds { get; set; } = 30f;
            /// <summary>Heli Chaos: minimum seconds between bonus locked crates when helis are shot down during an active session.</summary>
            public float HeliChaosCrateBonusCooldownSeconds { get; set; } = 60f;
            /// <summary>Optional. Patrol helicopter prefab if your build path differs (empty = built-in list).</summary>
            public string PatrolHelicopterPrefabPath { get; set; } = "";
            /// <summary>Optional. Hackable locked crate prefab (empty = built-in list).</summary>
            public string HackableLockedCratePrefabPath { get; set; } = "";
            /// <summary>Optional. Tiger chaos wave: prefab path if your build differs (empty = built-in candidate list).</summary>
            public string TigerPrefabPath { get; set; } = "";
            /// <summary>Optional. Panther chaos wave: prefab path if your build differs (empty = built-in candidate list).</summary>
            public string PantherPrefabPath { get; set; } = "";
            /// <summary>Optional. Crocodile gift spawn: prefab path if your build differs (empty = built-in candidate list).</summary>
            public string CrocodilePrefabPath { get; set; } = "";
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

        /// <summary>After Revive Chaos: re-clear bleed + full-heal each metabolism tick; block Fall hits; resync position — all for this window so delayed bleed/fall from the original knockdown cannot kill the streamer.</summary>
        private const float ReviveChaosProtectSeconds = 12f;
        private const float SingleSpawnDelaySeconds = 10f;
        private readonly Dictionary<ulong, float> _reviveChaosProtectUntil = new Dictionary<ulong, float>();

        private const string StatusFxUiRoot = "RustChaos_StatusFx";
        private const string StatusBlindRoot = "RustChaos_StatusBlind";

        private sealed class StreamerTimedStatusRow
        {
            public string Kind;
            public float EndTime;
            public bool BlindOverlay;
            public string ViewerName;
            public string GiftName;
            /// <summary>Used by statushealthx3 — restore max HP when the effect ends.</summary>
            public float HealthX3OriginalMax = -1f;
            /// <summary>Backup footwear item uid (flippers) to restore when status ends.</summary>
            public ulong FlippersBackupItemUid;
        }

        private readonly Dictionary<ulong, ulong> _flippersBackupItemByUser = new Dictionary<ulong, ulong>();

        private readonly List<StreamerTimedStatusRow> _streamerTimedStatuses = new List<StreamerTimedStatusRow>();
        private Timer _streamerStatusUiTimer;

        private void Init()
        {
            // Always on: chaos-wave kills + heli-chaos bonus crates (see OnEntityDeath).
            Subscribe(nameof(OnEntityDeath));
            Subscribe(nameof(OnPlayerMetabolize));
            Subscribe(nameof(OnPlayerDisconnected));
            Subscribe(nameof(OnEntityTakeDamage));
        }

        private void Unload()
        {
            _soloWildLeashTimer?.Destroy();
            _soloWildLeashTimer = null;
            _soloWildHumanNpcSteerTimer?.Destroy();
            _soloWildHumanNpcSteerTimer = null;
            _soloWildAnimalIds = null;
            _soloWildStreamerUserId = 0ul;
            _reviveChaosProtectUntil.Clear();
            DestroyStreamerStatusTicker();
            _streamerTimedStatuses.Clear();
            _flippersBackupItemByUser.Clear();
            ClearStreamerStatusUiForAllPlayers();
        }

        private void OnPlayerDisconnected(BasePlayer player, string reason)
        {
            if (player == null) return;
            _reviveChaosProtectUntil.Remove(player.userID);
            _flippersBackupItemByUser.Remove(player.userID);
            if (IsConfiguredStreamer(player))
                ClearStreamerTimedStatusesAndUi("streamer_disconnected", player);
        }

        /// <summary>Cancel Fall damage during post-revive window (residual impact velocity / late ApplyFallDamageFromVelocity after RecoverFromWounded).</summary>
        private object OnEntityTakeDamage(BaseCombatEntity entity, HitInfo info)
        {
            if (entity == null || info == null) return null;
            var bp = entity as BasePlayer;
            if (bp == null || bp.IsNpc || !bp.IsValid()) return null;
            // Time God Mode — configured streamer takes no incoming hit damage while effect is active.
            if (IsConfiguredStreamer(bp) && HasActiveStreamerStatusKind("godmode"))
            {
                TryNullifyHitInfoDamage(info);
                return true;
            }

            ulong uid = bp.userID;
            if (!_reviveChaosProtectUntil.TryGetValue(uid, out float until)) return null;
            if (Time.realtimeSinceStartup > until)
            {
                _reviveChaosProtectUntil.Remove(uid);
                return null;
            }
            try
            {
                if (info.damageTypes != null && info.damageTypes.Get(DamageType.Fall) > 0f)
                    return true;
            }
            catch
            {
                // ignore
            }
            return null;
        }

        /// <summary>Runs after PlayerMetabolism.ServerUpdate — bleed damage may already apply this tick; clear + heal so the streamer cannot die to residual bleed right after revive.</summary>
        private void OnPlayerMetabolize(PlayerMetabolism instance, BaseCombatEntity ownerEntity, float delta)
        {
            if (instance == null || ownerEntity == null) return;
            var bp = ownerEntity as BasePlayer;
            if (bp == null || !bp.IsValid()) return;
            ulong uid = bp.userID;
            if (IsConfiguredStreamer(bp) && HasActiveStreamerStatusKind("godmode"))
            {
                // Some damage (bleed/poison/radiation ticks) bypasses HitInfo hooks; keep the streamer topped while godmode runs.
                TryClearBleedMetabolismAttributes(instance);
                TryTopUpGodModeMetabolism(instance);
                try
                {
                    bp.Heal(99999f);
                }
                catch
                {
                    // ignore
                }
            }

            // Flash — keep stamina high so the streamer can sprint continuously (feels like 2x mobility).
            // PlayerMetabolism.stamina exists on many builds but not all Oxide reference assemblies; use reflection.
            if (IsConfiguredStreamer(bp) && HasActiveStreamerStatusKind("flash"))
                TryTopUpFlashStamina(bp, instance);

            if (!_reviveChaosProtectUntil.TryGetValue(uid, out float until)) return;
            if (Time.realtimeSinceStartup > until)
            {
                _reviveChaosProtectUntil.Remove(uid);
                return;
            }
            TryClearBleedMetabolismAttributes(instance);
            try
            {
                bp.Heal(99999f);
            }
            catch
            {
                // ignore
            }
        }

        private static void TryNullifyHitInfoDamage(HitInfo info)
        {
            if (info == null) return;
            try
            {
                info.damageTypes?.Clear();
            }
            catch
            {
                // ignore
            }

            try
            {
                info.HitMaterial = 0U;
                info.PointStart = info.PointEnd;
            }
            catch
            {
                // ignore
            }
        }

        /// <summary>Best-effort metabolism clear for godmode across Rust/Oxide builds (reflection-safe).</summary>
        private static void TryTopUpGodModeMetabolism(PlayerMetabolism metabolism)
        {
            if (metabolism == null) return;
            try
            {
                foreach (PropertyInfo prop in metabolism.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
                {
                    object obj = prop.GetValue(metabolism, null);
                    if (obj == null) continue;
                    PropertyInfo valueProp = obj.GetType().GetProperty("value", BindingFlags.Public | BindingFlags.Instance);
                    PropertyInfo minProp = obj.GetType().GetProperty("min", BindingFlags.Public | BindingFlags.Instance);
                    PropertyInfo maxProp = obj.GetType().GetProperty("max", BindingFlags.Public | BindingFlags.Instance);
                    if (valueProp == null || valueProp.PropertyType != typeof(float)) continue;

                    string n = prop.Name.ToLowerInvariant();
                    if (n.Contains("bleed") || n.Contains("poison") || n.Contains("radiation") || n.Contains("calorie") ||
                        n.Contains("hydration") || n.Contains("wetness") || n.Contains("temperature") || n.Contains("cold") ||
                        n.Contains("heat"))
                    {
                        float next = 0f;
                        if (n.Contains("calorie") || n.Contains("hydration"))
                        {
                            if (maxProp != null && maxProp.PropertyType == typeof(float))
                                next = (float)maxProp.GetValue(obj, null);
                        }
                        else if (minProp != null && minProp.PropertyType == typeof(float))
                        {
                            next = (float)minProp.GetValue(obj, null);
                        }
                        valueProp.SetValue(obj, next, null);
                    }
                }
            }
            catch
            {
                // ignore
            }

            try
            {
                metabolism.SendChangesToClient();
            }
            catch
            {
                // ignore
            }
        }

        /// <summary>
        /// Flash effect: max stamina so sprint does not drain. Some server DLLs omit <c>PlayerMetabolism.stamina</c> from the
        /// Oxide reference — set via reflection when the property exists at runtime.
        /// </summary>
        private static void TryTopUpFlashStamina(BasePlayer bp, PlayerMetabolism metabolism)
        {
            if (bp == null || metabolism == null) return;
            try
            {
                PropertyInfo stProp = typeof(PlayerMetabolism).GetProperty("stamina",
                    BindingFlags.Public | BindingFlags.Instance);
                if (stProp == null) return;
                object staminaAttr = stProp.GetValue(metabolism, null);
                if (staminaAttr == null) return;
                Type t = staminaAttr.GetType();
                PropertyInfo maxP = t.GetProperty("max", BindingFlags.Public | BindingFlags.Instance);
                PropertyInfo valP = t.GetProperty("value", BindingFlags.Public | BindingFlags.Instance);
                if (maxP == null || valP == null) return;
                object maxObj = maxP.GetValue(staminaAttr, null);
                if (maxObj is float maxF)
                    valP.SetValue(staminaAttr, maxF, null);
                metabolism.SendChangesToClient();
            }
            catch
            {
                // stamina API missing or different on this build
            }
        }

        /// <summary>Uses Oxide Teleport path (SetServerFall + MovePosition + ForcePositionTo) to clear stale fall/movement state after RecoverFromWounded.</summary>
        private void TryForceResyncRevivedPlayer(ulong userId, Vector3 position)
        {
            BasePlayer p = rust.FindPlayerById(userId);
            if (p == null || !p.IsValid()) return;
            try
            {
                rust.ForcePlayerPosition(p, position.x, position.y, position.z);
            }
            catch (Exception ex)
            {
                PrintWarning($"{LogPrefix} Revive Chaos position resync: {ex.Message}");
            }
        }

        #region Constants

        private const string LogPrefix = "[RustChaos]";

        // Whitelist of allowed actions. Only these are executed; no arbitrary commands.
        private static readonly string[] AllowedActions = { "test", "rose", "smoke", "fireworks", "scientist", "scientistflame", "wolf", "bear", "tiger", "panther", "crocodile", "shark", "pig", "chicken", "supply", "likes", "chaos", "scientistboat", "chaoswave", "chaoswavewolf", "chaoswavepig", "chaoswavetiger", "chaoswavepanther", "chaoswaverandom", "chaoswavecancel", "healinghands", "fullheal", "revivechaos", "chaosheli", "bunny1", "pistolammo50", "statuspoison", "statusdehydrated", "statushungry", "statusbleeding", "statusdart", "statusgodmode", "statusbullethell", "statusflippers", "statusflash", "statushealthx3" };

        // Land chaos wave: 1 bear, then 2, then 3 … up to 10 (next wave when all current bears dead). 10s countdown between waves.
        private const string ChaosWaveUiName = "RustChaos_WaveUI";
        // Countdown seconds between waves:
        // wave 1 -> wave 2 = 20s, wave 2 -> wave 3 = 25s, and default to 30s for the rest (until you tell me different).
        // Index = completedWave - 1 (so [0] is after wave 1).
        private static readonly int[] ChaosWaveCountdownAfterWaveSeconds = { 20, 25, 30, 30, 30, 30, 30, 30, 30, 0 };
        private HashSet<NetworkableId> _chaosWaveEnemyIds;
        private int _chaosWaveNumber;
        private int _chaosWaveCountdown;
        private Timer _chaosWaveCountdownTimer;
        private ulong _chaosWaveStreamerUserId;
        private Timer _chaosWaveLeashTimer;
        /// <summary>High-frequency steering for HumanNPC scientists (Brain.Navigator); separate from 1s animal leash.</summary>
        private Timer _chaosWaveHumanNpcSteerTimer;

        /// <summary>Standalone wolf/bear/pig/shark: leash + nav toward streamer (same radius as chaos wave).</summary>
        private HashSet<NetworkableId> _soloWildAnimalIds;
        private ulong _soloWildStreamerUserId;
        private Timer _soloWildLeashTimer;
        /// <summary>Scientists use Brain.Navigator like chaos wave — 1s leash tick is too slow; mirror 0.4s steer.</summary>
        private Timer _soloWildHumanNpcSteerTimer;
        private int _chaosWaveTargetBearCount;
        private int _chaosWaveSpawnedBearCount;
        private int _chaosWaveKilledBearCount;
        private bool _chaosWaveSpawning;
        private ChaosWaveMode _chaosWaveMode;
        private string _chaosWaveUiTitle = "Chaos Wave";
        /// <summary>Random wave: planned prefab per spawn slot (matches preview shown between waves).</summary>
        private List<string> _chaosWaveRandomWavePlan;
        private int _chaosWaveRandomPlanIndex;
        /// <summary>Random wave: prefabs for the upcoming wave, built when the previous wave ends.</summary>
        private List<string> _chaosWaveRandomPrefabsNext;
        private string _chaosWaveRandomNextWavePreview;

        /// <summary>Heli Chaos: session active (bonus crate on counter-heli kill).</summary>
        private bool _heliChaosActive;
        private ulong _heliChaosStreamerUserId;
        private float _heliChaosNextBonusCrateTime;

        private static readonly string[] HackableLockedCratePrefabCandidates =
        {
            "assets/prefabs/deployable/chinooklockedcrate/codelockedhackablecrate.prefab",
            "assets/prefabs/misc/chinooklockedcrate/codelockedhackablecrate.prefab"
        };

        private static readonly string[] PatrolHelicopterPrefabCandidates =
        {
            "assets/prefabs/npc/patrol helicopter/patrolhelicopter.prefab",
            "assets/content/vehicles/attackhelicopter/attackhelicopter.entity.prefab"
        };

        /// <summary>Streamer location for chaos event: determines which timer rules run.</summary>
        private enum ChaosLocation { Land, Sea, Swimming, ModularBoat }

        /// <summary>Land chaos wave enemy family (same progression + loadouts as bear wave).</summary>
        private enum ChaosWaveMode { Bear, Wolf, Boar, Tiger, Panther, Random }

        // Effect prefab paths (full paths; short names like "fx/..." are not valid in current Rust).
        private const string EffectSmoke = "assets/bundled/prefabs/fx/smoke_signal_full.prefab";
        private const string EffectFireworks = "assets/bundled/prefabs/fx/fireball_small.prefab";

        private const string ScientistPrefab = "assets/prefabs/npc/scientist/scientist.prefab";
        private const string WolfPrefab = "assets/rust.ai/agents/wolf/wolf.prefab";
        private const string BearPrefab = "assets/rust.ai/agents/bear/bear.prefab";
        private const string BoarPrefab = "assets/rust.ai/agents/boar/boar.prefab";
        private const string CargoPlanePrefab = "assets/prefabs/npc/cargo plane/cargo_plane.prefab";

        /// <summary>Chicken gift spawn — try common Facepunch paths per server build.</summary>
        private static readonly string[] ChickenPrefabCandidates =
        {
            "assets/rust.ai/agents/chicken/chicken.prefab",
            "assets/rust.ai/animals/chicken.prefab",
            "assets/bundled/prefabs/autospawn/animals/chicken/chicken.prefab"
        };

        /// <summary>Heavy / oil-rig style scientist with flamethrower; fall back to heavy if path missing.</summary>
        private static readonly string[] FlameScientistPrefabCandidates =
        {
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_heavy_flame.prefab",
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_heavy.prefab"
        };

        /// <summary>Candidate prefabs for tiger chaos / random pool — override first via TigerPrefabPath in config.</summary>
        private static readonly string[] TigerPrefabCandidates =
        {
            "assets/rust.ai/agents/tiger/tiger.prefab",
            "assets/rust.ai/agents/bigcat/tiger.prefab",
            "assets/rust.ai/agents/cat/tiger.prefab"
        };

        /// <summary>Candidate prefabs for panther chaos / random pool — override first via PantherPrefabPath in config.</summary>
        private static readonly string[] PantherPrefabCandidates =
        {
            "assets/rust.ai/agents/panther/panther.prefab",
            "assets/rust.ai/agents/bigcat/panther.prefab",
            "assets/rust.ai/agents/cat/panther.prefab"
        };

        /// <summary>Candidate prefabs for crocodile gift spawn — override first via CrocodilePrefabPath in config.</summary>
        private static readonly string[] CrocodilePrefabCandidates =
        {
            "assets/rust.ai/agents/crocodile/crocodile.prefab",
            "assets/rust.ai/agents/crocodile/crocodile.entity.prefab"
        };

        /// <summary>
        /// Land chaos random wave: mix of animals + scientists (failed prefab paths skipped per build).
        /// Scientists get 0.4s Brain.Navigator steer + provoke; animals get NavMesh + provoke like other waves.
        /// </summary>
        private static readonly string[] ChaosWaveRandomPrefabPool =
        {
            WolfPrefab,
            BearPrefab,
            BoarPrefab,
            TigerPrefabCandidates[0],
            TigerPrefabCandidates[1],
            TigerPrefabCandidates[2],
            PantherPrefabCandidates[0],
            PantherPrefabCandidates[1],
            PantherPrefabCandidates[2],
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_full_lr300.prefab",
            "assets/prefabs/npc/scientist/scientist.prefab",
            "assets/content/npc/scientist/scientist.prefab",
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_heavy.prefab",
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_roam.prefab",
            WolfPrefab,
            BearPrefab,
            BoarPrefab,
            "assets/prefabs/npc/halloween/zombie/zombie.prefab"
        };

        /// <summary>
        /// Scientist prefabs for single-action and direct scientist spawns.
        /// Prioritize tougher/more tactical variants first (DeepSea/oilrig style), then fall back.
        /// </summary>
        private static readonly string[] SingleScientistPrefabCandidates =
        {
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_oilrig.prefab",
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_roam.prefab",
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_heavy.prefab",
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_full_lr300.prefab"
        };

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
                arg.ReplyWith("Usage: rustchaos <action> <viewerName> <giftName> [scrapOrDurationSec] [customMessage] — statuspoison/statusdehydrated/statushungry/statusbleeding/statusdart use arg4 as duration (default 10, max 120).");
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

            string failReply = ExecuteAction(action, viewerName, giftName, scrapAmount, customMessage);
            if (!string.IsNullOrEmpty(failReply))
            {
                arg.ReplyWith(failReply);
                return;
            }

            arg.ReplyWith($"OK: {action}" + (scrapAmount > 0 ? $" +{scrapAmount} scrap" : ""));
        }

        // User-side cancel so waves can be stopped even if RCON is unavailable/bugged.
        // Usage in-game (by the streamer who started the wave):
        //   /chaoswavecancel
        [ChatCommand("chaoswavecancel")]
        private void ChatChaosWaveCancel(BasePlayer player, string command, string[] args)
        {
            if (player == null || !player.IsConnected) return;
            if (_chaosWaveEnemyIds == null)
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

        /// <summary>Runs the action. Returns null on success; otherwise a single-line RCON reply starting with FAILED: (or other error) for webhooks.</summary>
        private string ExecuteAction(string action, string viewerName, string giftName, int scrapAmount, string customMessage = null)
        {
            BasePlayer target = GetStreamerPlayer();
            if (target == null && ActionRequiresPlayer(action))
            {
                string sn = _config?.StreamerName?.Trim() ?? "(empty)";
                PrintWarning($"{LogPrefix} Streamer '{sn}' not online or name mismatch. Action '{action}' cancelled.");
                return $"FAILED: Streamer not found. Set RustChaos.json StreamerName to their exact display name; they must be awake online OR sleeping on the server (not fully disconnected). Configured: '{sn}'.";
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
                        ScheduleDelayedSingleSpawn("scientist", target.userID, () =>
                        {
                            BasePlayer current = FindConnectedPlayerByUserId(target.userID);
                            if (current == null || !current.IsValid()) return;
                            Vector3 pos = GetSingleSpawnPosition(current);
                            if (pos != Vector3.zero && TrySpawnSingleScientist(current, pos))
                                Puts($"{LogPrefix} Spawned 1 scientist near {current.displayName}");
                            else
                                PrintWarning($"{LogPrefix} Single scientist spawn failed (combat scientist prefabs).");
                        });
                    }
                    break;

                case "scientistflame":
                    if (target == null)
                        PrintWarning($"{LogPrefix} Flame scientist skipped: streamer not online. Set StreamerName in config (current: '{_config?.StreamerName ?? ""}').");
                    else
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}! (flame scientist)"));
                        ScheduleDelayedSingleSpawn("scientistflame", target.userID, () =>
                        {
                            BasePlayer current = FindConnectedPlayerByUserId(target.userID);
                            if (current == null || !current.IsValid()) return;
                            Vector3 pos = GetSingleSpawnPosition(current);
                            if (pos != Vector3.zero && TrySpawnSingleScientistFromCandidates(current, pos, FlameScientistPrefabCandidates))
                                Puts($"{LogPrefix} Spawned 1 flame scientist near {current.displayName}");
                            else
                                PrintWarning($"{LogPrefix} Flame scientist spawn failed (prefab paths).");
                        });
                    }
                    break;

                case "wolf":
                    if (target != null)
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}!"));
                        ScheduleDelayedSingleSpawn("wolf", target.userID, () =>
                        {
                            BasePlayer current = FindConnectedPlayerByUserId(target.userID);
                            if (current == null || !current.IsValid()) return;
                            if (TrySpawnSoloWildAnimal(current, WolfPrefab, "wolf"))
                                Puts($"{LogPrefix} Spawned 1 wolf near {current.displayName}");
                            else
                                PrintWarning($"{LogPrefix} Wolf spawn failed (CreateEntity).");
                        });
                    }
                    break;

                case "bear":
                    if (target != null)
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}!"));
                        ScheduleDelayedSingleSpawn("bear", target.userID, () =>
                        {
                            BasePlayer current = FindConnectedPlayerByUserId(target.userID);
                            if (current == null || !current.IsValid()) return;
                            if (TrySpawnSoloWildAnimal(current, BearPrefab, "bear"))
                                Puts($"{LogPrefix} Spawned 1 bear near {current.displayName}");
                            else
                                PrintWarning($"{LogPrefix} Bear spawn failed (CreateEntity).");
                        });
                    }
                    break;

                case "tiger":
                    if (target != null)
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}!"));
                        ScheduleDelayedSingleSpawn("tiger", target.userID, () =>
                        {
                            BasePlayer current = FindConnectedPlayerByUserId(target.userID);
                            if (current == null || !current.IsValid()) return;
                            if (TrySpawnTigerOneNearStreamer(current))
                                Puts($"{LogPrefix} Spawned 1 tiger near {current.displayName}");
                            else
                            {
                                BroadcastChat(ChatMsg($"{viewerName} sent a tiger but spawn failed — set TigerPrefabPath in RustChaos.json."));
                                PrintWarning($"{LogPrefix} Tiger spawn failed (all prefab candidates).");
                            }
                        });
                    }
                    break;

                case "panther":
                    if (target != null)
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}!"));
                        ScheduleDelayedSingleSpawn("panther", target.userID, () =>
                        {
                            BasePlayer current = FindConnectedPlayerByUserId(target.userID);
                            if (current == null || !current.IsValid()) return;
                            if (TrySpawnPantherOneNearStreamer(current))
                                Puts($"{LogPrefix} Spawned 1 panther near {current.displayName}");
                            else
                            {
                                BroadcastChat(ChatMsg($"{viewerName} sent a panther but spawn failed — set PantherPrefabPath in RustChaos.json."));
                                PrintWarning($"{LogPrefix} Panther spawn failed (all prefab candidates).");
                            }
                        });
                    }
                    break;

                case "crocodile":
                    if (target != null)
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}!"));
                        ScheduleDelayedSingleSpawn("crocodile", target.userID, () =>
                        {
                            BasePlayer current = FindConnectedPlayerByUserId(target.userID);
                            if (current == null || !current.IsValid()) return;
                            if (TrySpawnCrocodileOneNearStreamer(current))
                                Puts($"{LogPrefix} Spawned 1 crocodile near {current.displayName}");
                            else
                            {
                                BroadcastChat(ChatMsg($"{viewerName} sent a crocodile but spawn failed — set CrocodilePrefabPath in RustChaos.json."));
                                PrintWarning($"{LogPrefix} Crocodile spawn failed (all prefab candidates).");
                            }
                        });
                    }
                    break;

                case "healinghands":
                    if (target != null)
                    {
                        float amount = Mathf.Max(0f, _config?.HealingHandsAmount ?? 10f);
                        GiveScrapToPlayer(target, 10);
                        // Always show who gave healing in chat (custom TikFinity message must not hide the giver).
                        string HealingHandsChat(string defaultLine)
                        {
                            if (string.IsNullOrEmpty(customMessage)) return defaultLine;
                            return $"{viewerName} → {target.displayName}: {customMessage}";
                        }
                        target.Heal(amount);
                        BroadcastChat(HealingHandsChat($"{viewerName} gave HEALING HANDS to {target.displayName}! +{amount:0} health +10 scrap"));
                        Puts($"{LogPrefix} Healing Hands: healed {target.displayName} by {amount} and gave 10 scrap (from {viewerName})");
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

                case "bunny1":
                    if (target != null)
                    {
                        int n = TryApplyBunnyCostumeToStreamer(target);
                        BroadcastChat(ChatMsg($"{viewerName} put the BUNNY COSTUME on {target.displayName}!"));
                        Puts($"{LogPrefix} Bunny costume: equipped {n} wear item(s) on {target.displayName} (from {viewerName}).");
                    }
                    break;

                case "revivechaos":
                    if (target != null)
                    {
                        // Wounded/crawling: pick up + strip hidden bleed + full HP (RecoverFromWounded alone often leaves bleeding ticking).
                        try
                        {
                            bool down = target.IsWounded() || target.HasPlayerFlag(BasePlayer.PlayerFlags.Incapacitated);
                            bool bleeding = false;
                            try
                            {
                                bleeding = target.metabolism != null && target.metabolism.bleeding != null &&
                                           target.metabolism.bleeding.value > 0f;
                            }
                            catch { }

                            if (down || bleeding)
                            {
                                if (down)
                                    target.RecoverFromWounded();
                                TryClearBleedMetabolismAttributes(target.metabolism);
                                target.Heal(99999f);
                                ulong reviveUid = target.userID;
                                Vector3 revivePos = target.transform.position;
                                _reviveChaosProtectUntil[reviveUid] = Time.realtimeSinceStartup + ReviveChaosProtectSeconds;
                                NextTick(() => TryForceResyncRevivedPlayer(reviveUid, revivePos));
                                timer.Once(0.15f, () => TryForceResyncRevivedPlayer(reviveUid, revivePos));
                                BroadcastChat(ChatMsg($"{viewerName} triggered REVIVE CHAOS! {target.displayName} is back up — full health!"));
                                Puts($"{LogPrefix} Revive Chaos: recovered {target.displayName}, cleared bleed, full heal, {ReviveChaosProtectSeconds}s protect (bleed + fall).");
                            }
                            else
                            {
                                BroadcastChat(ChatMsg($"{viewerName} sent Revive Chaos — streamer isn't wounded or bleeding."));
                                Puts($"{LogPrefix} Revive Chaos: {target.displayName} not wounded/bleeding; no-op.");
                            }
                        }
                        catch (Exception ex)
                        {
                            PrintWarning($"{LogPrefix} Revive Chaos failed for {target.displayName}: {ex.Message}");
                        }
                    }
                    break;

                case "chaosheli":
                    if (target != null)
                    {
                        if (GetStreamerChaosLocation(target) != ChaosLocation.Land)
                        {
                            BroadcastChat(ChatMsg($"Heli Chaos is land only. {viewerName} sent {giftName}!"));
                            break;
                        }
                        StartHeliChaosEvent(target, ChatMsg, viewerName, giftName);
                    }
                    break;

                case "shark":
                    if (target != null)
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}!"));
                        ScheduleDelayedSingleSpawn("shark", target.userID, () =>
                        {
                            BasePlayer current = FindConnectedPlayerByUserId(target.userID);
                            if (current == null || !current.IsValid()) return;
                            Vector3 sharkPos = GetSingleSpawnPosition(current);
                            if (TrySpawnSharkGiftWithLeash(current, sharkPos, _config?.SharkPrefabPath))
                                Puts($"{LogPrefix} Spawned 1 shark near {current.displayName}");
                            else
                                PrintWarning($"{LogPrefix} Shark spawn failed. Set SharkPrefabPath in RustChaos.json if needed.");
                        });
                    }
                    break;

                case "pig":
                    if (target != null)
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}!"));
                        ScheduleDelayedSingleSpawn("pig", target.userID, () =>
                        {
                            BasePlayer current = FindConnectedPlayerByUserId(target.userID);
                            if (current == null || !current.IsValid()) return;
                            if (TrySpawnSoloWildAnimal(current, BoarPrefab, "pig"))
                                Puts($"{LogPrefix} Spawned 1 pig (boar) near {current.displayName}");
                            else
                                PrintWarning($"{LogPrefix} Pig spawn failed (CreateEntity).");
                        });
                    }
                    break;

                case "chicken":
                    if (target != null)
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}!"));
                        ScheduleDelayedSingleSpawn("chicken", target.userID, () =>
                        {
                            BasePlayer current = FindConnectedPlayerByUserId(target.userID);
                            if (current == null || !current.IsValid()) return;
                            if (TrySpawnChickenNearStreamer(current))
                                Puts($"{LogPrefix} Spawned 1 chicken near {current.displayName}");
                            else
                                PrintWarning($"{LogPrefix} Chicken spawn failed (prefab paths).");
                        });
                    }
                    break;

                case "pistolammo50":
                    if (target != null)
                    {
                        BroadcastChat(ChatMsg($"{viewerName} sent a {giftName}! (+50 pistol ammo)"));
                        GiveItemWithLog(target, 50, "ammo.pistol", "TikTok webhook pistolammo50");
                        Puts($"{LogPrefix} Gave 50 pistol ammo to {target.displayName} (from {viewerName}).");
                    }
                    break;

                case "statuspoison":
                {
                    string err = TryApplyStreamerStatusWebhook(target, "poison", false, viewerName, giftName, ChatMsg, scrapAmount);
                    if (err != null) return err;
                    break;
                }

                case "statusdehydrated":
                {
                    string err = TryApplyStreamerStatusWebhook(target, "dehydrated", false, viewerName, giftName, ChatMsg, scrapAmount);
                    if (err != null) return err;
                    break;
                }

                case "statushungry":
                {
                    string err = TryApplyStreamerStatusWebhook(target, "hungry", false, viewerName, giftName, ChatMsg, scrapAmount);
                    if (err != null) return err;
                    break;
                }

                case "statusbleeding":
                {
                    string err = TryApplyStreamerStatusWebhook(target, "bleeding", false, viewerName, giftName, ChatMsg, scrapAmount);
                    if (err != null) return err;
                    break;
                }

                case "statusdart":
                {
                    string err = TryApplyStreamerStatusWebhook(target, "dart", true, viewerName, giftName, ChatMsg, scrapAmount);
                    if (err != null) return err;
                    break;
                }

                case "statusgodmode":
                {
                    string err = TryApplyStreamerGodModeStatus(target, viewerName, giftName, ChatMsg, scrapAmount);
                    if (err != null) return err;
                    break;
                }

                case "statusbullethell":
                {
                    string err = TryApplyStreamerBulletHellStatus(target, viewerName, giftName, ChatMsg, scrapAmount);
                    if (err != null) return err;
                    break;
                }

                case "statusflippers":
                {
                    string err = TryApplyStreamerFlippersStatus(target, viewerName, giftName, ChatMsg, scrapAmount);
                    if (err != null) return err;
                    break;
                }

                case "statusflash":
                {
                    string err = TryApplyStreamerFlashStatus(target, viewerName, giftName, ChatMsg, scrapAmount);
                    if (err != null) return err;
                    break;
                }

                case "statushealthx3":
                {
                    string err = TryApplyStreamerHealthX3Status(target, viewerName, giftName, ChatMsg, scrapAmount);
                    if (err != null) return err;
                    break;
                }

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
                        TryStartLandChaosWave(target, viewerName, giftName, ChatMsg, ChaosWaveMode.Bear);
                    break;

                case "chaoswavewolf":
                    if (target != null)
                        TryStartLandChaosWave(target, viewerName, giftName, ChatMsg, ChaosWaveMode.Wolf);
                    break;

                case "chaoswavepig":
                    if (target != null)
                        TryStartLandChaosWave(target, viewerName, giftName, ChatMsg, ChaosWaveMode.Boar);
                    break;

                case "chaoswavetiger":
                    if (target != null)
                        TryStartLandChaosWave(target, viewerName, giftName, ChatMsg, ChaosWaveMode.Tiger);
                    break;

                case "chaoswavepanther":
                    if (target != null)
                        TryStartLandChaosWave(target, viewerName, giftName, ChatMsg, ChaosWaveMode.Panther);
                    break;

                case "chaoswaverandom":
                    if (target != null)
                        TryStartLandChaosWave(target, viewerName, giftName, ChatMsg, ChaosWaveMode.Random);
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

            if (!IsStreamerStatusEffectAction(action) && scrapAmount > 0 && target != null)
            {
                GiveScrapToPlayer(target, scrapAmount);
                Puts($"{LogPrefix} Gave {scrapAmount} scrap to streamer {target.displayName}");
            }
            else if (!IsStreamerStatusEffectAction(action) && scrapAmount > 0 && target == null)
            {
                PrintWarning($"{LogPrefix} Streamer not online – scrap not given ({scrapAmount} would have been given).");
            }

            return null;
        }

        private void StartHeliChaosEvent(BasePlayer target, Func<string, string> chatMsg, string viewerName, string giftName)
        {
            _heliChaosActive = true;
            _heliChaosStreamerUserId = target.userID;
            _heliChaosNextBonusCrateTime = 0f;
            GiveItemWithLog(target, 1, "homingmissile.launcher", "Heli chaos (homing launcher)");
            for (int i = 0; i < 20; i++)
                GiveItemWithLog(target, 1, "ammo.rocket.seeker", "Heli chaos (seeker missile)");
            BroadcastChat(chatMsg($"{viewerName} triggered HELI CHAOS! Homing launcher + 20 missiles. Locked crate first, patrol helicopter after."));
            float cDelay = Mathf.Max(2f, _config?.HeliChaosCrateDelaySeconds ?? 8f);
            float pDelay = Mathf.Max(cDelay + 15f, _config?.HeliChaosPatrolDelaySeconds ?? 75f);
            ulong uid = target.userID;
            timer.Once(cDelay, () => HeliChaosDeliverCrate(uid));
            timer.Once(pDelay, () => HeliChaosSpawnPatrol(uid));
            BroadcastChat($"Heli Chaos timing: crate in {cDelay:0}s, patrol heli in {pDelay:0}s (land-only).");
            Puts($"{LogPrefix} Heli chaos for {target.displayName}: locked crate ~{cDelay:0}s, patrol heli ~{pDelay:0}s.");
        }

        private void HeliChaosDeliverCrate(ulong userId)
        {
            if (!_heliChaosActive) return;
            BasePlayer p = FindConnectedPlayerByUserId(userId);
            if (p == null || !p.IsValid())
            {
                PrintWarning($"{LogPrefix} Heli chaos: initial crate skipped (streamer offline or dead).");
                return;
            }
            if (TrySpawnHackableLockedCrateNear(p, "Heli chaos — Chinook locked crate"))
            {
                BroadcastChat("Chinook locked crate delivered near the streamer!");
            }
            else
            {
                BroadcastChat("Heli Chaos: crate spawn failed (server console should show which prefab was missing).");
            }
        }

        private void HeliChaosSpawnPatrol(ulong userId)
        {
            if (!_heliChaosActive) return;
            BasePlayer p = FindConnectedPlayerByUserId(userId);
            if (p == null || !p.IsValid())
            {
                PrintWarning($"{LogPrefix} Heli chaos: patrol helicopter skipped (streamer offline or dead).");
                return;
            }
            // Most reliable: explicitly call the vanilla patrol heli to the player.
            // This prevents "spawned but AI retreated / resumed route" behavior.
            try
            {
                p.SendConsoleCommand("heli.calltome");
                BroadcastChat("Patrol helicopter called to you (heli.calltome).");
            }
            catch { }

            // Backup: also try to spawn a heli near the streamer in case calltome is blocked.
            if (TrySpawnPatrolHelicopterNear(p))
                BroadcastChat("Patrol helicopter inbound (spawned/backup).");
            else
            {
                string custom = _config?.PatrolHelicopterPrefabPath;
                BroadcastChat($"Heli Chaos: patrol helicopter backup spawn failed. Check PatrolHelicopterPrefabPath in RustChaos.json. (custom='{custom ?? ""}')");
                PrintWarning($"{LogPrefix} Heli chaos: patrol helicopter backup spawn failed (check PatrolHelicopterPrefabPath in config).");
            }
        }

        private bool TrySpawnHackableLockedCrateNear(BasePlayer streamer, string logContext)
        {
            if (streamer == null || !streamer.IsValid()) return false;
            Vector3 flat = GetPositionNear(streamer);
            if (flat == Vector3.zero) flat = streamer.transform.position;
            Vector3 ground = SnapLandNpcSpawnToGround(flat) + Vector3.up * 0.25f;
            Quaternion rot = Quaternion.Euler(0f, UnityEngine.Random.Range(0f, 360f), 0f);

            string custom = _config?.HackableLockedCratePrefabPath;
            if (!string.IsNullOrWhiteSpace(custom))
            {
                if (TryCreateAndSpawnHackableCrate(custom.Trim(), ground, rot, logContext))
                    return true;
            }

            foreach (string path in HackableLockedCratePrefabCandidates)
            {
                if (TryCreateAndSpawnHackableCrate(path, ground, rot, logContext))
                    return true;
            }
            PrintWarning($"{LogPrefix} {logContext}: no hackable crate prefab worked. Set HackableLockedCratePrefabPath from PrefabSniffer / F1.");
            return false;
        }

        private bool TryCreateAndSpawnHackableCrate(string prefabPath, Vector3 pos, Quaternion rot, string logContext)
        {
            try
            {
                BaseEntity ent = GameManager.server.CreateEntity(prefabPath, pos, rot, true);
                if (ent == null) return false;
                ent.Spawn();
                try { ent.SendMessage("SetWasDropped"); } catch { }
                Puts($"{LogPrefix} {logContext}: spawned {prefabPath}");
                return true;
            }
            catch
            {
                return false;
            }
        }

        private bool TrySpawnPatrolHelicopterNear(BasePlayer streamer)
        {
            if (streamer == null || !streamer.IsValid()) return false;
            Vector3 anchor = streamer.transform.position;
            Vector3 h = UnityEngine.Random.insideUnitSphere;
            h.y = 0f;
            if (h.sqrMagnitude < 0.01f) h = Vector3.forward;
            h.Normalize();
            // Spawn closer than before so the heli AI reliably "gets you" quickly.
            // Too far horizontally can cause the heli to continue its route without coming in.
            float horizontalMin = 8f;
            float horizontalMax = 22f;
            float heightMin = 55f;
            float heightMax = 70f;
            Vector3 spawnPos = anchor + Vector3.up * UnityEngine.Random.Range(heightMin, heightMax) + h * UnityEngine.Random.Range(horizontalMin, horizontalMax);

            string custom = _config?.PatrolHelicopterPrefabPath;
            if (!string.IsNullOrWhiteSpace(custom) && TryCreateAndSpawnEntityAt(custom.Trim(), spawnPos))
                return true;

            foreach (string path in PatrolHelicopterPrefabCandidates)
            {
                if (TryCreateAndSpawnEntityAt(path, spawnPos))
                    return true;
            }
            return false;
        }

        private static bool TryCreateAndSpawnEntityAt(string prefabPath, Vector3 pos)
        {
            try
            {
                BaseEntity ent = GameManager.server.CreateEntity(prefabPath, pos, Quaternion.identity, true);
                if (ent == null) return false;
                ent.Spawn();
                return true;
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning($"{LogPrefix} TryCreateAndSpawnEntityAt failed: '{prefabPath}' at {pos}. {ex.Message}");
                return false;
            }
        }

        private static bool IsCounterHelicopterForHeliChaos(BaseCombatEntity entity)
        {
            if (entity == null) return false;
            string p = entity.PrefabName ?? "";
            if (string.IsNullOrEmpty(p)) return false;
            if (p.IndexOf("minicopter", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (p.IndexOf("scraptransport", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (p.IndexOf("ch47", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (p.IndexOf("hotair", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (p.IndexOf("patrol helicopter", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (p.IndexOf("patrolhelicopter", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (p.IndexOf("attackhelicopter", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            return false;
        }

        private static BasePlayer FindConnectedPlayerByUserId(ulong userId)
        {
            if (userId == 0ul) return null;
            foreach (BasePlayer p in BasePlayer.activePlayerList)
            {
                if (p == null || !p.IsConnected || p.userID != userId) continue;
                if (p.IsDead()) continue;
                return p;
            }
            return null;
        }

        /// <summary>Strip current wear and equip bunny onesie + ears (TikFinity / RCON <c>bunny1</c>). Returns count successfully moved to wear.</summary>
        private static int TryApplyBunnyCostumeToStreamer(BasePlayer player)
        {
            if (player == null || !player.IsValid()) return 0;
            ItemContainer wear = player.inventory?.containerWear;
            if (wear == null) return 0;
            try
            {
                foreach (Item existing in wear.itemList.ToArray())
                {
                    if (existing == null) continue;
                    try
                    {
                        existing.RemoveFromContainer();
                        existing.Remove();
                    }
                    catch
                    {
                        // ignore per item
                    }
                }
            }
            catch
            {
                // ignore
            }

            int ok = 0;
            foreach (string shortName in BunnyCostumeWearShortnames)
            {
                if (TryCreateItemMoveToWear(player, shortName, 1))
                    ok++;
            }

            try
            {
                player.inventory.ServerUpdate(0f);
            }
            catch
            {
                // ignore
            }

            try
            {
                player.SendNetworkUpdate();
            }
            catch
            {
                // ignore
            }

            return ok;
        }

        private static readonly string[] BunnyCostumeWearShortnames = { "attire.bunny.onesie", "attire.bunnyears" };

        private static bool TryCreateItemMoveToWear(BasePlayer player, string shortName, int amount)
        {
            if (player == null || !player.IsValid() || string.IsNullOrEmpty(shortName) || amount <= 0) return false;
            ItemContainer wear = player.inventory?.containerWear;
            if (wear == null) return false;
            ItemDefinition def = ItemManager.FindItemDefinition(shortName);
            if (def == null) return false;
            Item item = ItemManager.Create(def, amount, 0ul);
            if (item == null) return false;
            bool moved = false;
            try
            {
                moved = item.MoveToContainer(wear);
            }
            catch
            {
                moved = false;
            }

            if (!moved)
            {
                try
                {
                    item.Remove();
                }
                catch
                {
                    // ignore
                }

                return false;
            }

            return true;
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
            GiveOrDropItem(player, item, player.inventory.containerMain);
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
            GiveOrDropItem(player, item, player.inventory.containerMain);
        }

        /// <summary>If preferred container is full, try other inventory containers; if all full, drop at the player's feet.</summary>
        private static void GiveOrDropItem(BasePlayer player, Item item, ItemContainer preferredContainer)
        {
            if (player == null || !player.IsValid() || item == null) return;

            bool moved = false;
            try
            {
                if (preferredContainer != null)
                    moved = item.MoveToContainer(preferredContainer);
                if (!moved && player.inventory?.containerMain != null)
                    moved = item.MoveToContainer(player.inventory.containerMain);
                if (!moved && player.inventory?.containerBelt != null)
                    moved = item.MoveToContainer(player.inventory.containerBelt);
                if (!moved && player.inventory?.containerWear != null)
                    moved = item.MoveToContainer(player.inventory.containerWear);
            }
            catch
            {
                moved = false;
            }

            if (!moved)
            {
                Vector3 dropPos = player.transform.position + new Vector3(0f, 0.8f, 0f);
                Vector3 dropVel = player.transform.forward * 1.5f;
                item.Drop(dropPos, dropVel);
            }
        }

        /// <summary>RecoverFromWounded() can leave bleeding (and related attrs) active; clear all *bleed* metabolism channels.</summary>
        private static void TryClearBleedMetabolismAttributes(PlayerMetabolism metabolism)
        {
            if (metabolism == null) return;
            try
            {
                if (metabolism.bleeding != null)
                    metabolism.bleeding.value = 0f;
            }
            catch
            {
                // bleeding API differs on some builds
            }

            // e.g. significant_bleeding or future attrs — same MetabolismAttribute pattern (.value)
            try
            {
                foreach (PropertyInfo prop in metabolism.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
                {
                    if (prop.Name.IndexOf("bleed", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    object obj = prop.GetValue(metabolism, null);
                    if (obj == null) continue;
                    PropertyInfo valueProp = obj.GetType().GetProperty("value", BindingFlags.Public | BindingFlags.Instance);
                    if (valueProp != null && valueProp.PropertyType == typeof(float))
                        valueProp.SetValue(obj, 0f, null);
                }
            }
            catch
            {
                // reflection-safe: ignore on stripped builds
            }
        }

        private static bool ActionRequiresPlayer(string action)
        {
            return action == "smoke" ||
                   action == "fireworks" ||
                   action == "scientist" ||
                   action == "scientistflame" ||
                   action == "wolf" ||
                   action == "bear" ||
                   action == "tiger" ||
                   action == "panther" ||
                   action == "crocodile" ||
                   action == "healinghands" ||
                   action == "fullheal" ||
                   action == "shark" ||
                   action == "pig" ||
                   action == "chicken" ||
                   action == "supply" ||
                   action == "likes" ||
                   action == "chaos" ||
                   action == "scientistboat" ||
                   action == "chaoswave" ||
                   action == "chaoswavewolf" ||
                   action == "chaoswavepig" ||
                   action == "chaoswavetiger" ||
                   action == "chaoswavepanther" ||
                   action == "chaoswaverandom" ||
                   action == "revivechaos" ||
                   action == "chaosheli" ||
                   action == "bunny1" ||
                   action == "pistolammo50" ||
                   action == "statuspoison" ||
                   action == "statusdehydrated" ||
                   action == "statushungry" ||
                   action == "statusbleeding" ||
                   action == "statusdart" ||
                   action == "statusgodmode" ||
                   action == "statusbullethell" ||
                   action == "statusflippers" ||
                   action == "statusflash" ||
                   action == "statushealthx3";
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

        /// <summary>Spawn single gifts close enough to stay inside leash behavior and quickly engage the streamer.</summary>
        private Vector3 GetSingleSpawnPosition(BasePlayer player)
        {
            if (player == null || !player.IsValid()) return Vector3.zero;
            float leash = Mathf.Max(8f, _config?.ChaosWaveBearLeashDistance ?? 18f);
            float maxRadius = Mathf.Max(7f, Mathf.Min(leash - 1f, leash));
            Vector3 pos = GetPositionWithinRadius(player, 6f, maxRadius);
            if (pos == Vector3.zero) pos = GetPositionNear(player);
            return pos;
        }

        private void ScheduleDelayedSingleSpawn(string actionName, ulong userId, Action spawnAction)
        {
            if (spawnAction == null || userId == 0ul) return;
            Puts($"{LogPrefix} Delaying '{actionName}' spawn by {SingleSpawnDelaySeconds:0}s.");
            timer.Once(SingleSpawnDelaySeconds, () =>
            {
                BasePlayer target = FindConnectedPlayerByUserId(userId);
                if (target == null || !target.IsValid())
                {
                    PrintWarning($"{LogPrefix} Delayed '{actionName}' spawn skipped: streamer offline.");
                    return;
                }
                spawnAction();
            });
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
        /// Snap spawn XZ to ground under that column (terrain or construction). Stops scientists/animals spawning at the streamer's Y on hills or platforms.
        /// </summary>
        private static Vector3 SnapLandNpcSpawnToGround(Vector3 worldPos)
        {
            if (worldPos == Vector3.zero) return worldPos;
            const float rayTop = 400f;
            const float rayLen = 600f;
            Vector3 origin = new Vector3(worldPos.x, rayTop, worldPos.z);
            RaycastHit hit;
            if (Physics.Raycast(origin, Vector3.down, out hit, rayLen, Layers.Solid, QueryTriggerInteraction.Ignore))
                return hit.point;
            try
            {
                worldPos.y = TerrainMeta.HeightMap.GetHeight(worldPos);
                return worldPos;
            }
            catch
            {
                return worldPos;
            }
        }

        /// <summary>
        /// If this horizontal position is in water, set <paramref name="worldPos"/>.y to the water surface (+ small offset).
        /// Crocodiles are aquatic; snapping them to terrain on dry land often spawns a dead animal.
        /// </summary>
        private static bool TryRaiseToWaterSurface(ref Vector3 worldPos)
        {
            try
            {
                if (!WaterLevel.Test(worldPos, true, true)) return false;
                float wl = WaterLevel.GetWaterLevel(worldPos, true);
                worldPos.y = wl + 0.25f;
                return true;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>Finds shallow water near the streamer (same radius as solo gifts); falls back to snapped land.</summary>
        private bool TryFindCrocodileSpawnPosition(BasePlayer streamer, out Vector3 spawnPos, out bool spawnedInWater)
        {
            spawnPos = Vector3.zero;
            spawnedInWater = false;
            if (streamer == null || !streamer.IsValid()) return false;

            float leash = Mathf.Max(8f, _config?.ChaosWaveBearLeashDistance ?? 18f);
            float maxRadius = Mathf.Max(7f, Mathf.Min(leash - 1f, leash));

            for (int i = 0; i < 64; i++)
            {
                Vector3 tryFlat = GetPositionWithinRadius(streamer, 6f, maxRadius);
                if (tryFlat == Vector3.zero) tryFlat = GetPositionNear(streamer);
                tryFlat.y = TerrainMeta.HeightMap.GetHeight(tryFlat);
                if (TryRaiseToWaterSurface(ref tryFlat))
                {
                    spawnPos = tryFlat;
                    spawnedInWater = true;
                    return true;
                }
            }

            for (float ring = 8f; ring <= maxRadius + 0.1f; ring += 4f)
            {
                for (int step = 0; step < 16; step++)
                {
                    float a = step / 16f * Mathf.PI * 2f;
                    Vector3 tryFlat = streamer.transform.position + new Vector3(Mathf.Cos(a) * ring, 0f, Mathf.Sin(a) * ring);
                    tryFlat.y = TerrainMeta.HeightMap.GetHeight(tryFlat);
                    if (TryRaiseToWaterSurface(ref tryFlat))
                    {
                        spawnPos = tryFlat;
                        spawnedInWater = true;
                        return true;
                    }
                }
            }

            Vector3 atPlayer = streamer.transform.position;
            atPlayer.y = TerrainMeta.HeightMap.GetHeight(atPlayer);
            if (TryRaiseToWaterSurface(ref atPlayer))
            {
                spawnPos = atPlayer;
                spawnedInWater = true;
                return true;
            }

            spawnPos = GetSingleSpawnPosition(streamer);
            if (spawnPos == Vector3.zero) spawnPos = streamer.transform.position;
            spawnPos = SnapLandNpcSpawnToGround(spawnPos);
            spawnedInWater = false;
            return spawnPos != Vector3.zero;
        }

        /// <summary>Runs chaos event rules on a timer based on streamer location (Land / Sea / Swimming).
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
                    at(3f, () => { var t = GetStreamer(); if (t != null && TrySpawnSoloWildAnimal(t, WolfPrefab, "Chaos land wolf")) Puts($"{LogPrefix} Chaos (Land): wolf"); });
                    at(6f, () => { var t = GetStreamer(); if (t != null && TrySpawnSoloWildAnimal(t, BearPrefab, "Chaos land bear")) Puts($"{LogPrefix} Chaos (Land): bear"); });
                    at(9f, () => { var t = GetStreamer(); if (t != null && TrySpawnSoloWildAnimal(t, BoarPrefab, "Chaos land pig")) Puts($"{LogPrefix} Chaos (Land): pig"); });
                    break;
                case ChaosLocation.Sea:
                    at(2f, () => { var t = GetStreamer(); if (t != null && TrySpawnSharkGiftWithLeash(t, GetPositionNear(t), _config?.SharkPrefabPath)) Puts($"{LogPrefix} Chaos (Sea): shark"); });
                    at(5f, () => { var t = GetStreamer(); if (t != null && TrySpawnSharkGiftWithLeash(t, GetPositionNear(t), _config?.SharkPrefabPath)) Puts($"{LogPrefix} Chaos (Sea): shark 2"); });
                    at(8f, () => { var t = GetStreamer(); if (t != null) { SpawnEffect(EffectFireworks, GetPositionNear(t)); Puts($"{LogPrefix} Chaos (Sea): fireworks"); } });
                    at(11f, () => { var t = GetStreamer(); if (t != null && TrySpawnSharkGiftWithLeash(t, GetPositionNear(t), _config?.SharkPrefabPath)) Puts($"{LogPrefix} Chaos (Sea): shark 3"); });
                    break;
                case ChaosLocation.Swimming:
                    at(1f, () =>
                    {
                        var t = GetStreamer();
                        if (t == null) return;
                        if (TrySpawnSharkGiftWithLeash(t, GetPositionNear(t), _config?.SharkPrefabPath))
                            TrySpawnSharkGiftWithLeash(t, GetPositionNear(t), _config?.SharkPrefabPath);
                        Puts($"{LogPrefix} Chaos (Swimming): sharks");
                    });
                    at(4f, () => { var t = GetStreamer(); if (t != null && TrySpawnSharkGiftWithLeash(t, GetPositionNear(t), _config?.SharkPrefabPath)) Puts($"{LogPrefix} Chaos (Swimming): shark"); });
                    at(7f, () => { var t = GetStreamer(); if (t != null && TrySpawnSharkGiftWithLeash(t, GetPositionNear(t), _config?.SharkPrefabPath)) Puts($"{LogPrefix} Chaos (Swimming): shark"); });
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

        private bool TryStartLandChaosWave(BasePlayer target, string viewerName, string giftName, Func<string, string> chatMsg, ChaosWaveMode mode)
        {
            if (target == null || !target.IsValid()) return false;
            ChaosLocation loc = GetStreamerChaosLocation(target);
            if (loc != ChaosLocation.Land)
            {
                BroadcastChat(chatMsg($"Chaos wave is land only. {viewerName} sent {giftName}!"));
                return false;
            }
            if (_chaosWaveEnemyIds != null)
            {
                BroadcastChat(chatMsg("Chaos wave already in progress!"));
                return false;
            }
            if (mode == ChaosWaveMode.Bear)
                BroadcastChat(chatMsg($"{viewerName} started a CHAOS WAVE! Kill the bears…"));
            else
                BroadcastChat(chatMsg($"{viewerName} started {ChaosWaveUiTitleForMode(mode)}!"));
            StartLandChaosWave(target, mode);
            return true;
        }

        private static string ChaosWaveUiTitleForMode(ChaosWaveMode mode)
        {
            switch (mode)
            {
                case ChaosWaveMode.Wolf: return "Chaos Wolf Wave";
                case ChaosWaveMode.Boar: return "Chaos Pig Wave";
                case ChaosWaveMode.Tiger: return "Chaos Tiger Wave";
                case ChaosWaveMode.Panther: return "Chaos Panther Wave";
                case ChaosWaveMode.Random: return "Chaos Random Wave";
                default: return "Chaos Bear Wave";
            }
        }

        private string ChaosWaveSpawnBroadcastLine(int waveNum, int spawnedCount)
        {
            if (spawnedCount <= 0) return $"Chaos wave {waveNum}! Enemy spawn failed — check server console / prefabs.";
            string noun = _chaosWaveMode == ChaosWaveMode.Wolf ? "wolves"
                : _chaosWaveMode == ChaosWaveMode.Boar ? "pigs"
                : _chaosWaveMode == ChaosWaveMode.Tiger ? "tigers"
                : _chaosWaveMode == ChaosWaveMode.Panther ? "panthers"
                : _chaosWaveMode == ChaosWaveMode.Random ? "enemies"
                : "bears";
            if (spawnedCount == 1)
            {
                if (_chaosWaveMode == ChaosWaveMode.Wolf) return $"Chaos wave {waveNum}! 1 wolf spawned.";
                if (_chaosWaveMode == ChaosWaveMode.Boar) return $"Chaos wave {waveNum}! 1 pig spawned.";
                if (_chaosWaveMode == ChaosWaveMode.Tiger) return $"Chaos wave {waveNum}! 1 tiger spawned.";
                if (_chaosWaveMode == ChaosWaveMode.Panther) return $"Chaos wave {waveNum}! 1 panther spawned.";
                if (_chaosWaveMode == ChaosWaveMode.Random) return $"Chaos wave {waveNum}! 1 enemy spawned.";
                return $"Chaos wave {waveNum}! 1 bear spawned.";
            }
            return $"Chaos wave {waveNum}! {spawnedCount} {noun} spawned.";
        }

        private static List<string> BuildRandomWavePrefabPlan(int count)
        {
            var list = new List<string>(Mathf.Max(0, count));
            for (int i = 0; i < count; i++)
                list.Add(ChaosWaveRandomPrefabPool[UnityEngine.Random.Range(0, ChaosWaveRandomPrefabPool.Length)]);
            return list;
        }

        private static string FormatRandomWaveEnemyRollCall(List<string> prefabs)
        {
            if (prefabs == null || prefabs.Count == 0) return "";
            var parts = new List<string>(prefabs.Count);
            foreach (var p in prefabs)
                parts.Add(PrefabPathToFriendlyChaosName(p));
            return string.Join(", ", parts);
        }

        private static string PrefabPathToFriendlyChaosName(string path)
        {
            if (string.IsNullOrEmpty(path)) return "Enemy";
            string x = path.ToLowerInvariant();
            if (x.Contains("zombie")) return "Zombie";
            if (x.Contains("boar")) return "Pig";
            if (x.Contains("wolf")) return "Wolf";
            if (x.Contains("tiger")) return "Tiger";
            if (x.Contains("panther")) return "Panther";
            if (x.Contains("/bear") || x.Contains("bear.")) return "Bear";
            if (x.Contains("chicken")) return "Chicken";
            if (x.Contains("bradley_heavy") || x.Contains("scientistnpc_heavy")) return "Heavy scientist";
            if (x.Contains("oilrig")) return "Oil rig scientist";
            if (x.Contains("roam")) return "Roam scientist";
            if (x.Contains("lr300") || x.Contains("humannpc")) return "Scientist";
            if (x.Contains("npc/scientist") || x.EndsWith("scientist.prefab")) return "Scientist";
            return "Enemy";
        }

        /// <summary>Line 1 during inter-wave countdown — timer stays visible (line 2 can be long for Random preview).</summary>
        private string ChaosWaveCountdownTitleWithTimer()
        {
            return $"{_chaosWaveUiTitle}    Next in {_chaosWaveCountdown}s";
        }

        private string ChaosWaveCountdownSubtext(int completedWave)
        {
            if (_chaosWaveMode == ChaosWaveMode.Random && !string.IsNullOrEmpty(_chaosWaveRandomNextWavePreview))
                return $"Wave {completedWave} complete\n{_chaosWaveRandomNextWavePreview}";
            return $"Wave {completedWave} complete";
        }

        /// <summary>Creates one chaos-wave enemy (prefab depends on <see cref="_chaosWaveMode"/>).</summary>
        private BaseEntity CreateChaosWaveEnemyEntity(Vector3 pos)
        {
            if (pos == Vector3.zero) return null;
            if (_chaosWaveMode == ChaosWaveMode.Random)
            {
                if (_chaosWaveRandomWavePlan != null)
                {
                    while (_chaosWaveRandomPlanIndex < _chaosWaveRandomWavePlan.Count)
                    {
                        string planned = _chaosWaveRandomWavePlan[_chaosWaveRandomPlanIndex];
                        BaseEntity pe = GameManager.server.CreateEntity(planned, pos, Quaternion.identity, true);
                        if (pe != null)
                        {
                            _chaosWaveRandomPlanIndex++;
                            return pe;
                        }
                        _chaosWaveRandomPlanIndex++;
                    }
                }
                for (int t = 0; t < 18; t++)
                {
                    string p = ChaosWaveRandomPrefabPool[UnityEngine.Random.Range(0, ChaosWaveRandomPrefabPool.Length)];
                    BaseEntity e = GameManager.server.CreateEntity(p, pos, Quaternion.identity, true);
                    if (e != null) return e;
                }
                return GameManager.server.CreateEntity(WolfPrefab, pos, Quaternion.identity, true);
            }
            if (_chaosWaveMode == ChaosWaveMode.Wolf)
                return GameManager.server.CreateEntity(WolfPrefab, pos, Quaternion.identity, true);
            if (_chaosWaveMode == ChaosWaveMode.Boar)
                return GameManager.server.CreateEntity(BoarPrefab, pos, Quaternion.identity, true);
            if (_chaosWaveMode == ChaosWaveMode.Tiger)
                return TryCreateEntityFromPrefabCandidates(EnumerateTigerPrefabPaths(), pos);
            if (_chaosWaveMode == ChaosWaveMode.Panther)
                return TryCreateEntityFromPrefabCandidates(EnumeratePantherPrefabPaths(), pos);
            return GameManager.server.CreateEntity(BearPrefab, pos, Quaternion.identity, true);
        }

        private IEnumerable<string> EnumerateTigerPrefabPaths()
        {
            if (!string.IsNullOrWhiteSpace(_config?.TigerPrefabPath))
                yield return _config.TigerPrefabPath.Trim();
            foreach (var p in TigerPrefabCandidates)
                yield return p;
        }

        private IEnumerable<string> EnumeratePantherPrefabPaths()
        {
            if (!string.IsNullOrWhiteSpace(_config?.PantherPrefabPath))
                yield return _config.PantherPrefabPath.Trim();
            foreach (var p in PantherPrefabCandidates)
                yield return p;
        }

        private IEnumerable<string> EnumerateCrocodilePrefabPaths()
        {
            if (!string.IsNullOrWhiteSpace(_config?.CrocodilePrefabPath))
                yield return _config.CrocodilePrefabPath.Trim();
            foreach (var p in CrocodilePrefabCandidates)
                yield return p;
        }

        private static BaseEntity TryCreateEntityFromPrefabCandidates(IEnumerable<string> paths, Vector3 pos)
        {
            foreach (var p in paths)
            {
                if (string.IsNullOrEmpty(p)) continue;
                BaseEntity e = GameManager.server.CreateEntity(p, pos, Quaternion.identity, true);
                if (e != null) return e;
            }
            return null;
        }

        /// <summary>1× semi-auto pistol + 10 pistol rounds on belt (arm slot) for tiger/panther single spawns.</summary>
        private void GivePistolAndAmmoToStreamerBelt(BasePlayer player, string context)
        {
            const string pistolShort = "pistol.semiauto";
            const string ammoShort = "ammo.pistol";
            GiveItemToBeltWithLog(player, 1, pistolShort, $"{context} (pistol, belt)");
            GiveItemToBeltWithLog(player, 10, ammoShort, $"{context} (ammo, belt)");
        }

        private bool TrySpawnTigerOneNearStreamer(BasePlayer streamer)
        {
            if (streamer == null || !streamer.IsValid()) return false;
            Vector3 pos = GetSingleSpawnPosition(streamer);
            if (pos == Vector3.zero) pos = streamer.transform.position;
            pos = SnapLandNpcSpawnToGround(pos);
            BaseEntity ent = TryCreateEntityFromPrefabCandidates(EnumerateTigerPrefabPaths(), pos);
            if (ent == null) return false;
            ent.Spawn();
            RegisterSoloWildEntity(ent, streamer);
            return true;
        }

        private bool TrySpawnPantherOneNearStreamer(BasePlayer streamer)
        {
            if (streamer == null || !streamer.IsValid()) return false;
            Vector3 pos = GetSingleSpawnPosition(streamer);
            if (pos == Vector3.zero) pos = streamer.transform.position;
            pos = SnapLandNpcSpawnToGround(pos);
            BaseEntity ent = TryCreateEntityFromPrefabCandidates(EnumeratePantherPrefabPaths(), pos);
            if (ent == null) return false;
            ent.Spawn();
            RegisterSoloWildEntity(ent, streamer);
            return true;
        }

        private bool TrySpawnCrocodileOneNearStreamer(BasePlayer streamer)
        {
            if (streamer == null || !streamer.IsValid()) return false;
            if (!TryFindCrocodileSpawnPosition(streamer, out Vector3 pos, out bool inWater))
                return false;
            if (!inWater)
                PrintWarning($"{LogPrefix} Crocodile: no water in gift radius — using land snap (spawn may fail far from rivers/ocean).");

            BaseEntity ent = TryCreateEntityFromPrefabCandidates(EnumerateCrocodilePrefabPaths(), pos);
            if (ent == null) return false;
            ent.Spawn();
            RegisterSoloWildEntity(ent, streamer);
            NetworkableId crocId = ent.net.ID;
            timer.Once(0.15f, () => TryHealSoloWildIfSpawnedDead(crocId));
            return true;
        }

        /// <summary>Some builds leave aquatic animals at 0 HP if the first tick runs before AI init.</summary>
        private void TryHealSoloWildIfSpawnedDead(NetworkableId nid)
        {
            try
            {
                var ent = BaseNetworkable.serverEntities.Find(nid) as BaseCombatEntity;
                if (ent == null || ent.IsDestroyed) return;
                if (!ent.IsDead() && ent.health > 0.5f) return;
                try
                {
                    ent.SetHealth(ent.MaxHealth());
                }
                catch
                {
                    try
                    {
                        ent.Heal(99999f);
                    }
                    catch
                    {
                        // ignore
                    }
                }
            }
            catch
            {
                // ignore
            }
        }

        private bool TrySpawnOneChaosWaveEnemy(BasePlayer streamer, float minRadius, float maxRadius)
        {
            for (int att = 0; att < 35; att++)
            {
                Vector3 pos = GetPositionWithinRadius(streamer, minRadius, maxRadius);
                if (pos == Vector3.zero) pos = GetPositionNear(streamer);
                pos = SnapLandNpcSpawnToGround(pos);
                BaseEntity ent = CreateChaosWaveEnemyEntity(pos);
                if (ent == null) continue;
                ent.Spawn();
                _chaosWaveEnemyIds.Add(ent.net.ID);
                ulong streamerId = _chaosWaveStreamerUserId;
                timer.Once(0.5f, () =>
                {
                    if (ent == null || ent.IsDestroyed) return;
                    BasePlayer streamer = FindConnectedPlayerByUserId(streamerId);
                    if (streamer == null || !streamer.IsValid()) return;
                    TryProvokeChaosWaveEnemy(ent, streamer);
                    TryChaosWaveSteerHumanNpcToward(ent, streamer.transform.position);
                });
                timer.Once(2f, () =>
                {
                    if (ent == null || ent.IsDestroyed) return;
                    BasePlayer streamer = FindConnectedPlayerByUserId(streamerId);
                    if (streamer == null || !streamer.IsValid()) return;
                    TryProvokeChaosWaveEnemy(ent, streamer);
                    TryChaosWaveSteerHumanNpcToward(ent, streamer.transform.position);
                });
                return true;
            }
            return false;
        }

        private int SpawnManyChaosWaveEnemies(BasePlayer streamer, int countWanted, float minRadius, float maxRadius)
        {
            int spawned = 0;
            for (int i = 0; i < countWanted; i++)
            {
                if (TrySpawnOneChaosWaveEnemy(streamer, minRadius, maxRadius))
                    spawned++;
                else
                {
                    PrintWarning($"{LogPrefix} Chaos wave: could not spawn enemy {i + 1}/{countWanted}.");
                    break;
                }
            }
            return spawned;
        }

        /// <summary>
        /// Land chaos wave: spawn 1..10 enemies (same rules for bear / wolf / pig / random). Requires Land.
        /// </summary>
        private void StartLandChaosWave(BasePlayer streamer, ChaosWaveMode mode)
        {
            _chaosWaveMode = mode;
            _chaosWaveUiTitle = ChaosWaveUiTitleForMode(mode);
            _chaosWaveEnemyIds = new HashSet<NetworkableId>();
            _chaosWaveNumber = 1;
            _chaosWaveStreamerUserId = streamer != null ? streamer.userID : 0ul;
            _chaosWaveRandomWavePlan = null;
            _chaosWaveRandomPlanIndex = 0;
            _chaosWaveRandomPrefabsNext = null;
            _chaosWaveRandomNextWavePreview = null;
            // Full heal at the moment the wave starts.
            if (streamer != null && streamer.IsValid())
            {
                streamer.Heal(99999f);
                GivePistolAndAmmoToStreamerBelt(streamer, "Chaos wave start");
            }
            GiveChaosWaveLoadout(streamer, 1);
            if (mode == ChaosWaveMode.Random && streamer != null && streamer.IsValid())
            {
                // Vanilla stone stack is 1000; three stacks = 3000.
                for (int si = 0; si < 3; si++)
                    GiveItemWithLog(streamer, 1000, "stones", "Chaos Random Wave start (stone)");
                GiveItemWithLog(streamer, 1, "door.hinged.metal", "Chaos Random Wave start (metal door)");
                GiveItemWithLog(streamer, 1, "wall.window.glass.reinforced", "Chaos Random Wave start (reinforced window)");
                BroadcastChat("Chaos Random Wave: 3000 stone, 1 metal door, 1 reinforced glass window; round 1 loadout includes 1500 wood + building hammer.");
            }
            StartChaosWaveLeashTimer();
            _chaosWaveTargetBearCount = 1;
            _chaosWaveSpawnedBearCount = 0;
            _chaosWaveKilledBearCount = 0;
            _chaosWaveSpawning = true;
            int firstWaveSpawnDelaySeconds = 20;
            ShowChaosWaveUIToAll(_chaosWaveUiTitle, $"Wave 1\nFirst enemy in {firstWaveSpawnDelaySeconds}s");
            timer.Once(firstWaveSpawnDelaySeconds, () =>
            {
                if (_chaosWaveEnemyIds == null) return;
                BasePlayer s = GetStreamerPlayer();
                if (s == null || !s.IsValid())
                {
                    CancelChaosWave("Chaos wave cancelled (streamer offline).");
                    return;
                }
                SpawnChaosWaveBears(s, 1);
                int n = _chaosWaveTargetBearCount;
                BroadcastChat(ChaosWaveSpawnBroadcastLine(1, n));
                Puts($"{LogPrefix} Chaos wave 1: {n} enemies spawned after delay ({_chaosWaveMode}).");
                ShowChaosWaveUIToAll(_chaosWaveUiTitle, $"Wave 1\nEnemies left: {Mathf.Max(0, n)}");
            });
            Puts($"{LogPrefix} Chaos wave started ({_chaosWaveMode}): wave 1 queued (20s delay).");
        }

        private void StartChaosWaveLeashTimer()
        {
            _chaosWaveLeashTimer?.Destroy();
            _chaosWaveLeashTimer = null;
            _chaosWaveHumanNpcSteerTimer?.Destroy();
            _chaosWaveHumanNpcSteerTimer = null;
            float leash = Mathf.Clamp(_config?.ChaosWaveBearLeashDistance ?? 18f, 5f, 80f);
            _chaosWaveLeashTimer = timer.Repeat(1f, 0, () => CheckChaosWaveLeash(leash));
            // Scientists need frequent SetDestination + combat state; 1s is too slow for Brain.Navigator to commit.
            _chaosWaveHumanNpcSteerTimer = timer.Repeat(0.4f, 0, CheckChaosWaveHumanNpcSteer);
        }

        /// <summary>
        /// Tiny damage with streamer as initiator — wakes threat / combat AI when spawn alone leaves NPC idle.
        /// </summary>
        private static void TryProvokeHumanNpcCombat(HumanNPC target, BasePlayer streamer)
        {
            if (target == null || streamer == null || target.IsDestroyed || !streamer.IsValid()) return;
            try
            {
                HitInfo hit = new HitInfo();
                hit.Initiator = streamer;
                hit.HitEntity = target;
                hit.HitPositionWorld = target.transform.position;
                hit.damageTypes.Add(DamageType.Stab, 0.05f);
                target.Hurt(hit);
            }
            catch
            {
                // ignore API differences
            }
        }

        /// <summary>
        /// Provoke humans (scientists) or animals (bears/wolves) so the streamer registers as a threat.
        /// </summary>
        private static void TryProvokeChaosWaveEnemy(BaseEntity ent, BasePlayer streamer)
        {
            if (ent == null || streamer == null || !streamer.IsValid()) return;
            var human = ent as HumanNPC;
            if (human != null)
            {
                TryProvokeHumanNpcCombat(human, streamer);
                return;
            }

            var bc = ent as BaseCombatEntity;
            if (bc == null || bc is BasePlayer) return;
            try
            {
                HitInfo hit = new HitInfo();
                hit.Initiator = streamer;
                hit.HitEntity = bc;
                hit.HitPositionWorld = bc.transform.position;
                hit.damageTypes.Add(DamageType.Stab, 0.05f);
                bc.Hurt(hit);
            }
            catch
            {
                // ignore
            }
        }

        private static UnityEngine.AI.NavMeshAgent TryGetNavMeshAgentOnEntity(BaseEntity ent)
        {
            if (ent == null) return null;
            var a = ent.GetComponent<UnityEngine.AI.NavMeshAgent>();
            if (a != null) return a;
            return ent.GetComponentInChildren<UnityEngine.AI.NavMeshAgent>();
        }

        /// <summary>Bears/wolves/etc.: keep NavMesh aimed at streamer (chaos wave + solo spawns).</summary>
        private static void TryChaosWaveSteerAnimalNavTowardStream(BaseEntity ent, Vector3 streamerPos)
        {
            if (ent == null || ent is HumanNPC) return;
            try
            {
                var agent = TryGetNavMeshAgentOnEntity(ent);
                if (agent != null && agent.enabled && agent.isOnNavMesh)
                {
                    agent.isStopped = false;
                    agent.SetDestination(streamerPos);
                }
            }
            catch
            {
                // ignore
            }
        }

        /// <summary>
        /// Scientists / human NPCs use ScientistBrain/HumanNPC Brain.Navigator (NavMesh), not a root NavMeshAgent like bears.
        /// Without SetDestination toward the streamer they often stand still and never enter combat.
        /// </summary>
        private static bool TryChaosWaveSteerHumanNpcToward(BaseEntity ent, Vector3 streamerPos)
        {
            var humanNpc = ent as HumanNPC;
            if (humanNpc != null)
            {
                try
                {
                    if (humanNpc.IsDestroyed) return true;
                    var brain = humanNpc.Brain;
                    if (brain == null || brain.Navigator == null) return false;
                    var nav = brain.Navigator;
                    if (nav.Agent != null && !nav.Agent.isOnNavMesh)
                        nav.PlaceOnNavMesh(0f);
                    Vector3 a = humanNpc.transform.position;
                    Vector3 b = streamerPos;
                    a.y = 0f;
                    b.y = 0f;
                    float dist = Vector3.Distance(a, b);
                    var speed = dist > 12f ? BaseNavigator.NavigationSpeed.Fast : BaseNavigator.NavigationSpeed.Normal;
                    nav.SetDestination(streamerPos, speed);
                    return true;
                }
                catch
                {
                    return false;
                }
            }

            var npcPlayer = ent as NPCPlayer;
            if (npcPlayer != null)
            {
                try
                {
                    if (npcPlayer.IsDestroyed) return true;
                    var agent = npcPlayer.NavAgent;
                    if (agent == null || !agent.enabled) return false;
                    if (!agent.isOnNavMesh) return false;
                    agent.isStopped = false;
                    agent.SetDestination(streamerPos);
                    return true;
                }
                catch
                {
                    return false;
                }
            }

            return false;
        }

        private void CheckChaosWaveHumanNpcSteer()
        {
            if (_chaosWaveEnemyIds == null || _chaosWaveEnemyIds.Count == 0) return;
            if (!TryGetChaosWaveStreamerPosition(out Vector3 streamerPos))
            {
                CancelChaosWave("Chaos wave cancelled (streamer offline).");
                return;
            }

            var ids = new List<NetworkableId>(_chaosWaveEnemyIds);
            foreach (var nid in ids)
            {
                try
                {
                    var ent = BaseNetworkable.serverEntities.Find(nid) as BaseEntity;
                    if (ent == null || ent.IsDestroyed) continue;
                    if (!TryChaosWaveSteerHumanNpcToward(ent, streamerPos))
                        TryChaosWaveSteerAnimalNavTowardStream(ent, streamerPos);
                }
                catch
                {
                    // ignore
                }
            }
        }

        /// <summary>
        /// Solo scientist (and any solo HumanNPC/NPCPlayer): chaos wave steers these every 0.4s; solo path only had 1s leash and skipped steer when inside leash — they stood still.
        /// </summary>
        private void CheckSoloWildHumanNpcSteer()
        {
            if (_soloWildAnimalIds == null || _soloWildAnimalIds.Count == 0)
            {
                _soloWildHumanNpcSteerTimer?.Destroy();
                _soloWildHumanNpcSteerTimer = null;
                return;
            }

            if (!TryGetSoloWildStreamerPosition(out Vector3 streamerPos))
            {
                CleanupSoloWildAnimalsAndStop();
                return;
            }

            var ids = new List<NetworkableId>(_soloWildAnimalIds);
            foreach (var nid in ids)
            {
                try
                {
                    var ent = BaseNetworkable.serverEntities.Find(nid) as BaseEntity;
                    if (ent == null || ent.IsDestroyed) continue;
                    if (!TryChaosWaveSteerHumanNpcToward(ent, streamerPos))
                        TryChaosWaveSteerAnimalNavTowardStream(ent, streamerPos);
                }
                catch
                {
                    // ignore
                }
            }
        }

        private bool TryGetSoloWildStreamerPosition(out Vector3 pos)
        {
            pos = default;
            if (_soloWildStreamerUserId == 0ul) return false;
            foreach (var p in BasePlayer.activePlayerList)
            {
                if (p != null && p.IsConnected && p.userID == _soloWildStreamerUserId)
                {
                    pos = p.transform.position;
                    return true;
                }
            }

            return false;
        }

        private void EnsureSoloWildLeashTimer()
        {
            if (_soloWildLeashTimer != null) return;
            float leash = Mathf.Clamp(_config?.ChaosWaveBearLeashDistance ?? 18f, 5f, 80f);
            _soloWildLeashTimer = timer.Repeat(1f, 0, () => CheckSoloWildLeash(leash));
            if (_soloWildHumanNpcSteerTimer == null)
                _soloWildHumanNpcSteerTimer = timer.Repeat(0.4f, 0, CheckSoloWildHumanNpcSteer);
        }

        private void StopSoloWildLeashTimer()
        {
            _soloWildLeashTimer?.Destroy();
            _soloWildLeashTimer = null;
            _soloWildHumanNpcSteerTimer?.Destroy();
            _soloWildHumanNpcSteerTimer = null;
            _soloWildAnimalIds = null;
            _soloWildStreamerUserId = 0ul;
        }

        private void CleanupSoloWildAnimalsAndStop()
        {
            try
            {
                if (_soloWildAnimalIds != null)
                {
                    foreach (var nid in _soloWildAnimalIds)
                    {
                        try
                        {
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
                StopSoloWildLeashTimer();
            }
        }

        private void CheckSoloWildLeash(float leashDistance)
        {
            if (_soloWildAnimalIds == null || _soloWildAnimalIds.Count == 0)
            {
                StopSoloWildLeashTimer();
                return;
            }

            if (!TryGetSoloWildStreamerPosition(out Vector3 streamerPos))
            {
                CleanupSoloWildAnimalsAndStop();
                return;
            }

            float leashSqr = leashDistance * leashDistance;
            var ids = new List<NetworkableId>(_soloWildAnimalIds);
            foreach (var nid in ids)
            {
                try
                {
                    var ent = BaseNetworkable.serverEntities.Find(nid) as BaseEntity;
                    if (ent == null || ent.IsDestroyed)
                    {
                        _soloWildAnimalIds.Remove(nid);
                        continue;
                    }

                    // Human NPCs (scientists): steered every 0.4s in CheckSoloWildHumanNpcSteer (same as chaos wave).
                    if (ent is HumanNPC || ent is NPCPlayer)
                        continue;

                    TryChaosWaveSteerAnimalNavTowardStream(ent, streamerPos);

                    Vector3 d = ent.transform.position - streamerPos;
                    if (d.sqrMagnitude <= leashSqr) continue;

                    Vector3 toStreamer = streamerPos - ent.transform.position;
                    toStreamer.y = 0f;
                    if (toStreamer.sqrMagnitude > 0.01f)
                        toStreamer.Normalize();

                    try { ent.transform.rotation = Quaternion.LookRotation(toStreamer); } catch { }

                    try
                    {
                        var agent = TryGetNavMeshAgentOnEntity(ent);
                        if (agent != null)
                        {
                            agent.isStopped = false;
                            agent.SetDestination(streamerPos);
                        }
                    }
                    catch { }

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
                catch { }
            }

            if (_soloWildAnimalIds.Count == 0)
                StopSoloWildLeashTimer();
        }

        private void RegisterSoloWildEntity(BaseEntity entity, BasePlayer streamer)
        {
            if (entity == null || streamer == null || !streamer.IsValid()) return;
            if (_soloWildAnimalIds == null) _soloWildAnimalIds = new HashSet<NetworkableId>();
            _soloWildAnimalIds.Add(entity.net.ID);
            _soloWildStreamerUserId = streamer.userID;
            EnsureSoloWildLeashTimer();
            ulong sid = streamer.userID;
            NetworkableId nid = entity.net.ID;
            timer.Once(0.5f, () =>
            {
                var e = BaseNetworkable.serverEntities.Find(nid) as BaseEntity;
                var s = FindConnectedPlayerByUserId(sid);
                if (e != null && s != null && s.IsValid())
                    TryProvokeChaosWaveEnemy(e, s);
            });
        }

        /// <summary>Wolf/bear/pig gift spawns: track + leash + provoke like chaos wave animals.</summary>
        private bool TrySpawnSoloWildAnimal(BasePlayer streamer, string prefabPath, string logContext)
        {
            if (streamer == null || !streamer.IsValid() || string.IsNullOrEmpty(prefabPath)) return false;
            Vector3 pos = GetSingleSpawnPosition(streamer);
            if (pos == Vector3.zero) pos = streamer.transform.position;
            pos = SnapLandNpcSpawnToGround(pos);
            BaseEntity entity = GameManager.server.CreateEntity(prefabPath, pos, Quaternion.identity, true);
            if (entity == null) return false;
            entity.Spawn();
            RegisterSoloWildEntity(entity, streamer);
            Puts($"{LogPrefix} Solo wild ({logContext}): spawned & leashed for {streamer.displayName}");
            return true;
        }

        /// <summary>Single scientist gift: spawn, then register/provoke so it actively hunts and fights like other tracked enemies.</summary>
        private bool TrySpawnSingleScientist(BasePlayer streamer, Vector3 position)
        {
            return TrySpawnSingleScientistFromCandidates(streamer, position, SingleScientistPrefabCandidates);
        }

        /// <summary>Spawn one scientist from an ordered prefab list (first path that CreateEntity accepts).</summary>
        private bool TrySpawnSingleScientistFromCandidates(BasePlayer streamer, Vector3 position, string[] candidates)
        {
            if (streamer == null || !streamer.IsValid() || candidates == null || candidates.Length == 0) return false;
            position = SnapLandNpcSpawnToGround(position);
            BaseEntity entity = null;
            foreach (var path in candidates)
            {
                if (string.IsNullOrWhiteSpace(path)) continue;
                entity = GameManager.server.CreateEntity(path, position, Quaternion.identity, true);
                if (entity != null) break;
            }
            if (entity == null) return false;
            entity.Spawn();
            RegisterSoloWildEntity(entity, streamer);
            TryProvokeChaosWaveEnemy(entity, streamer);
            NetworkableId nid = entity.net.ID;
            ulong sid = streamer.userID;
            timer.Once(0.25f, () =>
            {
                BaseEntity e = BaseNetworkable.serverEntities.Find(nid) as BaseEntity;
                BasePlayer s = FindConnectedPlayerByUserId(sid);
                if (e == null || e.IsDestroyed || s == null || !s.IsValid()) return;
                TryProvokeChaosWaveEnemy(e, s);
            });
            return true;
        }

        private bool TrySpawnChickenNearStreamer(BasePlayer streamer)
        {
            if (streamer == null || !streamer.IsValid()) return false;
            foreach (var path in ChickenPrefabCandidates)
            {
                if (string.IsNullOrWhiteSpace(path)) continue;
                if (TrySpawnSoloWildAnimal(streamer, path, "chicken"))
                    return true;
            }
            return false;
        }

        private bool TryGetChaosWaveStreamerPosition(out Vector3 pos)
        {
            pos = default;
            if (_chaosWaveStreamerUserId == 0ul) return false;
            foreach (var p in BasePlayer.activePlayerList)
            {
                if (p != null && p.IsConnected && p.userID == _chaosWaveStreamerUserId)
                {
                    pos = p.transform.position;
                    return true;
                }
            }

            return false;
        }

        private void CheckChaosWaveLeash(float leashDistance)
        {
            if (_chaosWaveEnemyIds == null || _chaosWaveEnemyIds.Count == 0) return;

            if (!TryGetChaosWaveStreamerPosition(out Vector3 streamerPosVal))
            {
                CancelChaosWave("Chaos wave cancelled (streamer offline).");
                return;
            }

            Vector3 streamerPos = streamerPosVal;

            float leashSqr = leashDistance * leashDistance;
            // Copy ids to avoid mutation during enumeration.
            var ids = new List<NetworkableId>(_chaosWaveEnemyIds);
            foreach (var nid in ids)
            {
                try
                {
                    var ent = BaseNetworkable.serverEntities.Find(nid) as BaseEntity;
                    if (ent == null || ent.IsDestroyed) continue;

                    // Human NPCs (if any) are steered by CheckChaosWaveHumanNpcSteer every 0.4s.
                    if (ent is HumanNPC)
                        continue;

                    // Animals / zombie: same leash radius as config; NavMesh toward streamer every tick (bear/wolf/pig/tiger/panther/random).
                    TryChaosWaveSteerAnimalNavTowardStream(ent, streamerPos);

                    Vector3 d = ent.transform.position - streamerPos;
                    if (d.sqrMagnitude > leashSqr)
                    {
                        // Don't kill (player expects bears to "run back" and not disappear).
                        // Instead, steer them back toward the streamer:
                        // 1) rotate toward streamer
                        // 2) if NavMeshAgent exists, SetDestination()
                        // 3) otherwise, push rigidbody velocity in that direction
                        Vector3 toStreamer = streamerPos - ent.transform.position;
                        toStreamer.y = 0f;
                        if (toStreamer.sqrMagnitude > 0.01f)
                            toStreamer.Normalize();

                        // Turn to face streamer.
                        try { ent.transform.rotation = Quaternion.LookRotation(toStreamer); } catch { }

                        // Prefer navigation if present.
                        try
                        {
                            var agent = TryGetNavMeshAgentOnEntity(ent);
                            if (agent != null)
                            {
                                agent.isStopped = false;
                                agent.SetDestination(streamerPos);
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
            if (entity == null) return;

            if (_soloWildAnimalIds != null && _soloWildAnimalIds.Remove(entity.net.ID) && _soloWildAnimalIds.Count == 0)
                StopSoloWildLeashTimer();

            if (_heliChaosActive && IsCounterHelicopterForHeliChaos(entity))
            {
                float now = UnityEngine.Time.realtimeSinceStartup;
                if (now >= _heliChaosNextBonusCrateTime)
                {
                    float cd = Mathf.Max(15f, _config?.HeliChaosCrateBonusCooldownSeconds ?? 60f);
                    _heliChaosNextBonusCrateTime = now + cd;
                    BasePlayer crateTarget = FindConnectedPlayerByUserId(_heliChaosStreamerUserId) ?? GetStreamerPlayer();
                    if (crateTarget != null && crateTarget.IsValid())
                    {
                        if (TrySpawnHackableLockedCrateNear(crateTarget, "Heli chaos — bonus crate (helicopter destroyed)"))
                        {
                            BroadcastChat("Helicopter destroyed! Chinook-style locked crate dropped near the streamer.");
                            // End the session after the first counter-heli kill to avoid crates from unrelated future helis.
                            _heliChaosActive = false;
                        }
                    }
                }
            }

            if (_chaosWaveEnemyIds == null) return;

            // If the streamer dies mid-wave, cancel the entire wave.
            BasePlayer deadPlayer = entity as BasePlayer;
            if (deadPlayer != null && _chaosWaveStreamerUserId != 0ul && deadPlayer.userID == _chaosWaveStreamerUserId)
            {
                CancelChaosWave("Chaos wave cancelled (streamer died).");
                return;
            }

            if (!_chaosWaveEnemyIds.Remove(entity.net.ID)) return;
            _chaosWaveKilledBearCount++;
            int bearsLeftThisWave = Math.Max(0, _chaosWaveTargetBearCount - _chaosWaveKilledBearCount);
            ShowChaosWaveUIToAll(_chaosWaveUiTitle, $"Wave {_chaosWaveNumber}\nEnemies left: {bearsLeftThisWave}");
            if (_chaosWaveEnemyIds.Count > 0) return;

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
                _chaosWaveEnemyIds = null;
                _chaosWaveSpawning = false;
                _chaosWaveTargetBearCount = 0;
                _chaosWaveSpawnedBearCount = 0;
                _chaosWaveKilledBearCount = 0;
                _chaosWaveLeashTimer?.Destroy();
                _chaosWaveLeashTimer = null;
                _chaosWaveHumanNpcSteerTimer?.Destroy();
                _chaosWaveHumanNpcSteerTimer = null;
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
            if (_chaosWaveMode == ChaosWaveMode.Random)
            {
                _chaosWaveRandomPrefabsNext = BuildRandomWavePrefabPlan(_chaosWaveNumber);
                _chaosWaveRandomNextWavePreview =
                    $"Next: Wave {_chaosWaveNumber} ({_chaosWaveRandomPrefabsNext.Count} enemies) — {FormatRandomWaveEnemyRollCall(_chaosWaveRandomPrefabsNext)}";
            }
            else
            {
                _chaosWaveRandomPrefabsNext = null;
                _chaosWaveRandomNextWavePreview = null;
            }
            _chaosWaveCountdown = ChaosWaveCountdownAfterWaveSeconds[completedWave - 1];
            if (_chaosWaveCountdown < 0) _chaosWaveCountdown = 0;
            _chaosWaveCountdownTimer?.Destroy();
            _chaosWaveCountdownTimer = timer.Repeat(1f, 0, ChaosWaveCountdownTick);
            ShowChaosWaveUIToAll(ChaosWaveCountdownTitleWithTimer(), ChaosWaveCountdownSubtext(completedWave));
            if (_chaosWaveMode == ChaosWaveMode.Random && !string.IsNullOrEmpty(_chaosWaveRandomNextWavePreview))
                BroadcastChat(_chaosWaveRandomNextWavePreview);
        }

        private void ChaosWaveCountdownTick()
        {
            _chaosWaveCountdown--;
            ShowChaosWaveUIToAll(ChaosWaveCountdownTitleWithTimer(), ChaosWaveCountdownSubtext(_chaosWaveNumber - 1));
            if (_chaosWaveCountdown > 0) return;

            _chaosWaveCountdownTimer?.Destroy();
            _chaosWaveCountdownTimer = null;
            BasePlayer streamer = GetStreamerPlayer();
            if (streamer == null || !streamer.IsValid())
            {
                _chaosWaveEnemyIds = null;
                _chaosWaveLeashTimer?.Destroy();
                _chaosWaveLeashTimer = null;
                _chaosWaveHumanNpcSteerTimer?.Destroy();
                _chaosWaveHumanNpcSteerTimer = null;
                DestroyChaosWaveUIForAll();
                return;
            }
            SpawnChaosWaveBears(streamer, _chaosWaveNumber);
            int spawnedNow = _chaosWaveTargetBearCount;
            BroadcastChat(ChaosWaveSpawnBroadcastLine(_chaosWaveNumber, spawnedNow));
            Puts($"{LogPrefix} Chaos wave {_chaosWaveNumber}: {spawnedNow} enemies ({_chaosWaveMode}).");
            ShowChaosWaveUIToAll(_chaosWaveUiTitle, $"Wave {_chaosWaveNumber}\nEnemies left: {spawnedNow}");
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
                RectTransform = { AnchorMin = "0.02 0.78", AnchorMax = "0.38 0.99" }
            }, "Overlay", ChaosWaveUiName);
            string text = line1;
            if (!string.IsNullOrEmpty(line2)) text += "\n" + line2;
            container.Add(new CuiLabel
            {
                Text = { Text = text, FontSize = 13, Align = TextAnchor.UpperLeft, Color = "1 0.9 0.3 1" },
                RectTransform = { AnchorMin = "0.04 0.06", AnchorMax = "0.96 0.94" }
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
        /// Spawns N chaos-wave enemies within ChaosWaveBearRadius of the streamer and tracks their net IDs.
        /// </summary>
        private void SpawnChaosWaveBears(BasePlayer streamer, int count)
        {
            if (_chaosWaveMode == ChaosWaveMode.Random)
            {
                _chaosWaveRandomNextWavePreview = null;
                if (_chaosWaveRandomPrefabsNext != null && _chaosWaveRandomPrefabsNext.Count == count)
                {
                    _chaosWaveRandomWavePlan = _chaosWaveRandomPrefabsNext;
                    _chaosWaveRandomPrefabsNext = null;
                }
                else
                    _chaosWaveRandomWavePlan = BuildRandomWavePrefabPlan(count);
                _chaosWaveRandomPlanIndex = 0;
            }
            else
            {
                _chaosWaveRandomWavePlan = null;
                _chaosWaveRandomPlanIndex = 0;
            }

            _chaosWaveSpawnedBearCount = 0;
            _chaosWaveKilledBearCount = 0;
            _chaosWaveSpawning = count >= 4;

            float maxRadius = Mathf.Clamp(_config?.ChaosWaveBearRadius ?? 25f, 10f, 80f);
            float minRadius = _chaosWaveMode == ChaosWaveMode.Random ? 4f : 6f;
            float leashDistance = Mathf.Clamp(_config?.ChaosWaveBearLeashDistance ?? 18f, 5f, 80f);
            float effectiveMaxRadius = Mathf.Min(maxRadius, leashDistance - 1f);
            if (effectiveMaxRadius < minRadius)
                effectiveMaxRadius = minRadius;

            // Spawn everything at once for waves 1-3.
            if (!_chaosWaveSpawning)
            {
                int spawned = SpawnManyChaosWaveEnemies(streamer, count, minRadius, effectiveMaxRadius);
                _chaosWaveTargetBearCount = spawned;
                _chaosWaveSpawnedBearCount = spawned;
                if (spawned < count)
                    PrintWarning($"{LogPrefix} Chaos wave: wanted {count} enemies, spawned {spawned} ({_chaosWaveMode}).");
                return;
            }

            _chaosWaveTargetBearCount = count;

            // From wave 4 onward: staged group spawns (even waves: 2 per tick, odd: 1 per tick).
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
                    if (_chaosWaveEnemyIds == null || scheduledCount <= 0) return;

                    BasePlayer s = GetStreamerPlayer();
                    if (s == null || !s.IsValid())
                    {
                        CancelChaosWave("Chaos wave cancelled (streamer offline).");
                        return;
                    }

                    int got = 0;
                    for (int i = 0; i < scheduledCount; i++)
                    {
                        if (TrySpawnOneChaosWaveEnemy(s, minRadius, effectiveMaxRadius))
                            got++;
                    }
                    _chaosWaveSpawnedBearCount += got;
                    if (_chaosWaveSpawnedBearCount >= _chaosWaveTargetBearCount)
                        _chaosWaveSpawning = false;
                });
            }

            // Ensure spawn phase ends even if some slots failed (random prefabs / limits).
            if (groupIndex > 0)
            {
                float settleDelay = (groupIndex - 1) * interval + 2.5f;
                timer.Once(settleDelay, () =>
                {
                    if (_chaosWaveEnemyIds == null) return;
                    if (!_chaosWaveSpawning) return;
                    _chaosWaveTargetBearCount = _chaosWaveSpawnedBearCount;
                    _chaosWaveSpawning = false;
                    if (_chaosWaveSpawnedBearCount < count)
                        PrintWarning($"{LogPrefix} Chaos wave: staged spawn ended with {_chaosWaveSpawnedBearCount}/{count} enemies ({_chaosWaveMode}).");
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
            GiveOrDropItem(player, item, player.inventory.containerMain);
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
            GiveOrDropItem(player, item, player.inventory.containerBelt);
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
                GiveOrDropItem(player, item, player.inventory.containerMain);
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
                GiveOrDropItem(player, item, player.inventory.containerBelt);
                return;
            }
            PrintWarning($"{LogPrefix} ChaosWave: none of the belt item candidates were found ({context}).");
        }

        private void GiveChaosWaveLoadout(BasePlayer streamer, int wave)
        {
            // "Wall" handling: give wooden barricades (as requested).
            // If your server uses a different mapping, plugin will log which item shortnames are missing.
            string[] wallCandidates = { "barricade.cover.wood", "barricade.cover.wood_double", "barricade.wood.cover", "barricade.wood", "barricade.woodwire" };
            string[] buildingPlanCandidates = { "planner", "building.planner", "building.plan", "building_plan" };
            string[] hammerCandidates = { "hammer", "hammer.building", "hammer.item" };

            // Med stick + bandage (cloth bandage) shortnames
            string[] medCandidates = { "medstick" };
            const string bandageShort = "bandage";

            // Weapons & ammo
            switch (wave)
            {
                case 1:
                    GiveItemToBeltWithLog(streamer, 1, "bow.hunting", "Round 1 bow (belt/arm slot)");
                    GiveItemWithLog(streamer, 100, "arrow.wooden", "Round 1 arrows (100)");
                    GiveFirstItemToBeltWithLog(streamer, 1, buildingPlanCandidates, "Round 1 building plan (belt/arm slot)");
                    if (_chaosWaveMode == ChaosWaveMode.Random)
                    {
                        GiveItemWithLog(streamer, 1500, "wood", "Round 1 wood — Random Chaos (1500)");
                        GiveFirstItemWithLog(streamer, 1, hammerCandidates, "Round 1 building hammer (main)");
                    }
                    else
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
                if (_chaosWaveEnemyIds != null)
                {
                    foreach (var nid in _chaosWaveEnemyIds)
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
                _chaosWaveEnemyIds = null;
                _chaosWaveNumber = 0;
                _chaosWaveRandomWavePlan = null;
                _chaosWaveRandomPlanIndex = 0;
                _chaosWaveRandomPrefabsNext = null;
                _chaosWaveRandomNextWavePreview = null;
                _chaosWaveTargetBearCount = 0;
                _chaosWaveSpawnedBearCount = 0;
                _chaosWaveKilledBearCount = 0;
                _chaosWaveSpawning = false;
                _chaosWaveCountdown = 0;
                _chaosWaveStreamerUserId = 0ul;
                _chaosWaveLeashTimer?.Destroy();
                _chaosWaveLeashTimer = null;
                _chaosWaveHumanNpcSteerTimer?.Destroy();
                _chaosWaveHumanNpcSteerTimer = null;
                _chaosWaveCountdownTimer?.Destroy();
                _chaosWaveCountdownTimer = null;
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

        #region Streamer TikTok status effects (metabolism + lower-left HUD)

        private static bool IsStreamerStatusEffectAction(string action)
        {
            return action == "statuspoison" || action == "statusdehydrated" || action == "statushungry" ||
                   action == "statusbleeding" || action == "statusdart" || action == "statusgodmode" ||
                   action == "statusbullethell" || action == "statusflippers" || action == "statusflash" ||
                   action == "statushealthx3";
        }

        private bool HasActiveStreamerStatusKind(string kind)
        {
            if (string.IsNullOrEmpty(kind) || _streamerTimedStatuses == null || _streamerTimedStatuses.Count == 0)
                return false;
            float now = Time.realtimeSinceStartup;
            foreach (var s in _streamerTimedStatuses)
            {
                if (s != null && s.Kind == kind && now < s.EndTime)
                    return true;
            }

            return false;
        }

        private static void RefillStreamerHeldWeaponAmmo(BasePlayer p)
        {
            if (p == null || !p.IsConnected) return;
            try
            {
                var held = p.GetHeldEntity() as BaseProjectile;
                if (held == null || held.primaryMagazine == null) return;
                held.primaryMagazine.contents = held.primaryMagazine.capacity;
                held.SendNetworkUpdateImmediate();
            }
            catch
            {
                // ignore
            }
        }

        private string TryApplyStreamerGodModeStatus(BasePlayer target, string viewerName, string giftName,
            Func<string, string> chatMsg, int scrapAmountArg)
        {
            if (target == null || !target.IsConnected || target.IsSleeping())
                return "FAILED: Streamer must be awake online for TikTok status effects (HUD). Check RustChaos.json StreamerName matches their display name.";
            int durationSec = scrapAmountArg > 0 ? Mathf.Clamp(scrapAmountArg, 1, 120) : 10;
            RegisterStreamerTimedStatus("godmode", durationSec, false, viewerName, giftName);
            BroadcastChat(chatMsg($"{viewerName} → {target.displayName}: TIME GOD MODE ({durationSec}s) — no damage."));
            Puts($"{LogPrefix} TikTok godmode on {target.displayName} for {durationSec}s (viewer {viewerName}).");
            return null;
        }

        private string TryApplyStreamerBulletHellStatus(BasePlayer target, string viewerName, string giftName,
            Func<string, string> chatMsg, int scrapAmountArg)
        {
            if (target == null || !target.IsConnected || target.IsSleeping())
                return "FAILED: Streamer must be awake online for TikTok status effects. Check RustChaos.json StreamerName.";
            int durationSec = scrapAmountArg > 0 ? Mathf.Clamp(scrapAmountArg, 1, 120) : 10;
            RegisterStreamerTimedStatus("bullethell", durationSec, false, viewerName, giftName);
            RefillStreamerHeldWeaponAmmo(target);
            BroadcastChat(chatMsg($"{viewerName} → {target.displayName}: BULLET HELL ({durationSec}s) — held weapon ammo refills."));
            Puts($"{LogPrefix} TikTok bullethell on {target.displayName} for {durationSec}s.");
            return null;
        }

        private string TryApplyStreamerFlashStatus(BasePlayer target, string viewerName, string giftName,
            Func<string, string> chatMsg, int scrapAmountArg)
        {
            if (target == null || !target.IsConnected || target.IsSleeping())
                return "FAILED: Streamer must be awake online for TikTok status effects. Check RustChaos.json StreamerName.";
            int durationSec = scrapAmountArg > 0 ? Mathf.Clamp(scrapAmountArg, 1, 120) : 10;
            RegisterStreamerTimedStatus("flash", durationSec, false, viewerName, giftName);
            BroadcastChat(chatMsg($"{viewerName} → {target.displayName}: FLASH ({durationSec}s) — sprint stamina stays topped."));
            Puts($"{LogPrefix} TikTok flash on {target.displayName} for {durationSec}s.");
            return null;
        }

        private string TryApplyStreamerHealthX3Status(BasePlayer target, string viewerName, string giftName,
            Func<string, string> chatMsg, int scrapAmountArg)
        {
            if (target == null || !target.IsConnected || target.IsSleeping())
                return "FAILED: Streamer must be awake online for TikTok status effects. Check RustChaos.json StreamerName.";
            int durationSec = scrapAmountArg > 0 ? Mathf.Clamp(scrapAmountArg, 1, 120) : 10;
            float oldMax;
            try
            {
                oldMax = target.MaxHealth();
            }
            catch
            {
                oldMax = 100f;
            }

            float oldHealth = target.health;
            float newMax = oldMax * 3f;
            try
            {
                target.InitializeHealth(newMax, Mathf.Min(newMax, oldHealth * 3f));
            }
            catch (Exception ex)
            {
                PrintWarning($"{LogPrefix} statushealthx3 InitializeHealth failed: {ex.Message}");
                return "FAILED: Could not apply health multiplier (server build).";
            }

            RegisterStreamerTimedStatus("healthx3", durationSec, false, viewerName, giftName, oldMax);
            BroadcastChat(chatMsg($"{viewerName} → {target.displayName}: HEALTH x3 ({durationSec}s) — max HP tripled."));
            Puts($"{LogPrefix} TikTok healthx3 on {target.displayName} for {durationSec}s (was max {oldMax:0}).");
            return null;
        }

        private string TryApplyStreamerFlippersStatus(BasePlayer target, string viewerName, string giftName,
            Func<string, string> chatMsg, int scrapAmountArg)
        {
            if (target == null || !target.IsConnected || target.IsSleeping())
                return "FAILED: Streamer must be awake online. Check RustChaos.json StreamerName.";
            int durationSec = scrapAmountArg > 0 ? Mathf.Clamp(scrapAmountArg, 1, 120) : 10;
            const string finsShort = "diving.fins";
            var wear = target.inventory?.containerWear;
            var belt = target.inventory?.containerBelt;
            if (wear == null || belt == null)
                return "FAILED: inventory not ready.";
            ulong backupUid = 0UL;
            try
            {
                foreach (var it in wear.itemList.ToArray())
                {
                    if (it == null || it.info == null) continue;
                    if (string.Equals(it.info.shortname, finsShort, StringComparison.OrdinalIgnoreCase))
                        continue;
                    var mod = it.info.GetComponentInChildren<ItemModWearable>();
                    if (mod == null) continue;
                    if (!it.MoveToContainer(belt))
                        continue;
                    backupUid = it.uid.Value;
                    break;
                }
            }
            catch
            {
                // ignore
            }

            if (!TryCreateItemMoveToWear(target, finsShort, 1))
            {
                PrintWarning($"{LogPrefix} statusflippers: could not equip {finsShort} (item missing on this server?).");
                return $"FAILED: Item '{finsShort}' not available — check item manifest.";
            }

            if (backupUid != 0UL)
                _flippersBackupItemByUser[target.userID] = backupUid;
            RegisterStreamerTimedStatus("flippers", durationSec, false, viewerName, giftName, 0f, backupUid);
            BroadcastChat(chatMsg($"{viewerName} → {target.displayName}: FLIPPERS ({durationSec}s) — diving fins equipped."));
            Puts($"{LogPrefix} TikTok flippers on {target.displayName} for {durationSec}s.");
            return null;
        }

        private static Item FindItemByUid(BasePlayer p, ulong uid)
        {
            if (p?.inventory == null || uid == 0UL) return null;
            try
            {
                foreach (var c in new[] { p.inventory.containerBelt, p.inventory.containerMain, p.inventory.containerWear })
                {
                    if (c == null) continue;
                    foreach (var it in c.itemList)
                    {
                        if (it != null && it.uid.Value == uid)
                            return it;
                    }
                }
            }
            catch
            {
                // ignore
            }

            return null;
        }

        private void RestoreFlippersFootwear(BasePlayer p, ulong backupUid)
        {
            if (p == null || !p.IsConnected) return;
            var wear = p.inventory?.containerWear;
            if (wear == null) return;
            const string finsShort = "diving.fins";
            try
            {
                foreach (var it in wear.itemList.ToArray())
                {
                    if (it?.info != null &&
                        string.Equals(it.info.shortname, finsShort, StringComparison.OrdinalIgnoreCase))
                    {
                        it.RemoveFromContainer();
                        it.Remove();
                    }
                }
            }
            catch
            {
                // ignore
            }

            if (backupUid == 0UL) return;
            var backup = FindItemByUid(p, backupUid);
            if (backup != null)
            {
                try
                {
                    backup.MoveToContainer(wear);
                }
                catch
                {
                    // ignore
                }
            }
        }

        private bool IsConfiguredStreamer(BasePlayer player)
        {
            if (player == null || string.IsNullOrWhiteSpace(_config?.StreamerName)) return false;
            return string.Equals(player.displayName, _config.StreamerName.Trim(), StringComparison.OrdinalIgnoreCase);
        }

        private void DestroyStreamerStatusTicker()
        {
            if (_streamerStatusUiTimer != null && !_streamerStatusUiTimer.Destroyed)
                _streamerStatusUiTimer.Destroy();
            _streamerStatusUiTimer = null;
        }

        private void ClearStreamerStatusUiForAllPlayers()
        {
            foreach (var p in BasePlayer.activePlayerList)
            {
                if (p == null || !p.IsConnected) continue;
                try
                {
                    CuiHelper.DestroyUi(p, StatusFxUiRoot);
                    CuiHelper.DestroyUi(p, StatusBlindRoot);
                }
                catch
                {
                    // ignore
                }
            }
        }

        private void ClearStreamerTimedStatusesAndUi(string reason, BasePlayer restoreTarget = null)
        {
            if (restoreTarget != null && restoreTarget.IsConnected && _streamerTimedStatuses.Count > 0)
            {
                foreach (var r in _streamerTimedStatuses.ToArray())
                    RestoreStreamerTimedStatusRow(restoreTarget, r);
            }

            DestroyStreamerStatusTicker();
            _streamerTimedStatuses.Clear();
            if (restoreTarget != null)
                _flippersBackupItemByUser.Remove(restoreTarget.userID);
            ClearStreamerStatusUiForAllPlayers();
            if (!string.IsNullOrEmpty(reason))
                Puts($"{LogPrefix} Cleared TikTok status effects ({reason}).");
        }

        private void EnsureStreamerStatusTicker()
        {
            if (_streamerStatusUiTimer != null && !_streamerStatusUiTimer.Destroyed) return;
            _streamerStatusUiTimer = timer.Every(0.5f, StreamerStatusUiTick);
        }

        private void StreamerStatusUiTick()
        {
            if (_streamerTimedStatuses == null || _streamerTimedStatuses.Count == 0)
            {
                DestroyStreamerStatusTicker();
                return;
            }

            var streamer = GetStreamerPlayer();
            if (streamer == null || !streamer.IsConnected || streamer.IsSleeping())
            {
                ClearStreamerTimedStatusesAndUi("streamer_offline");
                return;
            }

            float now = Time.realtimeSinceStartup;
            for (int i = _streamerTimedStatuses.Count - 1; i >= 0; i--)
            {
                var row = _streamerTimedStatuses[i];
                if (row == null || now < row.EndTime) continue;
                RestoreStreamerTimedStatusRow(streamer, row);
                _streamerTimedStatuses.RemoveAt(i);
            }

            if (_streamerTimedStatuses.Count == 0)
            {
                DestroyStreamerStatusTicker();
                ClearStreamerStatusUiForAllPlayers();
                return;
            }

            if (HasActiveStreamerStatusKind("bullethell"))
                RefillStreamerHeldWeaponAmmo(streamer);

            RebuildStreamerStatusHud(streamer);
        }

        private static string StatusKindDisplay(string kind)
        {
            switch (kind)
            {
                case "poison": return "POISONED";
                case "dehydrated": return "DEHYDRATED";
                case "hungry": return "STARVING";
                case "bleeding": return "BLEEDING";
                case "dart": return "TRANQ DART";
                case "godmode": return "TIME GOD MODE";
                case "bullethell": return "BULLET HELL";
                case "flippers": return "FLIPPERS";
                case "flash": return "FLASH";
                case "healthx3": return "HEALTH x3";
                default: return kind.ToUpperInvariant();
            }
        }

        private void RebuildStreamerStatusHud(BasePlayer player)
        {
            if (player == null || !player.IsConnected) return;
            float now = Time.realtimeSinceStartup;
            try
            {
                CuiHelper.DestroyUi(player, StatusFxUiRoot);
                CuiHelper.DestroyUi(player, StatusBlindRoot);
            }
            catch
            {
                // ignore
            }

            bool blind = false;
            var lines = new List<string>();
            foreach (var s in _streamerTimedStatuses)
            {
                if (s == null || now >= s.EndTime) continue;
                if (s.BlindOverlay) blind = true;
                int left = Mathf.Max(0, Mathf.CeilToInt(s.EndTime - now));
                string who = string.IsNullOrEmpty(s.ViewerName) ? "Viewer" : s.ViewerName;
                lines.Add($"{StatusKindDisplay(s.Kind)}  {left}s  ({who})");
            }

            if (lines.Count == 0) return;

            if (blind)
            {
                try
                {
                    var blindC = new CuiElementContainer();
                    blindC.Add(new CuiPanel
                    {
                        Image = { Color = "0.02 0.02 0.04 0.9" },
                        RectTransform = { AnchorMin = "0 0", AnchorMax = "1 1" }
                    }, "Overlay", StatusBlindRoot);
                    CuiHelper.AddUi(player, blindC);
                }
                catch
                {
                    // ignore
                }
            }

            try
            {
                var c = new CuiElementContainer();
                c.Add(new CuiPanel
                {
                    Image = { Color = "0.14 0.1 0.08 0.9" },
                    RectTransform = { AnchorMin = "0.02 0.02", AnchorMax = "0.42 0.2" }
                }, "Overlay", StatusFxUiRoot);
                c.Add(new CuiLabel
                {
                    Text =
                    {
                        Text = string.Join("\n", lines),
                        FontSize = 12,
                        Align = TextAnchor.LowerLeft,
                        Color = "1 0.88 0.55 1"
                    },
                    RectTransform = { AnchorMin = "0.04 0.08", AnchorMax = "0.96 0.94" }
                }, StatusFxUiRoot);
                CuiHelper.AddUi(player, c);
            }
            catch (Exception ex)
            {
                PrintWarning($"{LogPrefix} Status HUD CUI failed: {ex.Message}");
            }
        }

        private void RegisterStreamerTimedStatus(string kind, int durationSec, bool blindOverlay, string viewerName,
            string giftName, float healthX3OriginalMax = -1f, ulong flippersBackupItemUid = 0UL)
        {
            float now = Time.realtimeSinceStartup;
            float end = now + Mathf.Clamp(durationSec, 1, 120);
            StreamerTimedStatusRow existing = null;
            foreach (var r in _streamerTimedStatuses)
            {
                if (r != null && r.Kind == kind)
                {
                    existing = r;
                    break;
                }
            }

            if (existing != null)
            {
                existing.EndTime = Mathf.Max(existing.EndTime, end);
                existing.BlindOverlay = blindOverlay || existing.BlindOverlay;
                if (!string.IsNullOrEmpty(viewerName)) existing.ViewerName = viewerName;
                if (!string.IsNullOrEmpty(giftName)) existing.GiftName = giftName;
                if (kind == "healthx3" && healthX3OriginalMax > 0f && existing.HealthX3OriginalMax <= 0f)
                    existing.HealthX3OriginalMax = healthX3OriginalMax;
                if (kind == "flippers" && flippersBackupItemUid != 0UL && existing.FlippersBackupItemUid == 0UL)
                    existing.FlippersBackupItemUid = flippersBackupItemUid;
            }
            else
            {
                _streamerTimedStatuses.Add(new StreamerTimedStatusRow
                {
                    Kind = kind,
                    EndTime = end,
                    BlindOverlay = blindOverlay,
                    ViewerName = viewerName ?? "",
                    GiftName = giftName ?? "",
                    HealthX3OriginalMax = kind == "healthx3" ? healthX3OriginalMax : -1f,
                    FlippersBackupItemUid = kind == "flippers" ? flippersBackupItemUid : 0UL
                });
            }

            EnsureStreamerStatusTicker();
            var p = GetStreamerPlayer();
            if (p != null && p.IsConnected && !p.IsSleeping())
                RebuildStreamerStatusHud(p);
        }

        /// <summary>Undo HUD-only / special statuses when a row expires or is cleared (metabolism kinds use <see cref="RestoreStreamerStatusMetabolism"/>).</summary>
        private void RestoreStreamerTimedStatusRow(BasePlayer p, StreamerTimedStatusRow row)
        {
            if (p == null || row == null) return;
            switch (row.Kind)
            {
                case "healthx3":
                    if (row.HealthX3OriginalMax > 0f)
                    {
                        try
                        {
                            float targetMax = row.HealthX3OriginalMax;
                            float curMax = p.MaxHealth();
                            float curH = p.health;
                            float newH = curMax > 0.01f
                                ? Mathf.Clamp(curH * (targetMax / curMax), 1f, targetMax)
                                : Mathf.Min(curH, targetMax);
                            p.InitializeHealth(targetMax, newH);
                        }
                        catch (Exception ex)
                        {
                            PrintWarning($"{LogPrefix} Restore healthx3: {ex.Message}");
                        }
                    }

                    break;
                case "flippers":
                    RestoreFlippersFootwear(p, row.FlippersBackupItemUid);
                    _flippersBackupItemByUser.Remove(p.userID);
                    break;
                case "godmode":
                case "bullethell":
                case "flash":
                    break;
                default:
                    RestoreStreamerStatusMetabolism(p, row.Kind);
                    break;
            }
        }

        private void ApplyStreamerStatusMetabolism(BasePlayer p, string kind)
        {
            if (p?.metabolism == null) return;
            var m = p.metabolism;
            try
            {
                switch (kind)
                {
                    case "poison":
                    case "dart":
                        if (m.poison != null)
                            m.poison.value = Mathf.Min(m.poison.max, Mathf.Max(m.poison.value, m.poison.max * 0.82f));
                        break;
                    case "dehydrated":
                        if (m.hydration != null)
                            m.hydration.value = Mathf.Min(m.hydration.value, Mathf.Max(5f, m.hydration.max * 0.06f));
                        break;
                    case "hungry":
                        if (m.calories != null)
                            m.calories.value = Mathf.Min(m.calories.value, Mathf.Max(10f, m.calories.max * 0.06f));
                        break;
                    case "bleeding":
                        if (m.bleeding != null)
                            m.bleeding.value = Mathf.Min(m.bleeding.max, Mathf.Max(m.bleeding.value, 38f));
                        break;
                }
            }
            catch (Exception ex)
            {
                PrintWarning($"{LogPrefix} ApplyStreamerStatusMetabolism({kind}): {ex.Message}");
            }

            try
            {
                p.metabolism.SendChangesToClient();
            }
            catch
            {
                // ignore (API differs by build)
            }
        }

        private void RestoreStreamerStatusMetabolism(BasePlayer p, string kind)
        {
            if (p?.metabolism == null) return;
            var m = p.metabolism;
            try
            {
                switch (kind)
                {
                    case "poison":
                    case "dart":
                        if (m.poison != null) m.poison.value = 0f;
                        break;
                    case "dehydrated":
                        if (m.hydration != null) m.hydration.value = m.hydration.max;
                        break;
                    case "hungry":
                        if (m.calories != null) m.calories.value = m.calories.max;
                        break;
                    case "bleeding":
                        TryClearBleedMetabolismAttributes(m);
                        break;
                }
            }
            catch (Exception ex)
            {
                PrintWarning($"{LogPrefix} RestoreStreamerStatusMetabolism({kind}): {ex.Message}");
            }

            try
            {
                p.metabolism.SendChangesToClient();
            }
            catch
            {
                // ignore
            }
        }

        private string TryApplyStreamerStatusWebhook(BasePlayer target, string kind, bool blindOverlay,
            string viewerName, string giftName, Func<string, string> chatMsg, int scrapAmountArg)
        {
            if (target == null || !target.IsConnected || target.IsSleeping())
                return "FAILED: Streamer must be awake online for TikTok status effects (HUD + metabolism). Check RustChaos.json StreamerName matches their display name.";
            int durationSec = scrapAmountArg > 0 ? Mathf.Clamp(scrapAmountArg, 1, 120) : 10;
            ApplyStreamerStatusMetabolism(target, kind);
            RegisterStreamerTimedStatus(kind, durationSec, blindOverlay, viewerName, giftName);
            string label = StatusKindDisplay(kind);
            BroadcastChat(chatMsg($"{viewerName} → {target.displayName}: {label} ({durationSec}s)"));
            Puts($"{LogPrefix} TikTok status '{kind}' on {target.displayName} for {durationSec}s (viewer {viewerName}).");
            return null;
        }

        #endregion

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

            // Sleeping bag / offline body: not in activePlayerList but still valid for Steam id (e.g. bunny1npc anchor).
            foreach (var player in BasePlayer.sleepingPlayerList)
            {
                if (player == null || player.IsDestroyed || player.IsDead()) continue;
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
            position = SnapLandNpcSpawnToGround(position);
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
        /// Spawn one scientist at position. Uses prioritized candidate list and returns true if spawned.
        /// </summary>
        private static bool SpawnScientist(Vector3 position)
        {
            position = SnapLandNpcSpawnToGround(position);
            foreach (string path in SingleScientistPrefabCandidates)
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

        /// <summary>Shark gift / chaos sea: spawn + solo leash/provoke (same as land animals where NavMesh allows).</summary>
        private bool TrySpawnSharkGiftWithLeash(BasePlayer streamer, Vector3 position, string configSharkPath = null)
        {
            if (streamer == null || !streamer.IsValid()) return false;
            if (!string.IsNullOrWhiteSpace(configSharkPath))
            {
                BaseEntity entity = GameManager.server.CreateEntity(configSharkPath.Trim(), position, Quaternion.identity, true);
                if (entity != null)
                {
                    entity.Spawn();
                    RegisterSoloWildEntity(entity, streamer);
                    return true;
                }
            }
            string[] prefabs = {
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
                    RegisterSoloWildEntity(entity, streamer);
                    return true;
                }
            }
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
