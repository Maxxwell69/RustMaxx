// MaxxInvaders — RustMaxx viewer-linked NPC spawns (TikFinity / RCON / relay).
// Oxide plugin: optional RoamingNPCs bridge for full bot AI; otherwise vanilla scientists.
// Uses vanilla Scientist NPC prefabs + optional Kits. Behavior modes tune prefab + light tick steering.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Oxide.Core;
using Oxide.Core.Plugins;
using Oxide.Game.Rust.Cui;
using Rust;
using UnityEngine;
using UnityEngine.AI;
using Random = UnityEngine.Random;

namespace Oxide.Plugins
{
    [Info("MaxxInvaders", "RustMaxx", "1.4.3")]
    [Description("Viewer-linked NPCs: admin GUI (Invaders / Maxx / Roaming), RoamingNPCs bridge, RCON.")]
    public class MaxxInvaders : RustPlugin
    {
        #region Constants & permissions

        private const string PermAdmin = "maxxinvaders.admin";
        private const string PermUse = "maxxinvaders.use";
        private const string PermDebug = "maxxinvaders.debug";

        private const string LogPrefix = "[MaxxInvaders]";
        private const string DataFile = "MaxxInvaders/MaxxInvadersData";
        private const string UiName = "MaxxInvaders.AdminUI";

        private static readonly string[] BuiltinScientistPrefabFallbacks =
        {
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_roam.prefab",
            "assets/prefabs/npc/scientist/scientist.prefab",
            "assets/content/npc/scientist/scientist.prefab",
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_full_lr300.prefab",
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_heavy.prefab",
        };

        #endregion

        #region Plugin references

        [PluginReference] private Plugin Kits;

        [PluginReference] private Plugin RoamingNPCs;

        #endregion

        #region State

        private InvaderConfig _cfg;
        private InvaderDataStore _data;
        private readonly InvaderRegistry _registry = new();
        private readonly Dictionary<string, DateTime> _viewerCooldownUntil = new(StringComparer.OrdinalIgnoreCase);
        private Timer _tickTimer;
        private Timer _persistTimer;
        private bool _debugRuntime;
        private DateTime _lastRoamingSpawnFailWarnUtc;
        private string _lastRoamingSpawnFailTemplate;

        #endregion

        #region Oxide lifecycle

        private void Init()
        {
            permission.RegisterPermission(PermAdmin, this);
            permission.RegisterPermission(PermUse, this);
            permission.RegisterPermission(PermDebug, this);
            Subscribe(nameof(OnEntityTakeDamage));
        }

        private void OnServerInitialized()
        {
            LoadDataFile();
            _debugRuntime = _cfg.DebugMode;
            _tickTimer = timer.Every(Mathf.Clamp(_cfg.BehaviorTickSeconds, 0.25f, 10f), BehaviorTick);
            if (_cfg.PersistIntervalSeconds > 0)
                _persistTimer = timer.Every(_cfg.PersistIntervalSeconds, () => SaveDataFile());
        }

        private void Unload()
        {
            _tickTimer?.Destroy();
            _persistTimer?.Destroy();
            foreach (var player in BasePlayer.activePlayerList)
                CuiHelper.DestroyUi(player, UiName);

            _spawnDrafts.Clear();

            if (_cfg?.DespawnOnUnload == true)
                _registry.DespawnAll(this, "plugin_unload");
            SaveDataFile();
        }

        #endregion

        #region Config

        /// <summary>
        /// Roaming-first: set <see cref="UseRoamingNPCsWhenAvailable"/> and <see cref="DefaultRoamingTemplateKey"/> to match
        /// RoamingNPCs.json Bots keys. Viewer name is passed at spawn time (TikFinity/RCON). Scientist prefab fields are omitted
        /// from the saved JSON when <see cref="ScientistFallbackEnabled"/> is false.
        /// </summary>
        private class InvaderConfig
        {
            public bool EnablePlugin { get; set; } = true;
            public bool DebugMode { get; set; } = false;
            public int MaxActiveNPCs { get; set; } = 24;
            public bool PreventDuplicateViewerNPCs { get; set; } = true;
            public float MinimumSpawnRadiusFromAnchor { get; set; } = 20f;
            public float DefaultSpawnRadius { get; set; } = 80f;
            public float MaxDistanceFromAnchor { get; set; } = 140f;
            public float MinimumDistanceFromPlayers { get; set; } = 12f;
            public bool BlockSpawnInSafeZones { get; set; } = true;
            public bool BlockSpawnInMonuments { get; set; } = true;
            public float DefaultLifetimeSeconds { get; set; } = 3600f;
            public float PerViewerCooldownSeconds { get; set; } = 30f;
            public int SpawnAttempts { get; set; } = 36;
            public float BehaviorTickSeconds { get; set; } = 1.5f;
            public bool DespawnOnUnload { get; set; } = true;
            public float PersistIntervalSeconds { get; set; } = 60f;

            /// <summary>
            /// When true and RoamingNPCs is loaded, spawns use that plugin’s bot templates (full gather/hunt/roam AI).
            /// Falls back to vanilla scientists if the bridge fails or RoamingNPCs is missing — unless
            /// <see cref="ScientistFallbackEnabled"/> is false.
            /// </summary>
            public bool UseRoamingNPCsWhenAvailable { get; set; } = true;

            /// <summary>
            /// When false (RustMaxx default), never spawns vanilla scientists — only RoamingNPCs bridge NPCs.
            /// Set true only if you want scientists when the bridge fails or RoamingNPCs is unloaded.
            /// </summary>
            public bool ScientistFallbackEnabled { get; set; } = false;

            /// <summary>Template key under RoamingNPCs config "Bots settings" when tier has no RoamingTemplateKey.</summary>
            public string DefaultRoamingTemplateKey { get; set; } = "bob_resources_farmer";

            /// <summary>
            /// Primary prefab; if missing, ScientistPrefabFallbacks is tried in order.
            /// Old path assets/prefabs/npc/scientist/scientistnpc_roam.prefab — Facepunch moved scientists under rust.ai.
            /// </summary>
            public string DefaultScientistPrefab { get; set; } =
                "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_roam.prefab";

            public List<string> ScientistPrefabFallbacks { get; set; } = new()
            {
                "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_roam.prefab",
                "assets/prefabs/npc/scientist/scientist.prefab",
                "assets/content/npc/scientist/scientist.prefab",
                "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_full_lr300.prefab",
                "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_heavy.prefab",
            };

            public Dictionary<string, string> PrefabByBehaviorMode { get; set; } = new()
            {
                ["friendly"] = "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_roam.prefab",
                ["hostile"] = "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_roam.prefab",
                ["neutral"] = "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_roam.prefab",
                ["roaming"] = "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_roam.prefab",
                ["defend"] = "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_roam.prefab",
                ["escort"] = "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_roam.prefab",
                ["attackplayer"] = "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_roam.prefab",
            };

            public List<string> AllowedBehaviorModes { get; set; } = new()
            {
                "friendly", "hostile", "neutral", "roaming", "defend", "escort", "attackplayer"
            };

            public Dictionary<int, TierDefinition> TierDefinitions { get; set; } = new()
            {
                [1] = new TierDefinition
                {
                    DisplayName = "Scout",
                    Health = 100f,
                    DefaultKit = "",
                    DefaultBehaviorMode = "roaming",
                    LifetimeSeconds = 1800f,
                    MaxActiveForTier = 8,
                    AggressionHint = 0.2f,
                },
                [2] = new TierDefinition
                {
                    DisplayName = "Raider",
                    Health = 150f,
                    DefaultKit = "",
                    DefaultBehaviorMode = "hostile",
                    LifetimeSeconds = 2400f,
                    MaxActiveForTier = 6,
                    AggressionHint = 0.5f,
                },
                [3] = new TierDefinition
                {
                    DisplayName = "Veteran",
                    Health = 200f,
                    DefaultKit = "",
                    DefaultBehaviorMode = "attackplayer",
                    LifetimeSeconds = 3000f,
                    MaxActiveForTier = 4,
                    AggressionHint = 0.75f,
                },
                [4] = new TierDefinition
                {
                    DisplayName = "Elite",
                    Health = 275f,
                    DefaultKit = "",
                    DefaultBehaviorMode = "attackplayer",
                    LifetimeSeconds = 3600f,
                    MaxActiveForTier = 3,
                    AggressionHint = 0.9f,
                },
                [5] = new TierDefinition
                {
                    DisplayName = "Boss",
                    Health = 400f,
                    DefaultKit = "",
                    DefaultBehaviorMode = "hostile",
                    LifetimeSeconds = 7200f,
                    MaxActiveForTier = 2,
                    AggressionHint = 1f,
                },
            };

            public GuiSettings Gui { get; set; } = new();
            public LoggingSettings Logging { get; set; } = new();

            public bool ShouldSerializeDefaultScientistPrefab() => ScientistFallbackEnabled;
            public bool ShouldSerializeScientistPrefabFallbacks() => ScientistFallbackEnabled;
            public bool ShouldSerializePrefabByBehaviorMode() => ScientistFallbackEnabled;
        }

        private class TierDefinition
        {
            public string DisplayName { get; set; } = "Tier";
            public float Health { get; set; } = 150f;
            public string DefaultKit { get; set; } = "";
            public string DefaultBehaviorMode { get; set; } = "roaming";
            public float LifetimeSeconds { get; set; } = 3600f;
            public int MaxActiveForTier { get; set; } = 4;
            public float AggressionHint { get; set; } = 0.5f;

            /// <summary>RoamingNPCs bot template key; empty uses MaxxInvaders DefaultRoamingTemplateKey.</summary>
            public string RoamingTemplateKey { get; set; } = "";

            public bool ShouldSerializeDefaultKit() => !string.IsNullOrWhiteSpace(DefaultKit);
            public bool ShouldSerializeRoamingTemplateKey() => !string.IsNullOrWhiteSpace(RoamingTemplateKey);
        }

        private class GuiSettings
        {
            public int RowsPerPage { get; set; } = 8;
            public string PanelColor { get; set; } = "0.1 0.1 0.12 0.95";
            public string AccentColor { get; set; } = "0.2 0.75 0.85 0.9";
        }

        private class LoggingSettings
        {
            public bool LogSpawn { get; set; } = true;
            public bool LogCooldown { get; set; } = true;
            public bool LogDuplicate { get; set; } = true;
            public bool LogKit { get; set; } = true;
            public bool LogDeath { get; set; } = true;
            public bool LogGui { get; set; } = true;
        }

        protected override void LoadDefaultConfig()
        {
            _cfg = new InvaderConfig();
            SaveConfig();
        }

        protected override void LoadConfig()
        {
            base.LoadConfig();
            try
            {
                _cfg = Config.ReadObject<InvaderConfig>();
                if (_cfg == null) _cfg = new InvaderConfig();
            }
            catch
            {
                PrintWarning($"{LogPrefix} Config read failed; using defaults.");
                _cfg = new InvaderConfig();
            }

            EnsureConfigDefaults();
            SaveConfig();
        }

        /// <summary>Fills nested objects and tier table when using a minimal JSON (roaming-only).</summary>
        private void EnsureConfigDefaults()
        {
            var d = new InvaderConfig();
            _cfg.Gui ??= d.Gui ?? new GuiSettings();
            _cfg.Logging ??= d.Logging ?? new LoggingSettings();
            if (_cfg.AllowedBehaviorModes == null || _cfg.AllowedBehaviorModes.Count == 0)
                _cfg.AllowedBehaviorModes = new List<string>(d.AllowedBehaviorModes);
            if (_cfg.TierDefinitions == null || _cfg.TierDefinitions.Count == 0)
                _cfg.TierDefinitions = new Dictionary<int, TierDefinition>(d.TierDefinitions);
            if (string.IsNullOrWhiteSpace(_cfg.DefaultScientistPrefab))
                _cfg.DefaultScientistPrefab = d.DefaultScientistPrefab;
            if (_cfg.ScientistPrefabFallbacks == null || _cfg.ScientistPrefabFallbacks.Count == 0)
                _cfg.ScientistPrefabFallbacks = new List<string>(d.ScientistPrefabFallbacks);
            if (_cfg.PrefabByBehaviorMode == null || _cfg.PrefabByBehaviorMode.Count == 0)
                _cfg.PrefabByBehaviorMode = new Dictionary<string, string>(d.PrefabByBehaviorMode);
        }

        private void SaveConfig() => Config.WriteObject(_cfg, true);

        #endregion

        #region Data persistence

        private class InvaderDataStore
        {
            public List<InvaderRecord> History { get; set; } = new();
            public int NextNumericId { get; set; } = 1;
        }

        private class InvaderRecord
        {
            public string NpcId { get; set; }
            public string ViewerName { get; set; }
            public string ViewerId { get; set; }
            public int Tier { get; set; }
            public string KitName { get; set; }
            public string Mode { get; set; }
            public ulong EntityId { get; set; }
            public DateTime SpawnedAtUtc { get; set; }
            public DateTime? ExpiresAtUtc { get; set; }
            public bool Alive { get; set; }
            public float LastHealth { get; set; }
            public string LastPosition { get; set; }
            public string RemovalReason { get; set; }
            public DateTime? RemovedAtUtc { get; set; }
        }

        private void LoadDataFile()
        {
            try
            {
                _data = Interface.Oxide.DataFileSystem.ReadObject<InvaderDataStore>(DataFile);
                if (_data == null) _data = new InvaderDataStore();
                if (_data.History == null) _data.History = new List<InvaderRecord>();
                if (_data.NextNumericId < 1) _data.NextNumericId = 1;
            }
            catch
            {
                _data = new InvaderDataStore();
            }
        }

        private void SaveDataFile()
        {
            if (_data == null) return;
            try
            {
                Interface.Oxide.DataFileSystem.WriteObject(DataFile, _data);
            }
            catch (Exception ex)
            {
                PrintError($"{LogPrefix} Data save failed: {ex.Message}");
            }
        }

        #endregion

        #region Registry

        private sealed class InvaderRegistry
        {
            private readonly Dictionary<string, InvaderRuntime> _byViewer = new(StringComparer.Ordinal);
            private readonly Dictionary<ulong, InvaderRuntime> _byEntity = new();

            public int CountAlive => _byViewer.Count;

            public bool TryGetByViewer(string viewerId, out InvaderRuntime r) =>
                _byViewer.TryGetValue(viewerId ?? "", out r);

            public bool TryGetByEntity(ulong id, out InvaderRuntime r) => _byEntity.TryGetValue(id, out r);

            public IEnumerable<InvaderRuntime> All() => _byViewer.Values;

            public bool Register(InvaderRuntime r)
            {
                if (string.IsNullOrEmpty(r.ViewerId)) return false;
                _byViewer[r.ViewerId] = r;
                _byEntity[r.EntityId] = r;
                return true;
            }

            public void Remove(InvaderRuntime r)
            {
                if (r == null) return;
                if (!string.IsNullOrEmpty(r.ViewerId)) _byViewer.Remove(r.ViewerId);
                _byEntity.Remove(r.EntityId);
            }

            public void DespawnAll(MaxxInvaders plugin, string reason)
            {
                foreach (var copy in _byViewer.Values.ToArray())
                    plugin.DespawnInternal(copy, reason);
            }
        }

        private sealed class InvaderRuntime
        {
            public string NpcId;
            public string ViewerName;
            public string ViewerId;
            public int Tier;
            public string KitName;
            public string Mode;
            public ulong EntityId;
            /// <summary>ScientistNPC or RoamingNPCs CustomPet (BasePlayer).</summary>
            public BasePlayer NpcPlayer;
            public bool IsRoamingNpc;
            /// <summary>RoamingNPCs bot template key used for this spawn.</summary>
            public string RoamingTemplateKey = "";
            /// <summary>When true, NPC pathfinds toward <see cref="AnchorPosition"/> until within <see cref="ReturnRunArrivalMeters"/>.</summary>
            public bool ReturnRunActive;
            public Vector3 AnchorPosition;
            public DateTime SpawnedAtUtc;
            public DateTime? ExpiresAtUtc;
        }

        private const float ReturnRunArrivalMeters = 20f;

        #endregion

        #region Logging

        private void LogIf(bool enabled, string msg, bool forceDebug = false)
        {
            if (!enabled && !(forceDebug && _debugRuntime)) return;
            if (forceDebug && !_debugRuntime) return;
            Puts($"{LogPrefix} {msg}");
        }

        #endregion

        #region Spawn service

        private string ResolvePrefab(string mode)
        {
            if (_cfg.PrefabByBehaviorMode != null &&
                _cfg.PrefabByBehaviorMode.TryGetValue(mode?.ToLowerInvariant() ?? "", out var p) &&
                !string.IsNullOrEmpty(p))
                return p;
            return _cfg.DefaultScientistPrefab;
        }

        /// <summary>Tries primary prefab then ScientistPrefabFallbacks until CreateEntity returns a ScientistNPC.</summary>
        private bool TryCreateScientistNpc(
            string primaryPrefab,
            Vector3 pos,
            out ScientistNPC scientist,
            out BaseEntity createdEnt)
        {
            scientist = null;
            createdEnt = null;
            var paths = new List<string>();
            if (!string.IsNullOrWhiteSpace(primaryPrefab))
                paths.Add(primaryPrefab.Trim());
            var extra = _cfg.ScientistPrefabFallbacks;
            if (extra == null || extra.Count == 0)
                extra = new List<string>(BuiltinScientistPrefabFallbacks);
            foreach (var fb in extra)
            {
                if (string.IsNullOrWhiteSpace(fb)) continue;
                var t = fb.Trim();
                if (!paths.Contains(t)) paths.Add(t);
            }

            foreach (var path in paths)
            {
                var ent = GameManager.server.CreateEntity(path, pos, Quaternion.identity, true);
                if (ent == null) continue;
                var sci = ent as ScientistNPC;
                if (sci != null)
                {
                    scientist = sci;
                    createdEnt = ent;
                    if (_debugRuntime && path != primaryPrefab)
                        Puts($"{LogPrefix} Used fallback prefab: {path}");
                    return true;
                }
                try
                {
                    ent.Kill();
                }
                catch
                {
                    /* ignore */
                }
            }
            return false;
        }

        private bool IsBehaviorAllowed(string mode)
        {
            if (string.IsNullOrEmpty(mode)) return false;
            return _cfg.AllowedBehaviorModes.Any(x =>
                x.Equals(mode, StringComparison.OrdinalIgnoreCase));
        }

        private bool TryGetTier(int tier, out TierDefinition def)
        {
            def = null;
            return _cfg.TierDefinitions != null && _cfg.TierDefinitions.TryGetValue(tier, out def);
        }

        private int CountTierActive(int tier) =>
            _registry.All().Count(r => r.Tier == tier);

        private string ResolveRoamingTemplateKey(TierDefinition tierDef)
        {
            if (tierDef != null && !string.IsNullOrWhiteSpace(tierDef.RoamingTemplateKey))
                return tierDef.RoamingTemplateKey.Trim();
            if (!string.IsNullOrWhiteSpace(_cfg.DefaultRoamingTemplateKey))
                return _cfg.DefaultRoamingTemplateKey.Trim();
            return "bob_resources_farmer";
        }

        /// <summary>Normalize return from RoamingNPCs.Call (not always a string reference from uMod).</summary>
        private static string NormalizeBridgeCallResult(object raw)
        {
            if (raw == null) return null;
            if (raw is string s) return s;
            return Convert.ToString(raw)?.Trim();
        }

        /// <summary>Console detail when spawn bridge returns null (missing key, disabled bot, Respawn failed, etc.).</summary>
        private string ExplainRoamingBridgeFailure(string templateKey)
        {
            if (RoamingNPCs == null || !RoamingNPCs.IsLoaded)
                return "RoamingNPCs is not loaded.";
            try
            {
                var raw = RoamingNPCs.Call("IsBridgeTemplateReady", templateKey);
                var st = NormalizeBridgeCallResult(raw);
                if (string.IsNullOrEmpty(st))
                {
                    var ping = NormalizeBridgeCallResult(RoamingNPCs.Call("GetMaxxInvadersGuiSummary"));
                    if (!string.IsNullOrEmpty(ping))
                    {
                        return
                            $"IsBridgeTemplateReady returned nothing from RoamingNPCs (uMod Call issue). Template \"{templateKey}\" — check RoamingNPCs loaded once, no duplicate plugin name, then oxide.reload RoamingNPCs.";
                    }

                    return
                        "RoamingNPCs bridge API not responding (IsBridgeTemplateReady + GetMaxxInvadersGuiSummary both null). " +
                        "Use RustMaxx Integration RoamingNPCs.cs (MaxxInvadersBridgeApi region), save as oxide/plugins/RoamingNPCs.cs, then oxide.reload RoamingNPCs.";
                }

                if (st.StartsWith("error:", StringComparison.Ordinal))
                    return $"RoamingNPCs IsBridgeTemplateReady: {st.Substring("error:".Length).Trim()}";

                switch (st)
                {
                    case "ok":
                        return
                            $"Template \"{templateKey}\" is enabled but spawn returned null (RoamingNPCs Respawn threw or returned null — check server console; bridge spawns skip OnRoamingNPCSpawn as of RoamingNPCs 0.5.3).";
                    case "missing":
                        return
                            $"No bot key \"{templateKey}\" under Bots settings in oxide/config/RoamingNPCs.json — add it or change DefaultRoamingTemplateKey / tier RoamingTemplateKey.";
                    case "disabled":
                        return
                            $"Bot \"{templateKey}\" has Enable bot? false — open MaxxInvaders Roaming tab and toggle ON, or edit JSON.";
                    case "no_config":
                        return "RoamingNPCs has no Bots config (reload plugin or restore RoamingNPCs.json).";
                    default:
                        return $"Bridge status: {st}";
                }
            }
            catch (Exception ex)
            {
                return $"Could not query IsBridgeTemplateReady: {ex.Message}";
            }
        }

        private void WarnRoamingOnlyFailedThrottled(string roamingTemplate, string detail)
        {
            var now = DateTime.UtcNow;
            if ((now - _lastRoamingSpawnFailWarnUtc).TotalSeconds < 60d &&
                string.Equals(_lastRoamingSpawnFailTemplate, roamingTemplate, StringComparison.Ordinal))
                return;
            _lastRoamingSpawnFailWarnUtc = now;
            _lastRoamingSpawnFailTemplate = roamingTemplate;
            PrintWarning($"{LogPrefix} No spawn: ScientistFallbackEnabled=false. {detail}");
        }

        /// <summary>Multi-line status for admin GUI: RoamingNPCs load + default template key readiness.</summary>
        private string BuildRoamingGuiStatusText()
        {
            var key = string.IsNullOrWhiteSpace(_cfg.DefaultRoamingTemplateKey)
                ? "bob_resources_farmer"
                : _cfg.DefaultRoamingTemplateKey.Trim();

            if (!_cfg.UseRoamingNPCsWhenAvailable)
            {
                return "Roaming bridge: OFF (config) — spawns use vanilla scientists.\n" +
                       "Set UseRoamingNPCsWhenAvailable true + install RoamingNPCs for bot AI.";
            }

            if (RoamingNPCs == null || !RoamingNPCs.IsLoaded)
            {
                return "Roaming bridge: ON but RoamingNPCs is not loaded.\n" +
                       "Copy RoamingNPCs.cs to oxide/plugins and reload.";
            }

            object st = null;
            try
            {
                st = RoamingNPCs.Call("IsBridgeTemplateReady", key);
            }
            catch
            {
                /* older RoamingNPCs without API */
            }

            var code = NormalizeBridgeCallResult(st) ?? "";
            string detail;
            switch (code)
            {
                case "ok":
                    detail = $"Template OK: \"{key}\" — viewer spawns use RoamingNPCs AI (gather/roam/etc.).";
                    break;
                case "missing":
                    detail =
                        $"No bot key \"{key}\" in oxide/config/RoamingNPCs.json under Bots settings. Add it or fix DefaultRoamingTemplateKey.";
                    break;
                case "disabled":
                    detail =
                        $"Bot \"{key}\" exists but is disabled. Set \"Enable bot?\" true for that bot in RoamingNPCs config.";
                    break;
                case "no_config":
                    detail = "RoamingNPCs has no Bots config loaded. Reload RoamingNPCs or restore RoamingNPCs.json.";
                    break;
                default:
                    if (code.StartsWith("error:", StringComparison.Ordinal))
                        detail = $"IsBridgeTemplateReady: {code.Substring("error:".Length).Trim()}";
                    else if (string.IsNullOrEmpty(code))
                        detail =
                            "Could not verify template (Call returned null — redeploy RustMaxx RoamingNPCs.cs, oxide.reload RoamingNPCs). Spawns may still work.";
                    else
                        detail =
                            $"Unexpected bridge code: {code}. Spawns may still work.";
                    break;
            }

            var fb = _cfg.ScientistFallbackEnabled ? "scientist fallback ON" : "scientist fallback OFF (roaming only)";
            return $"Roaming bridge: ON  |  Template: {key}  |  {fb}\n{detail}\n" +
                   "Tip: per-tier RoamingTemplateKey in MaxxInvaders.json overrides the default.";
        }

        private SpawnResult TrySpawn(
            string viewerName,
            string viewerId,
            int tier,
            string kitName,
            string mode,
            BasePlayer anchorPlayer,
            string source,
            string roamingTemplateOverride = null)
        {
            if (!_cfg.EnablePlugin)
                return SpawnResult.Fail("plugin_disabled");

            if (string.IsNullOrWhiteSpace(viewerName) || string.IsNullOrWhiteSpace(viewerId))
                return SpawnResult.Fail("missing_viewer");

            if (!IsBehaviorAllowed(mode))
                return SpawnResult.Fail("invalid_mode");

            if (!TryGetTier(tier, out var tierDef))
                return SpawnResult.Fail("invalid_tier");

            if (_registry.CountAlive >= _cfg.MaxActiveNPCs)
                return SpawnResult.Fail("global_cap");

            if (CountTierActive(tier) >= tierDef.MaxActiveForTier)
                return SpawnResult.Fail("tier_cap");

            if (_cfg.PreventDuplicateViewerNPCs && _registry.TryGetByViewer(viewerId, out _))
            {
                LogIf(_cfg.Logging.LogDuplicate, $"blocked duplicate viewerId={viewerId}", false);
                return SpawnResult.Fail("duplicate_viewer");
            }

            if (_cfg.PerViewerCooldownSeconds > 0 &&
                _viewerCooldownUntil.TryGetValue(viewerId, out var until) &&
                DateTime.UtcNow < until)
            {
                LogIf(_cfg.Logging.LogCooldown, $"cooldown viewerId={viewerId} until={until:o}", false);
                return SpawnResult.Fail("cooldown");
            }

            var kitResolved = string.IsNullOrWhiteSpace(kitName) ? tierDef.DefaultKit : kitName;
            var lifetime = tierDef.LifetimeSeconds > 0 ? tierDef.LifetimeSeconds : _cfg.DefaultLifetimeSeconds;

            if (!TryFindSpawnPosition(anchorPlayer, out var pos))
                return SpawnResult.Fail("spawn_position");

            BasePlayer npcPlayer = null;
            var isRoaming = false;
            var roamingTemplate = string.IsNullOrWhiteSpace(roamingTemplateOverride)
                ? ResolveRoamingTemplateKey(tierDef)
                : roamingTemplateOverride.Trim();

            if (_cfg.UseRoamingNPCsWhenAvailable && RoamingNPCs != null && RoamingNPCs.IsLoaded &&
                !string.IsNullOrEmpty(roamingTemplate))
            {
                try
                {
                    var ro = RoamingNPCs.Call("SpawnFromTemplateForBridge", roamingTemplate, viewerName, viewerId);
                    npcPlayer = ro as BasePlayer;
                    if (npcPlayer != null && !npcPlayer.IsDestroyed)
                    {
                        isRoaming = true;
                        var teleportPos = pos;
                        if (ResolveNavMeshPosition(pos, out var snapped))
                            teleportPos = snapped;
                        try
                        {
                            npcPlayer.Teleport(teleportPos);
                            if (ResolveNavMeshPosition(npcPlayer.transform.position, out var after))
                                npcPlayer.Teleport(after);
                        }
                        catch
                        {
                            /* ignored */
                        }

                        var captured = npcPlayer;
                        var capPos = teleportPos;
                        timer.Once(0.2f, () =>
                        {
                            try
                            {
                                if (captured == null || captured.IsDestroyed) return;
                                captured.Teleport(capPos);
                                if (ResolveNavMeshPosition(captured.transform.position, out var after2))
                                    captured.Teleport(after2);
                            }
                            catch
                            {
                                /* ignored */
                            }
                        });
                    }
                    else
                    {
                        npcPlayer = null;
                    }
                }
                catch (Exception ex)
                {
                    PrintWarning($"{LogPrefix} RoamingNPCs SpawnFromTemplateForBridge: {ex.Message}");
                    npcPlayer = null;
                }
            }

            if (npcPlayer == null)
            {
                if (!_cfg.ScientistFallbackEnabled)
                {
                    if (!_cfg.UseRoamingNPCsWhenAvailable)
                        PrintWarning(
                            $"{LogPrefix} No spawn: ScientistFallbackEnabled=false and UseRoamingNPCsWhenAvailable=false (invalid config).");
                    else if (RoamingNPCs == null || !RoamingNPCs.IsLoaded)
                        WarnRoamingOnlyFailedThrottled(roamingTemplate,
                            "RoamingNPCs is not loaded.");
                    else
                    {
                        var detail = ExplainRoamingBridgeFailure(roamingTemplate);
                        WarnRoamingOnlyFailedThrottled(roamingTemplate, detail);
                        return SpawnResult.Fail("roaming_only_failed", detail);
                    }
                    return SpawnResult.Fail("roaming_only_failed");
                }

                var prefab = ResolvePrefab(mode);
                if (!TryCreateScientistNpc(prefab, pos, out var scientist, out var ent))
                {
                    ent?.Kill();
                    PrintWarning(
                        $"{LogPrefix} No scientist prefab worked (primary={prefab}). Check ScientistPrefabFallbacks / Rust update.");
                    return SpawnResult.Fail("prefab_invalid");
                }

                scientist.enableSaving = false;
                scientist.displayName = $"[Invader] {viewerName}";
                if (ResolveNavMeshPosition(scientist.transform.position, out var sciSnap))
                    scientist.transform.position = sciSnap;
                scientist.Spawn();

                var hpSci = tierDef.Health > 0 ? tierDef.Health : 100f;
                scientist.InitializeHealth(hpSci, hpSci);
                npcPlayer = scientist;
                isRoaming = false;
            }
            else
            {
                var hpR = tierDef.Health > 0 ? tierDef.Health : 100f;
                try
                {
                    npcPlayer.InitializeHealth(hpR, hpR);
                }
                catch
                {
                    /* ignored */
                }
            }

            var npcId = NextNpcId();
            var netId = npcPlayer.net.ID.Value;

            var runtime = new InvaderRuntime
            {
                NpcId = npcId,
                ViewerName = viewerName.Trim(),
                ViewerId = viewerId.Trim(),
                Tier = tier,
                KitName = kitResolved ?? "",
                Mode = mode.ToLowerInvariant(),
                EntityId = netId,
                NpcPlayer = npcPlayer,
                IsRoamingNpc = isRoaming,
                RoamingTemplateKey = roamingTemplate ?? "",
                AnchorPosition = pos,
                SpawnedAtUtc = DateTime.UtcNow,
                ExpiresAtUtc = lifetime > 0 ? DateTime.UtcNow.AddSeconds(lifetime) : null,
            };

            _registry.Register(runtime);

            if (_cfg.PerViewerCooldownSeconds > 0)
                _viewerCooldownUntil[viewerId] = DateTime.UtcNow.AddSeconds(_cfg.PerViewerCooldownSeconds);

            if (!isRoaming)
                ApplyKitIfPossible(npcPlayer, kitResolved, viewerId);

            var record = new InvaderRecord
            {
                NpcId = npcId,
                ViewerName = runtime.ViewerName,
                ViewerId = runtime.ViewerId,
                Tier = tier,
                KitName = kitResolved ?? "",
                Mode = runtime.Mode,
                EntityId = netId,
                SpawnedAtUtc = runtime.SpawnedAtUtc,
                ExpiresAtUtc = runtime.ExpiresAtUtc,
                Alive = true,
                LastHealth = npcPlayer.health,
                LastPosition = npcPlayer.transform.position.ToString(),
            };
            _data.History.Add(record);
            TrimHistory();

            LogIf(_cfg.Logging.LogSpawn,
                $"spawned npc={npcId} viewer={viewerName} id={viewerId} tier={tier} mode={mode} roaming={isRoaming} template={roamingTemplate} kit={kitResolved} src={source}",
                false);

            return SpawnResult.Ok(npcId, netId);
        }

        private sealed class SpawnResult
        {
            public bool Success;
            public string Error;
            public string ErrorDetail;
            public string NpcId;
            public ulong EntityId;

            public static SpawnResult Ok(string npcId, ulong entityId) =>
                new() { Success = true, NpcId = npcId, EntityId = entityId };

            public static SpawnResult Fail(string err, string detail = null) =>
                new() { Success = false, Error = err, ErrorDetail = detail };
        }

        private string NextNpcId()
        {
            var n = _data.NextNumericId++;
            return $"INV-{n:D5}";
        }

        private void TrimHistory()
        {
            const int max = 2000;
            if (_data.History.Count <= max) return;
            _data.History.RemoveRange(0, _data.History.Count - max);
        }

        /// <summary>
        /// Snaps a world position onto walkable NavMesh. Terrain height alone is often a few meters off the mesh,
        /// which triggers "Failed to create agent because it is not close enough to the NavMesh" on NPC spawn.
        /// </summary>
        private static readonly float[] NavMeshResolveRadii = { 4f, 8f, 12f, 16f, 22f, 28f };

        private static bool ResolveNavMeshPosition(Vector3 approximate, out Vector3 onMesh, float maxSearch = 28f)
        {
            onMesh = approximate;
            foreach (var r in NavMeshResolveRadii)
            {
                if (r > maxSearch) break;
                if (NavMesh.SamplePosition(approximate, out var hit, r, NavMesh.AllAreas))
                {
                    onMesh = hit.position;
                    return true;
                }
            }

            return false;
        }

        private bool TryFindSpawnPosition(BasePlayer anchorPlayer, out Vector3 pos)
        {
            pos = default;
            var anchor = anchorPlayer != null && anchorPlayer.IsValid()
                ? anchorPlayer.transform.position
                : GetWorldAnchor();

            for (var i = 0; i < _cfg.SpawnAttempts; i++)
            {
                var flat = Random.insideUnitSphere;
                flat.y = 0;
                flat.Normalize();
                var minRadius = Mathf.Clamp(_cfg.MinimumSpawnRadiusFromAnchor, 0f, _cfg.DefaultSpawnRadius);
                var maxRadius = Mathf.Max(minRadius + 0.1f, _cfg.DefaultSpawnRadius);
                var tryPos = anchor + flat * Random.Range(minRadius, maxRadius);
                tryPos.y = TerrainMeta.HeightMap.GetHeight(tryPos);

                if (_cfg.BlockSpawnInMonuments && InMonumentArea(tryPos)) continue;
                if (_cfg.BlockSpawnInSafeZones && InSafeZone(tryPos)) continue;
                if (WaterLevel.Test(tryPos, true, true)) continue;
                if (!ResolveNavMeshPosition(tryPos, out tryPos)) continue;

                if (TooCloseToPlayers(tryPos, _cfg.MinimumDistanceFromPlayers)) continue;

                pos = tryPos;
                return true;
            }

            return false;
        }

        private static Vector3 GetWorldAnchor()
        {
            var p = BasePlayer.activePlayerList.FirstOrDefault();
            return p != null ? p.transform.position : Vector3.zero;
        }

        private static bool TooCloseToPlayers(Vector3 pos, float minDist)
        {
            var sq = minDist * minDist;
            foreach (var pl in BasePlayer.activePlayerList)
            {
                if (pl == null || !pl.IsValid() || pl.IsNpc) continue;
                if ((pl.transform.position - pos).sqrMagnitude < sq) return true;
            }
            return false;
        }

        private static bool InMonumentArea(Vector3 pos)
        {
            // Layer 21 "Prevent Building" — common monument blocker (same idea as RoamingNPCs spawn checks).
            return Physics.OverlapSphere(pos, 18f, LayerMask.GetMask("Prevent Building", "Construction")).Length > 0;
        }

        private static bool InSafeZone(Vector3 pos)
        {
            // Broad overlap; filter to TriggerSafeZone (compatible across builds without Rust.Layer.*).
            var colliders = Physics.OverlapSphere(pos, 25f);
            foreach (var c in colliders)
            {
                if (c == null) continue;
                if (c.GetComponentInParent<TriggerSafeZone>() != null) return true;
            }
            return false;
        }

        private void ApplyKitIfPossible(BasePlayer npc, string kitName, string viewerIdForLog)
        {
            if (string.IsNullOrWhiteSpace(kitName) || Kits == null || !Kits.IsLoaded)
            {
                LogIf(_cfg.Logging.LogKit, $"kit skip (missing name or Kits) viewer={viewerIdForLog}", true);
                return;
            }

            try
            {
                var result = Kits.Call("GiveKit", npc, kitName);
                if (result is bool b && !b)
                    PrintWarning($"{LogPrefix} Kits returned false for kit={kitName}");
                LogIf(_cfg.Logging.LogKit, $"kit applied kit={kitName} viewer={viewerIdForLog}", false);
            }
            catch (Exception ex)
            {
                PrintWarning($"{LogPrefix} Kits GiveKit failed: {ex.Message}");
            }
        }

        #endregion

        #region Behavior tick (lightweight; full AI is engine-owned)

        /// <summary>
        /// Vanilla scientists still run combat AI. Only <c>hostile</c> and <c>attackplayer</c> may damage players.
        /// </summary>
        private static bool ModeAllowsDamageToPlayers(string mode)
        {
            if (string.IsNullOrEmpty(mode)) return false;
            var m = mode.ToLowerInvariant();
            return m == "hostile" || m == "attackplayer";
        }

        /// <summary>Block invader NPC damage to real players when mode is not explicitly hostile.</summary>
        private object OnEntityTakeDamage(BaseCombatEntity entity, HitInfo info)
        {
            if (entity == null || info == null) return null;
            var victim = entity as BasePlayer;
            if (victim == null || victim.IsNpc) return null;
            var attacker = info.Initiator as BasePlayer;
            if (attacker == null || !attacker.IsNpc) return null;
            if (!_registry.TryGetByEntity(attacker.net.ID.Value, out var r)) return null;
            if (ModeAllowsDamageToPlayers(r.Mode)) return null;
            return true;
        }

        private void BehaviorTick()
        {
            foreach (var r in _registry.All().ToArray())
            {
                if (r.NpcPlayer == null || r.NpcPlayer.IsDestroyed)
                {
                    HandleDeadOrMissing(r, "entity_gone");
                    continue;
                }

                if (r.ExpiresAtUtc.HasValue && DateTime.UtcNow >= r.ExpiresAtUtc.Value)
                {
                    DespawnInternal(r, "lifetime_expired");
                    continue;
                }

                r.NpcPlayer.health = Mathf.Clamp(r.NpcPlayer.health, 0f, r.NpcPlayer.MaxHealth());
                var pos = r.NpcPlayer.transform.position;
                UpdateRecordPosition(r.EntityId, pos, r.NpcPlayer.health);

                // Run back toward streamer anchor (GUI "Return") — pathfind until within 20m, no teleport.
                if (r.ReturnRunActive && r.AnchorPosition != Vector3.zero)
                {
                    var distToAnchor = Vector3.Distance(pos, r.AnchorPosition);
                    if (distToAnchor > ReturnRunArrivalMeters)
                    {
                        TrySetDestinationBasePlayer(r.NpcPlayer, r.AnchorPosition);
                        continue;
                    }

                    r.ReturnRunActive = false;
                }

                // Keep NPCs inside streamer-centered radius (anchor set at spawn point).
                if (_cfg.MaxDistanceFromAnchor > 5f)
                {
                    var anchor = r.AnchorPosition;
                    if (anchor != Vector3.zero && Vector3.Distance(pos, anchor) > _cfg.MaxDistanceFromAnchor)
                    {
                        var back = anchor + Random.insideUnitSphere.Flatten() * Mathf.Min(12f, _cfg.MaxDistanceFromAnchor * 0.2f);
                        back.y = TerrainMeta.HeightMap.GetHeight(back);
                        if (ResolveNavMeshPosition(back, out var onMesh))
                            back = onMesh;
                        try
                        {
                            r.NpcPlayer.Teleport(back);
                        }
                        catch
                        {
                            /* ignored */
                        }
                        pos = r.NpcPlayer.transform.position;
                        UpdateRecordPosition(r.EntityId, pos, r.NpcPlayer.health);
                    }
                }

                if (r.IsRoamingNpc)
                    continue;

                var sci = r.NpcPlayer as ScientistNPC;
                if (sci == null) continue;

                switch (r.Mode)
                {
                    case "defend":
                        TrySetDestination(sci, sci.transform.position);
                        break;
                    case "attackplayer":
                    case "hostile":
                        SteerTowardNearestPlayer(sci, 80f, true);
                        break;
                    case "escort":
                        SteerTowardNearestAdmin(sci, 12f);
                        break;
                    case "friendly":
                    case "neutral":
                    case "roaming":
                    default:
                        SteerAwayFromNearestPlayer(sci, 55f, 22f);
                        SteerRandomRoam(sci, 36f, 0.42f);
                        break;
                }
            }
        }

        /// <summary>Move away from the nearest real player (passive modes).</summary>
        private void SteerAwayFromNearestPlayer(ScientistNPC npc, float scareRadius, float fleeDistance)
        {
            if (npc == null || Random.value > 0.45f) return;
            BasePlayer nearest = null;
            var best = scareRadius * scareRadius;
            var o = npc.transform.position;
            foreach (var p in BasePlayer.activePlayerList)
            {
                if (p == null || !p.IsValid() || p.IsNpc) continue;
                var d = (p.transform.position - o).sqrMagnitude;
                if (d < best)
                {
                    best = d;
                    nearest = p;
                }
            }
            if (nearest == null) return;
            var away = (o - nearest.transform.position).Flatten();
            if (away.sqrMagnitude < 0.01f)
                away = Random.insideUnitSphere.Flatten();
            away.Normalize();
            var target = o + away * fleeDistance;
            target.y = TerrainMeta.HeightMap.GetHeight(target);
            if (ResolveNavMeshPosition(target, out var onMesh))
                target = onMesh;
            TrySetDestination(npc, target);
        }

        private void SteerRandomRoam(ScientistNPC npc, float radius, float chance = 0.15f)
        {
            if (npc == null || Random.value > chance) return;
            var origin = npc.transform.position;
            var target = origin + Random.insideUnitSphere.Flatten() * radius;
            target.y = TerrainMeta.HeightMap.GetHeight(target);
            if (ResolveNavMeshPosition(target, out var onMesh))
                target = onMesh;
            TrySetDestination(npc, target);
        }

        private void SteerTowardNearestPlayer(ScientistNPC npc, float range, bool aggressive)
        {
            BasePlayer best = null;
            var bestD = range * range;
            var o = npc.transform.position;
            foreach (var p in BasePlayer.activePlayerList)
            {
                if (p == null || !p.IsValid() || p.IsNpc || p.IsSleeping()) continue;
                var d = (p.transform.position - o).sqrMagnitude;
                if (d < bestD)
                {
                    bestD = d;
                    best = p;
                }
            }
            if (best != null)
            {
                var dest = best.transform.position;
                if (ResolveNavMeshPosition(dest, out var onMesh))
                    dest = onMesh;
                TrySetDestination(npc, dest);
            }
        }

        private void SteerTowardNearestAdmin(ScientistNPC npc, float range)
        {
            BasePlayer best = null;
            var bestD = range * range;
            var o = npc.transform.position;
            foreach (var p in BasePlayer.activePlayerList)
            {
                if (p == null || !p.IsValid() || p.IsNpc) continue;
                if (!p.IsAdmin) continue;
                var d = (p.transform.position - o).sqrMagnitude;
                if (d < bestD)
                {
                    bestD = d;
                    best = p;
                }
            }
            if (best != null)
            {
                var dest = best.transform.position;
                if (ResolveNavMeshPosition(dest, out var onMesh))
                    dest = onMesh;
                TrySetDestination(npc, dest);
            }
        }

        private static void TrySetDestination(ScientistNPC npc, Vector3 worldPos)
        {
            TrySetDestinationBasePlayer(npc, worldPos);
        }

        /// <summary>Roaming bridge NPCs and scientists: steer on NavMesh when possible.</summary>
        private static void TrySetDestinationBasePlayer(BasePlayer bp, Vector3 worldPos)
        {
            if (bp == null || bp.IsDestroyed) return;
            try
            {
                var agent = bp.GetComponent<NavMeshAgent>();
                if (agent == null || !agent.isOnNavMesh) return;
                if (!ResolveNavMeshPosition(worldPos, out var dest))
                    return;
                agent.SetDestination(dest);
            }
            catch
            {
                /* NavMesh steering is best-effort */
            }
        }

        private void UpdateRecordPosition(ulong entityId, Vector3 pos, float health)
        {
            var rec = _data.History.LastOrDefault(x => x.EntityId == entityId && x.Alive);
            if (rec == null) return;
            rec.LastPosition = $"{pos.x:F1},{pos.y:F1},{pos.z:F1}";
            rec.LastHealth = health;
        }

        #endregion

        #region Death / cleanup

        private void OnEntityDeath(BaseCombatEntity entity, HitInfo info)
        {
            var bp = entity as BasePlayer;
            if (bp == null || !bp.IsNpc) return;
            if (!_registry.TryGetByEntity(bp.net.ID.Value, out var r)) return;

            var reason = info?.Initiator != null ? "killed" : "death";
            FinalizeRecord(r, false, reason);
            _registry.Remove(r);
            LogIf(_cfg.Logging.LogDeath, $"death npc={r.NpcId} viewer={r.ViewerId} reason={reason}", false);
        }

        private void HandleDeadOrMissing(InvaderRuntime r, string reason)
        {
            FinalizeRecord(r, false, reason);
            _registry.Remove(r);
        }

        private void FinalizeRecord(InvaderRuntime r, bool alive, string reason)
        {
            var rec = _data.History.LastOrDefault(x => x.NpcId == r.NpcId);
            if (rec != null)
            {
                rec.Alive = alive;
                rec.RemovalReason = reason;
                rec.RemovedAtUtc = DateTime.UtcNow;
                if (r.NpcPlayer != null && !r.NpcPlayer.IsDestroyed)
                    rec.LastHealth = r.NpcPlayer.health;
            }
        }

        private void DespawnInternal(InvaderRuntime r, string reason)
        {
            try
            {
                if (r.NpcPlayer != null && !r.NpcPlayer.IsDestroyed)
                    r.NpcPlayer.Kill();
            }
            catch
            {
                // ignored
            }

            FinalizeRecord(r, false, reason);
            _registry.Remove(r);
            LogIf(_cfg.Logging.LogDeath, $"despawn npc={r.NpcId} reason={reason}", false);
            SaveDataFile();
        }

        private void SetGuiNpcTemplateField(ulong userId, string npcId, string value)
        {
            if (!_guiNpcTemplateField.TryGetValue(userId, out var d))
            {
                d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                _guiNpcTemplateField[userId] = d;
            }

            d[npcId] = value ?? "";
        }

        private string GetGuiNpcTemplateField(ulong userId, string npcId, string fallback)
        {
            if (_guiNpcTemplateField.TryGetValue(userId, out var d) &&
                d.TryGetValue(npcId, out var v) &&
                !string.IsNullOrWhiteSpace(v))
                return v.Trim();
            return fallback ?? "";
        }

        /// <summary>Despawn roaming invader and respawn with a different RoamingNPCs bot template key.</summary>
        private bool TryRespawnWithRoamingTemplate(
            BasePlayer admin,
            string npcIdToken,
            string newTemplateKey,
            out string error)
        {
            error = null;
            if (string.IsNullOrWhiteSpace(newTemplateKey))
            {
                error = "Enter a template key.";
                return false;
            }

            newTemplateKey = newTemplateKey.Trim();
            if (!TryFindInvader(npcIdToken, out var r))
            {
                error = "NPC not found.";
                return false;
            }

            if (!r.IsRoamingNpc)
            {
                error = "Template swap applies to RoamingNPCs bots only (not scientist fallback).";
                return false;
            }

            if (!_cfg.UseRoamingNPCsWhenAvailable || RoamingNPCs == null || !RoamingNPCs.IsLoaded)
            {
                error = "RoamingNPCs is not loaded or bridge is off.";
                return false;
            }

            var vn = r.ViewerName;
            var vid = r.ViewerId;
            var tier = r.Tier;
            var kit = r.KitName ?? "";
            var mode = r.Mode ?? "roaming";

            _viewerCooldownUntil.Remove(vid);
            DespawnInternal(r, "gui_roaming_template_change");
            var res = TrySpawn(vn, vid, tier, kit, mode, admin, "gui_roaming_template_change", newTemplateKey);
            if (res.Success) return true;
            error = string.IsNullOrEmpty(res.ErrorDetail) ? res.Error ?? "spawn_failed" : res.ErrorDetail;
            return false;
        }

        #endregion

        #region Console commands

        [ConsoleCommand("maxxinvaders.spawn")]
        private void CmdConsoleSpawn(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null)
            {
                arg.ReplyWith("Run from server console or RCON only.");
                return;
            }

            var parts = ParseQuotedArgs(arg);
            if (parts.Count < 5)
            {
                arg.ReplyWith(
                    "Usage: maxxinvaders.spawn <viewerName> <viewerId> <tier> <kitName|-> <mode>");
                return;
            }

            var viewerName = parts[0];
            var viewerId = parts[1];
            if (!int.TryParse(parts[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out var tier))
            {
                arg.ReplyWith("Invalid tier.");
                return;
            }

            var kit = parts[3] == "-" ? "" : parts[3];
            var mode = parts[4].ToLowerInvariant();

            var result = TrySpawn(viewerName, viewerId, tier, kit, mode, null, "console");
            if (!result.Success)
            {
                if (!string.IsNullOrWhiteSpace(result.ErrorDetail))
                    arg.ReplyWith($"Error: {result.Error} | {result.ErrorDetail}");
                else
                    arg.ReplyWith($"Error: {result.Error}");
                return;
            }

            arg.ReplyWith($"OK npcId={result.NpcId} entity={result.EntityId}");
        }

        [ConsoleCommand("maxxinvaders.upgrade")]
        private void CmdConsoleUpgrade(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null)
            {
                arg.ReplyWith("Run from server console or RCON only.");
                return;
            }

            var parts = ParseQuotedArgs(arg);
            if (parts.Count < 2)
            {
                arg.ReplyWith("Usage: maxxinvaders.upgrade <viewerId> <newTier>");
                return;
            }

            if (!int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var newTier))
            {
                arg.ReplyWith("Invalid tier.");
                return;
            }

            if (!_registry.TryGetByViewer(parts[0], out var r))
            {
                arg.ReplyWith("No active invader for that viewer.");
                return;
            }

            if (!TryGetTier(newTier, out var def))
            {
                arg.ReplyWith("Invalid tier definition.");
                return;
            }

            r.Tier = newTier;
            if (r.NpcPlayer != null && !r.NpcPlayer.IsDestroyed)
            {
                r.NpcPlayer.InitializeHealth(def.Health, def.Health);
            }

            LogIf(true, $"upgrade viewer={r.ViewerId} tier={newTier}", false);
            arg.ReplyWith("OK");
        }

        [ConsoleCommand("maxxinvaders.remove")]
        private void CmdConsoleRemove(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null)
            {
                arg.ReplyWith("Run from server console or RCON only.");
                return;
            }

            var parts = ParseQuotedArgs(arg);
            if (parts.Count < 1)
            {
                arg.ReplyWith("Usage: maxxinvaders.remove <viewerId>");
                return;
            }

            if (!_registry.TryGetByViewer(parts[0], out var r))
            {
                arg.ReplyWith("Not found.");
                return;
            }

            DespawnInternal(r, "console_remove");
            arg.ReplyWith("OK");
        }

        [ConsoleCommand("maxxinvaders.rename")]
        private void CmdConsoleRename(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null)
            {
                arg.ReplyWith("Run from server console or RCON only.");
                return;
            }

            var parts = ParseQuotedArgs(arg);
            if (parts.Count < 2)
            {
                arg.ReplyWith("Usage: maxxinvaders.rename <viewerId|npcId> <newName>");
                return;
            }

            var key = parts[0];
            var newName = string.Join(" ", parts.Skip(1));
            if (!RenameInvaderInternal(key, newName, out var err))
            {
                arg.ReplyWith($"Rename failed: {err}");
                return;
            }

            arg.ReplyWith("OK");
        }

        [ConsoleCommand("maxxinvaders.clearall")]
        private void CmdConsoleClearAll(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null)
            {
                arg.ReplyWith("Run from server console or RCON only.");
                return;
            }

            _registry.DespawnAll(this, "console_clearall");
            arg.ReplyWith("OK");
        }

        private static List<string> ParseQuotedArgs(ConsoleSystem.Arg arg)
        {
            string line = null;
            try
            {
                line = arg.FullString;
            }
            catch
            {
                /* older builds */
            }

            if (string.IsNullOrEmpty(line) && arg.cmd != null)
                line = $"{arg.cmd.FullName} {string.Join(" ", arg.Args ?? Array.Empty<string>())}";

            if (string.IsNullOrEmpty(line))
                return arg.Args?.ToList() ?? new List<string>();

            var cmd = arg.cmd?.FullName ?? "";
            if (!string.IsNullOrEmpty(cmd) &&
                line.StartsWith(cmd, StringComparison.OrdinalIgnoreCase))
                line = line.Substring(cmd.Length).TrimStart();
            else
                line = string.Join(" ", arg.Args ?? Array.Empty<string>());

            return SplitQuoted(line);
        }

        private static List<string> SplitQuoted(string input)
        {
            var list = new List<string>();
            var sb = new StringBuilder();
            var inQ = false;
            for (var i = 0; i < input.Length; i++)
            {
                var c = input[i];
                if (c == '"')
                {
                    inQ = !inQ;
                    continue;
                }
                if (!inQ && char.IsWhiteSpace(c))
                {
                    if (sb.Length > 0)
                    {
                        list.Add(sb.ToString());
                        sb.Clear();
                    }
                    continue;
                }
                sb.Append(c);
            }
            if (sb.Length > 0) list.Add(sb.ToString());
            return list;
        }

        #endregion

        #region Chat commands

        [ChatCommand("maxxinvaders")]
        private void ChatRouter(BasePlayer player, string command, string[] args)
        {
            if (player == null) return;
            if (args == null || args.Length == 0)
            {
                player.ChatMessage(
                    "Usage: /mi ui | /migrate-to-skills (Maxx config) | /maxxinvaders ui | maxx | roaming | list | spawn | rename | kill | …");
                return;
            }

            var sub = args[0].ToLowerInvariant();
            switch (sub)
            {
                case "ui":
                    if (!CanAdmin(player)) return;
                    OpenGui(player, 0);
                    break;
                case "setup":
                case "config":
                case "maxx":
                    if (!CanAdmin(player)) return;
                    _guiMainTab[player.userID] = GuiTabMaxxEdit;
                    OpenGui(player, 0);
                    break;
                case "roaming":
                    if (!CanAdmin(player)) return;
                    _guiMainTab[player.userID] = GuiTabRoamingEdit;
                    OpenGui(player, 0);
                    break;
                case "list":
                    if (!CanUse(player)) return;
                    ChatList(player);
                    break;
                case "version":
                    player.ChatMessage($"MaxxInvaders v{Version}");
                    break;
                case "spawn":
                    if (!CanAdmin(player)) return;
                    if (args.Length < 3)
                    {
                        player.ChatMessage("Usage: /maxxinvaders spawn <viewerName> <tier>");
                        return;
                    }
                    if (!int.TryParse(args[^1], out var tier))
                    {
                        player.ChatMessage("Invalid tier.");
                        return;
                    }
                    var name = string.Join(" ", args.Skip(1).Take(args.Length - 2));
                    var fakeId = $"chat_{name.GetHashCode():X}";
                    var res = TrySpawn(name, fakeId, tier, "", "roaming", player, "chat");
                    player.ChatMessage(res.Success ? $"Spawned {res.NpcId}" : $"Failed: {res.Error}");
                    break;
                case "kill":
                case "despawn":
                    if (!CanAdmin(player)) return;
                    if (args.Length < 2)
                    {
                        player.ChatMessage("Usage: /maxxinvaders kill <npcId>");
                        return;
                    }
                    KillByNpcId(args[1], sub == "despawn");
                    player.ChatMessage("Done (see console if not found).");
                    break;
                case "rename":
                    if (!CanAdmin(player)) return;
                    if (args.Length < 3)
                    {
                        player.ChatMessage("Usage: /maxxinvaders rename <viewerId|npcId> <newName>");
                        return;
                    }
                    var renameKey = args[1];
                    var renameName = string.Join(" ", args.Skip(2));
                    if (RenameInvaderInternal(renameKey, renameName, out var renameErr))
                        player.ChatMessage("Renamed.");
                    else
                        player.ChatMessage($"Rename failed: {renameErr}");
                    break;
                case "clear":
                    if (!CanAdmin(player)) return;
                    _registry.DespawnAll(this, "chat_clear");
                    player.ChatMessage("Cleared all invaders.");
                    break;
                case "debug":
                    if (!permission.UserHasPermission(player.UserIDString, PermDebug) && !player.IsAdmin)
                    {
                        player.ChatMessage("No permission.");
                        return;
                    }
                    if (args.Length < 2)
                    {
                        player.ChatMessage("Usage: /maxxinvaders debug on|off");
                        return;
                    }
                    _debugRuntime = args[1].Equals("on", StringComparison.OrdinalIgnoreCase);
                    player.ChatMessage($"Debug = {_debugRuntime}");
                    break;
                default:
                    player.ChatMessage("Unknown subcommand.");
                    break;
            }
        }

        [ChatCommand("mi")]
        private void ChatMiAlias(BasePlayer player, string command, string[] args)
        {
            if (player == null) return;
            if (!CanAdmin(player)) return;

            if (args == null || args.Length == 0 || args[0].Equals("ui", StringComparison.OrdinalIgnoreCase))
            {
                OpenGui(player, 0);
                return;
            }

            ChatRouter(player, "maxxinvaders", args);
        }

        /// <summary>Alias so /maxxinvaders.ui works as a single token on many Oxide builds.</summary>
        [ChatCommand("maxxinvaders.ui")]
        private void ChatUiAlias(BasePlayer player, string command, string[] args)
        {
            if (player == null) return;
            if (!CanAdmin(player)) return;
            OpenGui(player, 0);
        }

        /// <summary>Opens the MaxxInvaders config editor tab (in-game). Cursor rule migration is a separate workflow.</summary>
        [ChatCommand("migrate-to-skills")]
        private void ChatMigrateToSkills(BasePlayer player, string command, string[] args)
        {
            if (player == null) return;
            if (!CanAdmin(player))
            {
                player.ChatMessage("Requires maxxinvaders.admin.");
                return;
            }

            _guiMainTab[player.userID] = GuiTabMaxxEdit;
            OpenGui(player, 0);
        }

        [ChatCommand("maxxinvaders.list")]
        private void ChatListAlias(BasePlayer player, string command, string[] args)
        {
            if (player == null) return;
            if (!CanUse(player)) return;
            ChatList(player);
        }

        private bool CanAdmin(BasePlayer p) =>
            p.IsAdmin || permission.UserHasPermission(p.UserIDString, PermAdmin);

        private bool CanUse(BasePlayer p) =>
            p.IsAdmin || permission.UserHasPermission(p.UserIDString, PermUse) ||
            permission.UserHasPermission(p.UserIDString, PermAdmin);

        private static string NormalizeViewerName(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var s = raw.Trim().Replace("<", "").Replace(">", "");
            if (s.Length > 24) s = s.Substring(0, 24);
            return string.IsNullOrWhiteSpace(s) ? null : s;
        }

        private bool TryFindInvader(string token, out InvaderRuntime runtime)
        {
            runtime = null;
            if (string.IsNullOrWhiteSpace(token)) return false;
            token = token.Trim();

            if (_registry.TryGetByViewer(token, out runtime))
                return true;

            foreach (var r in _registry.All())
            {
                if (r == null) continue;
                if (string.Equals(r.ViewerId, token, StringComparison.OrdinalIgnoreCase))
                {
                    runtime = r;
                    return true;
                }
                if (string.Equals(r.ViewerName, token, StringComparison.OrdinalIgnoreCase))
                {
                    runtime = r;
                    return true;
                }
                if (string.Equals(r.NpcId, token, StringComparison.OrdinalIgnoreCase))
                {
                    runtime = r;
                    return true;
                }
            }
            return false;
        }

        private bool RenameInvaderInternal(string viewerOrNpcId, string newName, out string error)
        {
            error = null;
            var normalized = NormalizeViewerName(newName);
            if (string.IsNullOrEmpty(normalized))
            {
                error = "invalid_name";
                return false;
            }

            var key = viewerOrNpcId?.Trim() ?? "";
            if (!TryFindInvader(key, out var r))
            {
                // Convenience fallback: if exactly one NPC is active, rename that one.
                var all = _registry.All().Where(x => x != null).ToList();
                if (all.Count == 1)
                    r = all[0];
                else
                {
                    error = "not_found (use viewerId, viewerName, or INV-xxxxx)";
                    return false;
                }
            }

            r.ViewerName = normalized;
            if (r.NpcPlayer != null && !r.NpcPlayer.IsDestroyed)
                r.NpcPlayer.displayName = normalized;

            LogIf(true, $"rename npc={r.NpcId} viewer={r.ViewerId} -> {normalized}", false);
            return true;
        }

        private bool ApplyAttributesToActiveInternal(string viewerOrNpcId, SpawnDraft draft, out string error)
        {
            error = null;
            if (draft == null)
            {
                error = "missing_draft";
                return false;
            }

            var key = viewerOrNpcId?.Trim() ?? "";
            if (!TryFindInvader(key, out var r))
            {
                var all = _registry.All().Where(x => x != null).ToList();
                if (all.Count == 1)
                    r = all[0];
                else
                {
                    error = "not_found (target viewerId/viewerName/INV-xxxxx)";
                    return false;
                }
            }

            if (!int.TryParse(draft.TierStr?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var tier))
                tier = r.Tier;
            if (!TryGetTier(tier, out var tierDef))
            {
                error = "invalid_tier";
                return false;
            }

            var mode = string.IsNullOrWhiteSpace(draft.Mode) ? r.Mode : draft.Mode.Trim().ToLowerInvariant();
            if (!IsBehaviorAllowed(mode))
            {
                error = "invalid_mode";
                return false;
            }

            var name = NormalizeViewerName(draft.ViewerName) ?? r.ViewerName;
            var kit = draft.Kit == "-" || string.IsNullOrWhiteSpace(draft.Kit) ? "" : draft.Kit.Trim();

            r.ViewerName = name;
            r.Tier = tier;
            r.Mode = mode;
            r.KitName = kit;
            if (r.NpcPlayer != null && !r.NpcPlayer.IsDestroyed)
            {
                r.NpcPlayer.displayName = name;
                var hp = tierDef.Health > 0 ? tierDef.Health : 100f;
                r.NpcPlayer.InitializeHealth(hp, hp);
            }

            var rec = _data?.History?.LastOrDefault(x => x.NpcId == r.NpcId);
            if (rec != null)
            {
                rec.ViewerName = r.ViewerName;
                rec.Tier = r.Tier;
                rec.Mode = r.Mode;
                rec.KitName = r.KitName;
                if (r.NpcPlayer != null && !r.NpcPlayer.IsDestroyed)
                    rec.LastHealth = r.NpcPlayer.health;
            }
            SaveDataFile();
            return true;
        }

        private List<InvaderRecord> GetRecentProfiles(int max = 8)
        {
            if (_data?.History == null || _data.History.Count == 0) return new List<InvaderRecord>();
            return _data.History
                .Where(x => !string.IsNullOrWhiteSpace(x.ViewerId) && !string.IsNullOrWhiteSpace(x.ViewerName))
                .OrderByDescending(x => x.SpawnedAtUtc)
                .GroupBy(x => x.ViewerId, StringComparer.OrdinalIgnoreCase)
                .Select(g => g.First())
                .Take(Mathf.Clamp(max, 1, 50))
                .ToList();
        }

        private bool TryGetProfile(string token, out InvaderRecord rec)
        {
            rec = null;
            if (_data?.History == null || string.IsNullOrWhiteSpace(token)) return false;
            token = token.Trim();

            rec = _data.History
                .Where(x => string.Equals(x.ViewerId, token, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(x => x.SpawnedAtUtc)
                .FirstOrDefault();
            if (rec != null) return true;

            rec = _data.History
                .Where(x => string.Equals(x.NpcId, token, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(x => x.SpawnedAtUtc)
                .FirstOrDefault();
            if (rec != null) return true;

            rec = _data.History
                .Where(x => string.Equals(x.ViewerName, token, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(x => x.SpawnedAtUtc)
                .FirstOrDefault();
            return rec != null;
        }

        private void LoadProfileToDraft(SpawnDraft d, InvaderRecord rec)
        {
            if (d == null || rec == null) return;
            d.ViewerName = rec.ViewerName ?? "DemoViewer";
            d.ViewerId = rec.ViewerId ?? d.ViewerId;
            d.TierStr = rec.Tier > 0 ? rec.Tier.ToString(CultureInfo.InvariantCulture) : "1";
            d.Mode = string.IsNullOrWhiteSpace(rec.Mode) ? "roaming" : rec.Mode;
            d.Kit = string.IsNullOrWhiteSpace(rec.KitName) ? "-" : rec.KitName;
            d.RenameTarget = rec.ViewerId ?? rec.NpcId ?? "";
            d.RenameName = rec.ViewerName ?? "";
        }

        private void ChatList(BasePlayer player)
        {
            var n = 0;
            foreach (var r in _registry.All())
            {
                n++;
                if (n > 15) break;
                player.ChatMessage($"{r.NpcId} | {r.ViewerName} | tier {r.Tier} | {r.Mode} | hp {r.NpcPlayer?.health ?? 0:F0}");
            }
            if (n == 0) player.ChatMessage("No active invaders.");
        }

        private void KillByNpcId(string npcId, bool gentle)
        {
            foreach (var r in _registry.All())
            {
                if (r.NpcId != npcId) continue;
                if (gentle)
                    DespawnInternal(r, "gui_despawn");
                else if (r.NpcPlayer != null && !r.NpcPlayer.IsDestroyed)
                    r.NpcPlayer.Kill();
                return;
            }
        }

        #endregion

        #region GUI

        /// <summary>
        /// CuiElementContainer adds Add(CuiButton, string) overloads; a plain Add(CuiElement) call
        /// can bind to the wrong overload — append via List&lt;CuiElement&gt; instead.
        /// </summary>
        private static void AddRawCuiElement(CuiElementContainer container, CuiElement element)
        {
            ((List<CuiElement>)container).Add(element);
        }

        /// <summary>Rust CUI: CuiTextComponent tends to render more reliably than CuiLabel inside nested panels.</summary>
        private static string StripCuiMarkup(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("<", "(").Replace(">", ")");
        }

        private static void AddCuiText(
            CuiElementContainer container,
            string parent,
            string text,
            string anchorMin,
            string anchorMax,
            int fontSize = 14,
            TextAnchor align = TextAnchor.MiddleLeft,
            string color = "0.96 0.98 1 1")
        {
            AddRawCuiElement(
                container,
                new CuiElement
                {
                    Name = Guid.NewGuid().ToString("N"),
                    Parent = parent,
                    Components =
                    {
                        new CuiTextComponent
                        {
                            Text = text,
                            FontSize = fontSize,
                            Align = align,
                            Color = color,
                        },
                        new CuiRectTransformComponent { AnchorMin = anchorMin, AnchorMax = anchorMax },
                    },
                });
        }

        /// <summary>
        /// Rust client often fails to draw <see cref="CuiButton.Text"/> on nested panels; use a child
        /// <see cref="CuiTextComponent"/> full-rect on the button element (same pattern as PersonalNPC).
        /// </summary>
        private static void AddCuiButtonWithText(
            CuiElementContainer container,
            string parent,
            string command,
            string bgColor,
            string text,
            string anchorMin,
            string anchorMax,
            int fontSize = 12,
            TextAnchor align = TextAnchor.MiddleCenter,
            string textColor = "1 1 1 1")
        {
            var btnName = Guid.NewGuid().ToString("N");
            AddRawCuiElement(
                container,
                new CuiElement
                {
                    Name = btnName,
                    Parent = parent,
                    Components =
                    {
                        new CuiButtonComponent
                        {
                            Color = bgColor,
                            Command = command,
                            Material = "Assets/Content/UI/UI.Background.Tile.psd",
                        },
                        new CuiRectTransformComponent { AnchorMin = anchorMin, AnchorMax = anchorMax },
                    },
                });
            AddRawCuiElement(
                container,
                new CuiElement
                {
                    Parent = btnName,
                    Components =
                    {
                        new CuiTextComponent
                        {
                            Text = text,
                            FontSize = fontSize,
                            Align = align,
                            Color = textColor,
                        },
                        new CuiRectTransformComponent { AnchorMin = "0 0", AnchorMax = "1 1" },
                    },
                });
        }

        /// <summary>
        /// Input fields alone often render as a flat color block; a dark framed panel behind an inset field reads better.
        /// </summary>
        private static void AddCuiInputFieldFramed(
            CuiElementContainer container,
            string parent,
            string command,
            string initialText,
            string anchorMin,
            string anchorMax,
            int fontSize = 14,
            int charsLimit = 64)
        {
            var wrap = Guid.NewGuid().ToString("N");
            AddRawCuiElement(
                container,
                new CuiElement
                {
                    Name = wrap,
                    Parent = parent,
                    Components =
                    {
                        new CuiImageComponent
                        {
                            Color = "0.10 0.11 0.14 0.98",
                            Material = "Assets/Content/UI/UI.Background.Tile.psd",
                        },
                        new CuiRectTransformComponent { AnchorMin = anchorMin, AnchorMax = anchorMax },
                    },
                });
            AddRawCuiElement(
                container,
                new CuiElement
                {
                    Parent = wrap,
                    Components =
                    {
                        new CuiInputFieldComponent
                        {
                            Align = TextAnchor.MiddleLeft,
                            CharsLimit = charsLimit,
                            Command = command,
                            FontSize = fontSize,
                            IsPassword = false,
                            Text = initialText ?? "",
                            NeedsKeyboard = true,
                        },
                        new CuiRectTransformComponent { AnchorMin = "0.03 0.10", AnchorMax = "0.97 0.90" },
                    },
                });
        }

        private readonly Dictionary<ulong, int> _guiPage = new();
        /// <summary>0 = invaders, 1 = edit MaxxInvaders.json, 2 = RoamingNPCs bot toggles.</summary>
        private readonly Dictionary<ulong, int> _guiMainTab = new();

        private readonly Dictionary<ulong, int> _guiRoamingKeyPage = new();

        /// <summary>Selected profile slot (0–3) for the spawn form; set via GUI slot buttons or Load.</summary>
        private readonly Dictionary<ulong, int> _guiActiveProfileSlot = new();

        /// <summary>Per-NPC roaming template key typed in GUI before Apply (respawn).</summary>
        private readonly Dictionary<ulong, Dictionary<string, string>> _guiNpcTemplateField =
            new();

        private readonly Dictionary<ulong, SpawnDraft> _spawnDrafts = new();

        private const int GuiTabInvaders = 0;
        private const int GuiTabMaxxEdit = 1;
        private const int GuiTabRoamingEdit = 2;

        private sealed class SpawnDraft
        {
            public string ViewerName = "DemoViewer";
            public string ViewerId;
            public string TierStr = "1";
            public string Kit = "-";
            public string Mode = "roaming";
            public string RenameTarget = "";
            public string RenameName = "";

            public SpawnDraft()
            {
                ViewerId = "demo_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            }
        }

        private SpawnDraft GetSpawnDraft(ulong userId)
        {
            if (!_spawnDrafts.TryGetValue(userId, out var d))
            {
                d = new SpawnDraft();
                _spawnDrafts[userId] = d;
            }
            return d;
        }

        /// <summary>Which of the four profile rows is active for the spawn form (-1 = none).</summary>
        private int ResolveActiveProfileSlot(ulong userId, List<InvaderRecord> profiles, SpawnDraft draft)
        {
            if (profiles == null || profiles.Count == 0) return -1;
            if (_guiActiveProfileSlot.TryGetValue(userId, out var saved))
            {
                if (saved < 0) return -1;
                return saved >= profiles.Count ? profiles.Count - 1 : saved;
            }

            if (draft != null && !string.IsNullOrWhiteSpace(draft.ViewerId))
            {
                for (var i = 0; i < profiles.Count; i++)
                {
                    if (string.Equals(profiles[i].ViewerId, draft.ViewerId, StringComparison.OrdinalIgnoreCase))
                        return i;
                }
            }

            return -1;
        }

        private int GetGuiPage(ulong userId) =>
            _guiPage.TryGetValue(userId, out var pg) ? pg : 0;

        private int GetRoamingKeyPage(ulong userId) =>
            _guiRoamingKeyPage.TryGetValue(userId, out var p) ? p : 0;

        private void ApplyGuiCfgToggle(string field)
        {
            if (string.IsNullOrWhiteSpace(field) || _cfg == null) return;
            switch (field.Trim())
            {
                case nameof(InvaderConfig.EnablePlugin):
                    _cfg.EnablePlugin = !_cfg.EnablePlugin;
                    break;
                case nameof(InvaderConfig.DebugMode):
                    _cfg.DebugMode = !_cfg.DebugMode;
                    break;
                case nameof(InvaderConfig.UseRoamingNPCsWhenAvailable):
                    _cfg.UseRoamingNPCsWhenAvailable = !_cfg.UseRoamingNPCsWhenAvailable;
                    break;
                case nameof(InvaderConfig.ScientistFallbackEnabled):
                    _cfg.ScientistFallbackEnabled = !_cfg.ScientistFallbackEnabled;
                    break;
                case nameof(InvaderConfig.PreventDuplicateViewerNPCs):
                    _cfg.PreventDuplicateViewerNPCs = !_cfg.PreventDuplicateViewerNPCs;
                    break;
                case nameof(InvaderConfig.BlockSpawnInSafeZones):
                    _cfg.BlockSpawnInSafeZones = !_cfg.BlockSpawnInSafeZones;
                    break;
                case nameof(InvaderConfig.BlockSpawnInMonuments):
                    _cfg.BlockSpawnInMonuments = !_cfg.BlockSpawnInMonuments;
                    break;
                case nameof(InvaderConfig.DespawnOnUnload):
                    _cfg.DespawnOnUnload = !_cfg.DespawnOnUnload;
                    break;
                default:
                    return;
            }

            SaveConfig();
        }

        private void ApplyGuiCfgStr(string field, string value)
        {
            if (_cfg == null) return;
            value = value?.Trim() ?? "";
            if (field == nameof(InvaderConfig.DefaultRoamingTemplateKey))
            {
                _cfg.DefaultRoamingTemplateKey = value;
                SaveConfig();
            }
        }

        private void ApplyGuiCfgNum(string field, string valueRaw)
        {
            if (_cfg == null || string.IsNullOrWhiteSpace(valueRaw)) return;
            var v = valueRaw.Trim();
            switch (field)
            {
                case nameof(InvaderConfig.MaxActiveNPCs):
                    if (int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out var i))
                    {
                        _cfg.MaxActiveNPCs = Mathf.Clamp(i, 1, 500);
                        SaveConfig();
                    }

                    break;
                case nameof(InvaderConfig.SpawnAttempts):
                    if (int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out var sa))
                    {
                        _cfg.SpawnAttempts = Mathf.Clamp(sa, 1, 200);
                        SaveConfig();
                    }

                    break;
                case nameof(InvaderConfig.DefaultSpawnRadius):
                    if (float.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var dr))
                    {
                        _cfg.DefaultSpawnRadius = Mathf.Clamp(dr, 5f, 500f);
                        if (_cfg.MinimumSpawnRadiusFromAnchor > _cfg.DefaultSpawnRadius)
                            _cfg.MinimumSpawnRadiusFromAnchor = _cfg.DefaultSpawnRadius;
                        SaveConfig();
                    }

                    break;
                case nameof(InvaderConfig.MaxDistanceFromAnchor):
                    if (float.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var leash))
                    {
                        _cfg.MaxDistanceFromAnchor = Mathf.Clamp(leash, 0f, 1000f);
                        SaveConfig();
                    }

                    break;
                case nameof(InvaderConfig.MinimumSpawnRadiusFromAnchor):
                    if (float.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var minr))
                    {
                        _cfg.MinimumSpawnRadiusFromAnchor = Mathf.Clamp(minr, 0f, _cfg.DefaultSpawnRadius);
                        SaveConfig();
                    }

                    break;
                case nameof(InvaderConfig.MinimumDistanceFromPlayers):
                    if (float.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var md))
                    {
                        _cfg.MinimumDistanceFromPlayers = Mathf.Clamp(md, 0f, 200f);
                        SaveConfig();
                    }

                    break;
                case nameof(InvaderConfig.PerViewerCooldownSeconds):
                    if (float.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var cd))
                    {
                        _cfg.PerViewerCooldownSeconds = Mathf.Clamp(cd, 0f, 3600f);
                        SaveConfig();
                    }

                    break;
            }
        }

        private void AddMaxxConfigEditor(CuiElementContainer container, string panel, BasePlayer player)
        {
            AddCuiText(
                container,
                panel,
                "<size=17><color=#d62828>MAXX SETTINGS</color></size>\n<size=10><color=#8899aa>Writes oxide/config/MaxxInvaders.json</color></size>",
                "0.03 0.90",
                "0.97 0.99",
                12,
                TextAnchor.UpperLeft,
                "0.95 0.97 1 1");

            float y = 0.86f;
            void RowLabel(string text, float h = 0.034f)
            {
                container.Add(
                    new CuiLabel
                    {
                        Text = { Text = text, FontSize = 10, Align = TextAnchor.MiddleLeft, Color = "0.9 0.92 0.96 1" },
                        RectTransform = { AnchorMin = $"0.03 {y - h}", AnchorMax = $"0.97 {y}" },
                    },
                    panel);
                y -= h + 0.008f;
            }

            void RowToggle(string label, bool current, string fieldName)
            {
                var on = current ? "ON" : "OFF";
                container.Add(
                    new CuiLabel
                    {
                        Text = { Text = $"{label}: <b>{on}</b>", FontSize = 10, Align = TextAnchor.MiddleLeft, Color = "0.9 0.92 0.96 1" },
                        RectTransform = { AnchorMin = $"0.03 {y - 0.032f}", AnchorMax = $"0.72 {y}" },
                    },
                    panel);
                AddCuiButtonWithText(
                    container,
                    panel,
                    $"maxxinvaders.gui cfgtoggle {fieldName}",
                    "0.72 0.14 0.10 0.92",
                    "Toggle",
                    $"0.73 {y - 0.032f}",
                    $"0.97 {y}",
                    10);
                y -= 0.044f;
            }

            RowLabel("<b>Options</b>", 0.03f);
            RowToggle("UseRoamingNPCsWhenAvailable", _cfg.UseRoamingNPCsWhenAvailable,
                nameof(InvaderConfig.UseRoamingNPCsWhenAvailable));
            RowToggle("PreventDuplicateViewerNPCs", _cfg.PreventDuplicateViewerNPCs,
                nameof(InvaderConfig.PreventDuplicateViewerNPCs));
            RowToggle("BlockSpawnInSafeZones", _cfg.BlockSpawnInSafeZones, nameof(InvaderConfig.BlockSpawnInSafeZones));
            RowToggle("BlockSpawnInMonuments", _cfg.BlockSpawnInMonuments,
                nameof(InvaderConfig.BlockSpawnInMonuments));
            RowToggle("DespawnOnUnload", _cfg.DespawnOnUnload, nameof(InvaderConfig.DespawnOnUnload));

            container.Add(
                new CuiLabel
                {
                    Text = { Text = "DefaultRoamingTemplateKey", FontSize = 9, Align = TextAnchor.LowerLeft },
                    RectTransform = { AnchorMin = $"0.03 {y - 0.02f}", AnchorMax = $"0.35 {y}" },
                },
                panel);
            AddRawCuiElement(
                container,
                new CuiElement
                {
                    Name = Guid.NewGuid().ToString("N"),
                    Parent = panel,
                    Components =
                    {
                        new CuiInputFieldComponent
                        {
                            Align = TextAnchor.MiddleLeft,
                            CharsLimit = 64,
                            Command = $"maxxinvaders.gui cfgstr {nameof(InvaderConfig.DefaultRoamingTemplateKey)} ",
                            FontSize = 12,
                            IsPassword = false,
                            Text = _cfg.DefaultRoamingTemplateKey ?? "",
                            NeedsKeyboard = true,
                        },
                        new CuiRectTransformComponent { AnchorMin = $"0.36 {y - 0.038f}", AnchorMax = $"0.97 {y}" },
                    },
                });
            y -= 0.048f;

            void RowNum(string label, string field, string display)
            {
                container.Add(
                    new CuiLabel
                    {
                        Text = { Text = label, FontSize = 9, Align = TextAnchor.LowerLeft },
                        RectTransform = { AnchorMin = $"0.03 {y - 0.02f}", AnchorMax = $"0.35 {y}" },
                    },
                    panel);
                AddRawCuiElement(
                    container,
                    new CuiElement
                    {
                        Name = Guid.NewGuid().ToString("N"),
                        Parent = panel,
                        Components =
                        {
                            new CuiInputFieldComponent
                            {
                                Align = TextAnchor.MiddleLeft,
                                CharsLimit = 16,
                                Command = $"maxxinvaders.gui cfgnum {field} ",
                                FontSize = 12,
                                IsPassword = false,
                                Text = display,
                                NeedsKeyboard = true,
                            },
                            new CuiRectTransformComponent { AnchorMin = $"0.36 {y - 0.038f}", AnchorMax = $"0.97 {y}" },
                        },
                    });
                y -= 0.048f;
            }

            RowNum("MaxActiveNPCs", nameof(InvaderConfig.MaxActiveNPCs), _cfg.MaxActiveNPCs.ToString());
            RowNum("MinimumSpawnRadiusFromAnchor", nameof(InvaderConfig.MinimumSpawnRadiusFromAnchor),
                _cfg.MinimumSpawnRadiusFromAnchor.ToString(CultureInfo.InvariantCulture));
            RowNum("DefaultSpawnRadius", nameof(InvaderConfig.DefaultSpawnRadius),
                _cfg.DefaultSpawnRadius.ToString(CultureInfo.InvariantCulture));
            RowNum("MaxDistanceFromAnchor", nameof(InvaderConfig.MaxDistanceFromAnchor),
                _cfg.MaxDistanceFromAnchor.ToString(CultureInfo.InvariantCulture));
            RowNum("MinimumDistanceFromPlayers", nameof(InvaderConfig.MinimumDistanceFromPlayers),
                _cfg.MinimumDistanceFromPlayers.ToString(CultureInfo.InvariantCulture));
            RowNum("SpawnAttempts", nameof(InvaderConfig.SpawnAttempts), _cfg.SpawnAttempts.ToString());
            RowNum("PerViewerCooldownSeconds", nameof(InvaderConfig.PerViewerCooldownSeconds),
                _cfg.PerViewerCooldownSeconds.ToString(CultureInfo.InvariantCulture));

            container.Add(
                new CuiLabel
                {
                    Text =
                    {
                        Text =
                            "Access: /migrate-to-skills opens this tab. Also /maxxinvaders maxx | /maxxinvaders roaming",
                        FontSize = 7,
                        Align = TextAnchor.LowerLeft,
                        Color = "0.65 0.72 0.78 1",
                    },
                    RectTransform = { AnchorMin = "0.02 0.02", AnchorMax = "0.98 0.055" },
                },
                panel);
        }

        private void AddRoamingBotsEditor(CuiElementContainer container, string panel, BasePlayer player)
        {
            AddCuiText(
                container,
                panel,
                "<size=17><color=#d62828>ROAMING BOTS</color></size>\n<size=10><color=#8899aa>oxide/config/RoamingNPCs.json — Enable bot? per template</color></size>",
                "0.02 0.88",
                "0.98 0.99",
                11,
                TextAnchor.UpperLeft,
                "0.95 0.97 1 1");

            if (RoamingNPCs == null || !RoamingNPCs.IsLoaded)
            {
                container.Add(
                    new CuiLabel
                    {
                        Text =
                        {
                            Text =
                                "RoamingNPCs is not loaded. Copy RoamingNPCs.cs from the repo into oxide/plugins and run: oxide.reload RoamingNPCs",
                            FontSize = 9,
                            Align = TextAnchor.MiddleLeft,
                        },
                        RectTransform = { AnchorMin = "0.03 0.04", AnchorMax = "0.97 0.85" },
                    },
                    panel);
                return;
            }

            object o = null;
            try
            {
                o = RoamingNPCs.Call("GetBridgeBotKeysCsv");
            }
            catch
            {
                /* old plugin */
            }

            if (o == null)
            {
                container.Add(
                    new CuiLabel
                    {
                        Text =
                        {
                            Text =
                                "Bridge API missing on this RoamingNPCs build. Replace oxide/plugins/RoamingNPCs.cs with the latest from RustMaxx repo (bridge code is inside that file), then oxide.reload RoamingNPCs.",
                            FontSize = 8,
                            Align = TextAnchor.UpperLeft,
                        },
                        RectTransform = { AnchorMin = "0.03 0.04", AnchorMax = "0.97 0.85" },
                    },
                    panel);
                return;
            }

            var csv = o as string ?? "";
            if (csv.Length == 0)
            {
                container.Add(
                    new CuiLabel
                    {
                        Text =
                        {
                            Text =
                                "Bots settings has no keys. Add bot templates under Bots in oxide/config/RoamingNPCs.json, or delete the config and reload to regenerate defaults.",
                            FontSize = 8,
                            Align = TextAnchor.UpperLeft,
                        },
                        RectTransform = { AnchorMin = "0.03 0.04", AnchorMax = "0.97 0.85" },
                    },
                    panel);
                return;
            }

            var keys = csv.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries).Select(x => x.Trim())
                .Where(x => x.Length > 0).ToList();
            if (keys.Count == 0)
            {
                container.Add(
                    new CuiLabel
                    {
                        Text = { Text = "No bot templates in RoamingNPCs.json (Bots settings).", FontSize = 9 },
                        RectTransform = { AnchorMin = "0.03 0.04", AnchorMax = "0.97 0.85" },
                    },
                    panel);
                return;
            }

            const int perPage = 10;
            var page = GetRoamingKeyPage(player.userID);
            var totalPages = Math.Max(1, (int)Math.Ceiling(keys.Count / (float)perPage));
            page = Mathf.Clamp(page, 0, totalPages - 1);
            _guiRoamingKeyPage[player.userID] = page;

            var slice = keys.Skip(page * perPage).Take(perPage).ToList();

            container.Add(
                new CuiLabel
                {
                    Text = { Text = $"Keys {page + 1}/{totalPages}  ({keys.Count} total)", FontSize = 9, Color = "0.85 0.88 0.92 1" },
                    RectTransform = { AnchorMin = "0.02 0.755", AnchorMax = "0.5 0.795" },
                },
                panel);

            if (page > 0)
                AddCuiButtonWithText(
                    container,
                    panel,
                    $"maxxinvaders.gui roampage {page - 1}",
                    "0.14 0.14 0.16 0.95",
                    "Prev keys",
                    "0.52 0.755",
                    "0.62 0.795",
                    9,
                    TextAnchor.MiddleCenter,
                    "0.95 0.97 1 1");

            if (page < totalPages - 1)
                AddCuiButtonWithText(
                    container,
                    panel,
                    $"maxxinvaders.gui roampage {page + 1}",
                    "0.14 0.14 0.16 0.95",
                    "Next keys",
                    "0.63 0.755",
                    "0.76 0.795",
                    9,
                    TextAnchor.MiddleCenter,
                    "0.95 0.97 1 1");

            float ry = 0.72f;
            foreach (var key in slice)
            {
                var st = "off";
                try
                {
                    var ready = RoamingNPCs.Call("IsBridgeTemplateReady", key) as string;
                    if (ready == "ok") st = "on";
                    else if (ready == "disabled") st = "off";
                    else if (ready == "missing") st = "missing";
                }
                catch
                {
                    st = "?";
                }

                container.Add(
                    new CuiLabel
                    {
                        Text = { Text = key, FontSize = 8, Align = TextAnchor.MiddleLeft },
                        RectTransform = { AnchorMin = $"0.03 {ry - 0.036f}", AnchorMax = $"0.55 {ry}" },
                    },
                    panel);
                container.Add(
                    new CuiLabel
                    {
                        Text = { Text = $"bridge: {st}", FontSize = 7, Align = TextAnchor.MiddleRight },
                        RectTransform = { AnchorMin = $"0.56 {ry - 0.036f}", AnchorMax = $"0.72 {ry}" },
                    },
                    panel);
                AddCuiButtonWithText(
                    container,
                    panel,
                    $"maxxinvaders.gui roamtoggle {key}",
                    "0.72 0.14 0.10 0.92",
                    "Toggle Enable bot?",
                    $"0.73 {ry - 0.036f}",
                    $"0.97 {ry}",
                    8);
                ry -= 0.044f;
            }

            container.Add(
                new CuiLabel
                {
                    Text =
                    {
                        Text = "Access: /migrate-to-skills (Maxx tab) or /maxxinvaders roaming — Cursor: migrate-to-skills skill for .cursor rules",
                        FontSize = 7,
                        Align = TextAnchor.LowerLeft,
                        Color = "0.65 0.72 0.78 1",
                    },
                    RectTransform = { AnchorMin = "0.02 0.02", AnchorMax = "0.98 0.048" },
                },
                panel);
        }

        private void OpenGui(BasePlayer player, int page)
        {
            if (player == null) return;
            CuiHelper.DestroyUi(player, UiName);
            _guiPage[player.userID] = page;
            if (!_guiMainTab.TryGetValue(player.userID, out var mainTab)) mainTab = 0;

            var rows = mainTab == GuiTabInvaders ? Mathf.Min(_cfg.Gui.RowsPerPage, 3) : _cfg.Gui.RowsPerPage;
            var list = _registry.All().ToList();
            var totalPages = Math.Max(1, (int)Math.Ceiling(list.Count / (float)rows));
            page = Mathf.Clamp(page, 0, totalPages - 1);
            var slice = list.Skip(page * rows).Take(rows).ToList();

            var container = new CuiElementContainer();
            var panel = container.Add(
                new CuiPanel
                {
                    Image = { Color = "0.05 0.05 0.07 0.98" },
                    RectTransform = { AnchorMin = "0.04 0.06", AnchorMax = "0.96 0.94" },
                    CursorEnabled = true,
                },
                "Overlay",
                UiName);

            const string uiRustRed = "0.72 0.14 0.10 0.95";
            const string uiSideBg = "0.04 0.04 0.06 0.98";
            const string uiMuted = "0.14 0.14 0.16 0.92";

            container.Add(
                new CuiLabel
                {
                    Text =
                    {
                        Text =
                            $"<size=18><color=#dddddd>MAXX</color> <color=#d62828>INVADERS</color></size>  <size=11><color=#8899aa>v{Version}</color></size>",
                        FontSize = 14,
                        Align = TextAnchor.MiddleLeft,
                    },
                    RectTransform = { AnchorMin = "0.02 0.93", AnchorMax = "0.42 0.99" },
                },
                panel);

            if (mainTab == GuiTabInvaders && page > 0)
                AddCuiButtonWithText(
                    container,
                    panel,
                    $"maxxinvaders.gui page {page - 1}",
                    uiMuted,
                    "◀",
                    "0.52 0.93",
                    "0.59 0.99",
                    13,
                    TextAnchor.MiddleCenter,
                    "0.95 0.95 1 1");

            if (mainTab == GuiTabInvaders && page < totalPages - 1)
                AddCuiButtonWithText(
                    container,
                    panel,
                    $"maxxinvaders.gui page {page + 1}",
                    uiMuted,
                    "▶",
                    "0.60 0.93",
                    "0.67 0.99",
                    13,
                    TextAnchor.MiddleCenter,
                    "0.95 0.95 1 1");

            if (mainTab == GuiTabInvaders)
                AddCuiText(
                    container,
                    panel,
                    $"Page {page + 1}/{totalPages}  ·  On map: {list.Count}",
                    "0.68 0.93",
                    "0.81 0.99",
                    11,
                    TextAnchor.MiddleRight,
                    "0.72 0.78 0.88 1");

            AddCuiButtonWithText(
                container,
                panel,
                "maxxinvaders.gui action refresh",
                "0.18 0.35 0.42 0.95",
                "Refresh",
                "0.82 0.93",
                "0.90 0.99",
                11,
                TextAnchor.MiddleCenter,
                "0.95 0.97 1 1");

            AddCuiButtonWithText(
                container,
                panel,
                "maxxinvaders.gui action close",
                uiRustRed,
                "CLOSE",
                "0.91 0.93",
                "0.99 0.99",
                11);

            var sidebar = container.Add(
                new CuiPanel
                {
                    Image = { Color = uiSideBg },
                    RectTransform = { AnchorMin = "0.015 0.02", AnchorMax = "0.155 0.915" },
                    CursorEnabled = true,
                },
                panel);

            AddCuiButtonWithText(
                container,
                sidebar,
                "maxxinvaders.gui tab 0",
                mainTab == GuiTabInvaders ? uiRustRed : uiMuted,
                "INVADERS",
                "0.06 0.76",
                "0.94 0.88",
                11);
            AddCuiButtonWithText(
                container,
                sidebar,
                "maxxinvaders.gui tab 1",
                mainTab == GuiTabMaxxEdit ? uiRustRed : uiMuted,
                "MAXX SETTINGS",
                "0.06 0.62",
                "0.94 0.74",
                10);
            AddCuiButtonWithText(
                container,
                sidebar,
                "maxxinvaders.gui tab 2",
                mainTab == GuiTabRoamingEdit ? uiRustRed : uiMuted,
                "ROAMING",
                "0.06 0.48",
                "0.94 0.60",
                11);

            var contentPanel = container.Add(
                new CuiPanel
                {
                    Image = { Color = "0.08 0.08 0.10 0.96" },
                    RectTransform = { AnchorMin = "0.16 0.02", AnchorMax = "0.985 0.915" },
                    CursorEnabled = true,
                },
                panel);

            if (mainTab == GuiTabMaxxEdit)
            {
                AddMaxxConfigEditor(container, contentPanel, player);
                CuiHelper.AddUi(player, container);
                return;
            }

            if (mainTab == GuiTabRoamingEdit)
            {
                AddRoamingBotsEditor(container, contentPanel, player);
                CuiHelper.AddUi(player, container);
                return;
            }

            var statusStrip = container.Add(
                new CuiPanel
                {
                    Image = { Color = "0.06 0.07 0.10 0.94" },
                    RectTransform = { AnchorMin = "0.02 0.852", AnchorMax = "0.98 0.918" },
                    CursorEnabled = false,
                },
                contentPanel);
            AddCuiText(
                container,
                statusStrip,
                BuildRoamingGuiStatusText(),
                "0.02 0.06",
                "0.98 0.94",
                10,
                TextAnchor.UpperLeft,
                "0.82 0.88 0.94 1");

            AddCuiText(
                container,
                contentPanel,
                "ACTIVE BOTS — click buttons on each card",
                "0.02 0.798",
                "0.98 0.832",
                12,
                TextAnchor.MiddleLeft,
                "0.95 0.97 1 1");

            var draft = GetSpawnDraft(player.userID);
            const string uiRustRed2 = "0.72 0.14 0.10 0.95";
            const string uiCard = "0.12 0.12 0.15 0.94";
            const string uiGreen = "0.18 0.48 0.28 0.95";

            var cardIdx = 0;
            foreach (var r in slice)
            {
                var hp = r.NpcPlayer != null && !r.NpcPlayer.IsDestroyed ? r.NpcPlayer.health : 0f;
                var top = 0.772f - cardIdx * 0.093f;
                var bot = top - 0.086f;
                var aMin = $"0.02 {bot.ToString("F4", CultureInfo.InvariantCulture)}";
                var aMax = $"0.98 {top.ToString("F4", CultureInfo.InvariantCulture)}";
                var card = container.Add(
                    new CuiPanel
                    {
                        Image = { Color = uiCard },
                        RectTransform = { AnchorMin = aMin, AnchorMax = aMax },
                    },
                    contentPanel);

                var nm = StripCuiMarkup(string.IsNullOrWhiteSpace(r.ViewerName) ? "?" : r.ViewerName.Trim());
                var tmpl = r.IsRoamingNpc
                    ? StripCuiMarkup(r.RoamingTemplateKey ?? _cfg.DefaultRoamingTemplateKey ?? "")
                    : "(scientist)";
                var line1 = $"{nm}   {StripCuiMarkup(r.NpcId)}";
                var line2 =
                    $"T{r.Tier}  {r.Mode}  HP {hp:F0}  {(r.IsRoamingNpc ? "Roaming" : "Scientist")}  tpl:{tmpl}";
                AddCuiText(
                    container,
                    card,
                    line1 + "\n" + line2,
                    "0.03 0.38",
                    "0.60 0.95",
                    12,
                    TextAnchor.UpperLeft,
                    "1 1 1 1");

                AddCuiButtonWithText(
                    container,
                    card,
                    $"maxxinvaders.gui tp {r.NpcId}",
                    _cfg.Gui.AccentColor,
                    "TP",
                    "0.61 0.52",
                    "0.69 0.92",
                    11);
                AddCuiButtonWithText(
                    container,
                    card,
                    $"maxxinvaders.gui returnrun {r.NpcId}",
                    uiGreen,
                    "RETURN",
                    "0.70 0.52",
                    "0.82 0.92",
                    9);
                AddCuiButtonWithText(
                    container,
                    card,
                    $"maxxinvaders.gui kill {r.NpcId}",
                    "0.45 0.12 0.12 0.95",
                    "KILL",
                    "0.83 0.52",
                    "0.89 0.92",
                    10);
                AddCuiButtonWithText(
                    container,
                    card,
                    $"maxxinvaders.gui despawn {r.NpcId}",
                    "0.35 0.32 0.15 0.95",
                    "DESPAWN",
                    "0.90 0.52",
                    "0.99 0.92",
                    8);

                AddCuiText(
                    container,
                    card,
                    "Roaming template (Apply = respawn):",
                    "0.03 0.06",
                    "0.36 0.34",
                    9,
                    TextAnchor.MiddleLeft,
                    "0.85 0.88 0.95 1");
                var tmplVal = GetGuiNpcTemplateField(player.userID, r.NpcId, r.RoamingTemplateKey ?? "");
                AddCuiInputFieldFramed(
                    container,
                    card,
                    $"maxxinvaders.gui ntmpl {r.NpcId} ",
                    tmplVal,
                    "0.37 0.08",
                    "0.76 0.36",
                    12,
                    64);
                AddCuiButtonWithText(
                    container,
                    card,
                    $"maxxinvaders.gui applytmpl {r.NpcId}",
                    uiRustRed2,
                    "APPLY",
                    "0.77 0.08",
                    "0.98 0.36",
                    9);

                cardIdx++;
            }

            if (slice.Count == 0)
                AddCuiText(
                    container,
                    contentPanel,
                    "No active bots on the map.\nUse SPAWN & RENAME below, or TikFinity.",
                    "0.04 0.56",
                    "0.96 0.76",
                    13,
                    TextAnchor.MiddleLeft,
                    "0.85 0.88 0.95 1");

            AddCuiText(
                container,
                contentPanel,
                "SPAWN & RENAME (form)",
                "0.02 0.552",
                "0.98 0.575",
                12,
                TextAnchor.MiddleLeft,
                "0.95 0.97 1 1");

            var formPanel = container.Add(
                new CuiPanel
                {
                    Image = { Color = "0.10 0.11 0.14 0.95" },
                    RectTransform = { AnchorMin = "0.02 0.378", AnchorMax = "0.98 0.545" },
                    CursorEnabled = true,
                },
                contentPanel);

            AddCuiText(container, formPanel, "SPAWN", "0.02 0.84", "0.18 0.96", 18, TextAnchor.MiddleLeft, "1 1 1 1");
            AddCuiText(container, formPanel, "RENAME", "0.66 0.84", "0.86 0.96", 18, TextAnchor.MiddleLeft, "1 1 1 1");

            AddCuiButtonWithText(
                container,
                formPanel,
                "maxxinvaders.gui quickdemo",
                "0.20 0.62 0.44 0.98",
                "Quick Spawn",
                "0.02 0.72",
                "0.31 0.82",
                13);
            AddCuiButtonWithText(
                container,
                formPanel,
                "maxxinvaders.gui spawnfields",
                "0.22 0.48 0.72 0.98",
                "Spawn From Form",
                "0.33 0.72",
                "0.62 0.82",
                13);
            AddCuiButtonWithText(
                container,
                formPanel,
                "maxxinvaders.gui applyattrs",
                "0.55 0.45 0.2 0.98",
                "Apply Attributes To Active",
                "0.33 0.62",
                "0.62 0.70",
                11);

            AddCuiText(
                container,
                formPanel,
                "Viewer Name",
                "0.02 0.62",
                "0.2 0.7",
                12,
                TextAnchor.MiddleLeft,
                "0.92 0.95 1 1");
            AddCuiInputFieldFramed(
                container,
                formPanel,
                "maxxinvaders.gui draft viewername",
                draft.ViewerName ?? "DemoViewer",
                "0.02 0.52",
                "0.62 0.61");

            AddCuiText(
                container,
                formPanel,
                "Viewer ID",
                "0.02 0.43",
                "0.2 0.51",
                12,
                TextAnchor.MiddleLeft,
                "0.92 0.95 1 1");
            AddCuiInputFieldFramed(
                container,
                formPanel,
                "maxxinvaders.gui draft viewerid",
                draft.ViewerId ?? "",
                "0.02 0.33",
                "0.30 0.42",
                14,
                48);
            AddCuiInputFieldFramed(
                container,
                formPanel,
                "maxxinvaders.gui draft tier",
                draft.TierStr ?? "1",
                "0.32 0.33",
                "0.38 0.42",
                14,
                4);
            AddCuiInputFieldFramed(
                container,
                formPanel,
                "maxxinvaders.gui draft mode",
                draft.Mode ?? "roaming",
                "0.40 0.33",
                "0.50 0.42",
                14,
                24);
            AddCuiInputFieldFramed(
                container,
                formPanel,
                "maxxinvaders.gui draft kit",
                draft.Kit ?? "-",
                "0.52 0.33",
                "0.62 0.42",
                14,
                48);
            AddCuiButtonWithText(
                container,
                formPanel,
                "maxxinvaders.gui draftreset",
                "0.30 0.30 0.36 0.98",
                "Reset Form",
                "0.02 0.20",
                "0.30 0.29",
                12);

            AddCuiText(
                container,
                formPanel,
                "Target (viewerId / viewerName / INV-xxxxx)",
                "0.66 0.62",
                "0.98 0.7",
                11,
                TextAnchor.MiddleLeft,
                "0.92 0.95 1 1");
            AddCuiInputFieldFramed(
                container,
                formPanel,
                "maxxinvaders.gui draft renametarget",
                draft.RenameTarget ?? "",
                "0.66 0.52",
                "0.98 0.61",
                14,
                64);
            AddCuiText(
                container,
                formPanel,
                "New Name",
                "0.66 0.43",
                "0.9 0.51",
                12,
                TextAnchor.MiddleLeft,
                "0.92 0.95 1 1");
            AddCuiInputFieldFramed(
                container,
                formPanel,
                "maxxinvaders.gui draft renamename",
                draft.RenameName ?? "",
                "0.66 0.33",
                "0.98 0.42",
                14,
                64);
            AddCuiButtonWithText(
                container,
                formPanel,
                "maxxinvaders.gui renameapply",
                "0.24 0.52 0.72 0.98",
                "Apply Rename",
                "0.66 0.20",
                "0.98 0.29",
                13);

            var profiles = GetRecentProfiles(4);
            var activeSlot = ResolveActiveProfileSlot(player.userID, profiles, draft);

            AddCuiText(
                container,
                contentPanel,
                "SAVED CLASSES (profiles) — Use loads spawn form, Respawn spawns from saved data",
                "0.02 0.322",
                "0.98 0.348",
                11,
                TextAnchor.MiddleLeft,
                "0.95 0.97 1 1");

            var pPanel = container.Add(
                new CuiPanel
                {
                    Image = { Color = "0.07 0.09 0.12 0.96" },
                    RectTransform = { AnchorMin = "0.02 0.02", AnchorMax = "0.98 0.312" },
                    CursorEnabled = true,
                },
                contentPanel);

            const float profileTopPad = 0.038f;
            const float profileRowH = 0.056f;
            for (var idx = 0; idx < 4; idx++)
            {
                var pr = idx < profiles.Count ? profiles[idx] : null;
                var rowActive = activeSlot == idx;
                var pyBot = profileTopPad + idx * profileRowH;
                var pyTop = pyBot + profileRowH - 0.005f;
                var aMin = $"0.02 {pyBot.ToString("F4", CultureInfo.InvariantCulture)}";
                var aMax = $"0.98 {pyTop.ToString("F4", CultureInfo.InvariantCulture)}";

                var prow = container.Add(
                    new CuiPanel
                    {
                        Image =
                        {
                            Color = rowActive ? "0.22 0.35 0.48 0.96" : "0.11 0.14 0.18 0.96",
                        },
                        RectTransform = { AnchorMin = aMin, AnchorMax = aMax },
                    },
                    pPanel);

                var titlePlain = pr == null
                    ? $"Class {idx + 1} — (empty slot)"
                    : $"Class {idx + 1} — {StripCuiMarkup(pr.ViewerName ?? "?")}";
                var subPlain = pr == null
                    ? "Spawn a bot once to fill this slot."
                    : $"ID {StripCuiMarkup(pr.ViewerId)} | T{pr.Tier} | {StripCuiMarkup(pr.Mode)} | {(pr.Alive ? "alive" : "dead")}";
                AddCuiText(
                    container,
                    prow,
                    titlePlain,
                    "0.02 0.42",
                    "0.62 0.98",
                    12,
                    TextAnchor.MiddleLeft,
                    "1 1 1 1");
                AddCuiText(
                    container,
                    prow,
                    subPlain,
                    "0.02 0.06",
                    "0.62 0.40",
                    10,
                    TextAnchor.MiddleLeft,
                    "0.8 0.85 0.92 1");

                var useCol = rowActive ? _cfg.Gui.AccentColor : "0.22 0.42 0.62 0.95";
                AddCuiButtonWithText(
                    container,
                    prow,
                    $"maxxinvaders.gui profslot {idx}",
                    useCol,
                    "Use",
                    "0.64 0.12",
                    "0.76 0.88",
                    11);
                AddCuiButtonWithText(
                    container,
                    prow,
                    pr != null ? $"maxxinvaders.gui profileload {pr.ViewerId}" : $"maxxinvaders.gui profslot {idx}",
                    "0.22 0.36 0.52 0.95",
                    "Load",
                    "0.77 0.12",
                    "0.87 0.88",
                    10);
                AddCuiButtonWithText(
                    container,
                    prow,
                    pr != null ? $"maxxinvaders.gui profilerespawn {pr.ViewerId}" : $"maxxinvaders.gui profslot {idx}",
                    "0.18 0.52 0.38 0.95",
                    "Respawn",
                    "0.88 0.12",
                    "0.98 0.88",
                    9);
            }

            CuiHelper.AddUi(player, container);
        }

        [ConsoleCommand("maxxinvaders.gui")]
        private void CmdGui(ConsoleSystem.Arg arg)
        {
            var player = arg.Connection?.player as BasePlayer;
            if (player == null) return;
            if (!CanAdmin(player)) return;

            var args = arg.Args;
            if (args == null || args.Length == 0) return;

            if (args[0] == "tab" && args.Length > 1 && int.TryParse(args[1], NumberStyles.Integer, CultureInfo.InvariantCulture,
                    out var tabIdx))
            {
                _guiMainTab[player.userID] = Mathf.Clamp(tabIdx, 0, 2);
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "cfgtoggle" && args.Length > 1)
            {
                ApplyGuiCfgToggle(args[1]);
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "cfgstr" && args.Length > 1)
            {
                var fld = args[1];
                var val = args.Length > 2 ? string.Join(" ", args.Skip(2).ToArray()) : "";
                ApplyGuiCfgStr(fld, val);
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "cfgnum" && args.Length > 1)
            {
                var fld = args[1];
                var val = args.Length > 2 ? string.Join(" ", args.Skip(2).ToArray()) : "";
                ApplyGuiCfgNum(fld, val);
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "roamtoggle" && args.Length > 1)
            {
                var key = string.Join(" ", args.Skip(1).ToArray()).Trim();
                if (RoamingNPCs != null && RoamingNPCs.IsLoaded && !string.IsNullOrEmpty(key))
                {
                    try
                    {
                        RoamingNPCs.Call("ToggleBridgeBotEnabled", key);
                    }
                    catch (Exception ex)
                    {
                        PrintWarning($"{LogPrefix} ToggleBridgeBotEnabled: {ex.Message}");
                    }
                }

                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "roampage" && args.Length > 1 &&
                int.TryParse(args[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var rp))
            {
                _guiRoamingKeyPage[player.userID] = Mathf.Max(0, rp);
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "draftreset")
            {
                _spawnDrafts[player.userID] = new SpawnDraft();
                _guiActiveProfileSlot.Remove(player.userID);
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "profslot" && args.Length > 1 &&
                int.TryParse(args[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var profSlot))
            {
                profSlot = Mathf.Clamp(profSlot, 0, 3);
                var profs = GetRecentProfiles(4);
                if (profSlot >= profs.Count)
                {
                    player.ChatMessage(
                        $"[MaxxInvaders] No profile in slot {profSlot + 1} yet (only {profs.Count} saved).");
                    OpenGui(player, GetGuiPage(player.userID));
                    return;
                }

                _guiActiveProfileSlot[player.userID] = profSlot;
                var dProf = GetSpawnDraft(player.userID);
                LoadProfileToDraft(dProf, profs[profSlot]);
                player.ChatMessage(
                    $"[MaxxInvaders] Spawn form uses slot {profSlot + 1}: {profs[profSlot].ViewerName}");
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "returnrun" && args.Length > 1)
            {
                var nid = args[1].Trim();
                if (!TryFindInvader(nid, out var rr))
                    player.ChatMessage("[MaxxInvaders] NPC not found.");
                else
                {
                    rr.AnchorPosition = player.transform.position;
                    rr.ReturnRunActive = true;
                    player.ChatMessage(
                        "[MaxxInvaders] Bot is pathing back to within 20m of you (not a teleport).");
                }

                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "ntmpl" && args.Length > 1)
            {
                var nid = args[1].Trim();
                var val = args.Length > 2 ? string.Join(" ", args.Skip(2).ToArray()) : "";
                SetGuiNpcTemplateField(player.userID, nid, val);
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "applytmpl" && args.Length > 1)
            {
                var nid = args[1].Trim();
                var key = GetGuiNpcTemplateField(player.userID, nid, null);
                if (string.IsNullOrWhiteSpace(key))
                {
                    player.ChatMessage(
                        $"[MaxxInvaders] Type a Roaming template key next to {nid}, then Apply again.");
                    OpenGui(player, GetGuiPage(player.userID));
                    return;
                }

                if (TryRespawnWithRoamingTemplate(player, nid, key, out var terr))
                    player.ChatMessage($"[MaxxInvaders] Respawned with template {key}.");
                else
                    player.ChatMessage($"[MaxxInvaders] Template change failed: {terr}");
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "quickdemo")
            {
                var vid = "demo_" + Random.Range(100000, 999999);
                var res = TrySpawn("DemoViewer", vid, 1, "", "roaming", player, "gui_quick");
                player.ChatMessage(res.Success
                    ? $"[MaxxInvaders] Spawned {res.NpcId}"
                    : $"[MaxxInvaders] Failed: {res.Error}");
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "spawnfields")
            {
                var d = GetSpawnDraft(player.userID);
                if (!int.TryParse(d.TierStr?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture,
                        out var tier))
                    tier = 1;
                var kit = d.Kit == "-" || string.IsNullOrWhiteSpace(d.Kit) ? "" : d.Kit.Trim();
                var mode = string.IsNullOrWhiteSpace(d.Mode) ? "roaming" : d.Mode.Trim().ToLowerInvariant();
                var name = string.IsNullOrWhiteSpace(d.ViewerName) ? "DemoViewer" : d.ViewerName.Trim();
                var vid = string.IsNullOrWhiteSpace(d.ViewerId)
                    ? "demo_" + Random.Range(100000, 999999)
                    : d.ViewerId.Trim();
                var res = TrySpawn(name, vid, tier, kit, mode, player, "gui");
                player.ChatMessage(res.Success
                    ? $"[MaxxInvaders] Spawned {res.NpcId}"
                    : $"[MaxxInvaders] Failed: {res.Error}");
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "applyattrs")
            {
                var d = GetSpawnDraft(player.userID);
                var key = d.RenameTarget?.Trim() ?? "";
                if (ApplyAttributesToActiveInternal(key, d, out var aerr))
                    player.ChatMessage("[MaxxInvaders] Applied attributes to active NPC.");
                else
                    player.ChatMessage($"[MaxxInvaders] Apply failed: {aerr}");
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "renameapply")
            {
                var d = GetSpawnDraft(player.userID);
                var key = d.RenameTarget?.Trim() ?? "";
                var newName = d.RenameName?.Trim() ?? "";
                if (RenameInvaderInternal(key, newName, out var renameErr))
                    player.ChatMessage("[MaxxInvaders] Renamed.");
                else
                    player.ChatMessage($"[MaxxInvaders] Rename failed: {renameErr}");
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "draft" && args.Length >= 2)
            {
                var field = args[1].ToLowerInvariant();
                var value = args.Length > 2 ? string.Join(" ", args.Skip(2).ToArray()) : "";
                var d = GetSpawnDraft(player.userID);
                switch (field)
                {
                    case "viewername":
                        d.ViewerName = string.IsNullOrEmpty(value) ? "DemoViewer" : value;
                        break;
                    case "viewerid":
                        d.ViewerId = string.IsNullOrWhiteSpace(value)
                            ? "demo_" + Guid.NewGuid().ToString("N").Substring(0, 8)
                            : value.Trim();
                        break;
                    case "tier":
                        d.TierStr = string.IsNullOrWhiteSpace(value) ? "1" : value.Trim();
                        break;
                    case "kit":
                        d.Kit = string.IsNullOrWhiteSpace(value) ? "-" : value.Trim();
                        break;
                    case "mode":
                        d.Mode = string.IsNullOrWhiteSpace(value) ? "roaming" : value.Trim().ToLowerInvariant();
                        break;
                    case "renametarget":
                        d.RenameTarget = string.IsNullOrWhiteSpace(value) ? "" : value.Trim();
                        break;
                    case "renamename":
                        d.RenameName = string.IsNullOrWhiteSpace(value) ? "" : value;
                        break;
                }
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "action" && args.Length > 1 && args[1] == "close")
            {
                CuiHelper.DestroyUi(player, UiName);
                LogIf(_cfg.Logging.LogGui, $"gui close {player.displayName}", false);
                return;
            }

            if (args[0] == "action" && args.Length > 1 && args[1] == "refresh")
            {
                var refreshPage = 0;
                if (_guiPage.TryGetValue(player.userID, out var savedPage)) refreshPage = savedPage;
                OpenGui(player, refreshPage);
                LogIf(_cfg.Logging.LogGui, $"gui refresh {player.displayName}", false);
                return;
            }

            if (args[0] == "page" && args.Length > 1 && int.TryParse(args[1], out var pageIndex))
            {
                OpenGui(player, pageIndex);
                return;
            }

            if (args[0] == "tp" && args.Length > 1)
            {
                var id = args[1];
                foreach (var r in _registry.All())
                {
                    if (r.NpcId != id) continue;
                    if (r.NpcPlayer != null && !r.NpcPlayer.IsDestroyed)
                        player.Teleport(r.NpcPlayer.transform.position);
                    break;
                }
                LogIf(_cfg.Logging.LogGui, $"gui tp {player.displayName} {id}", false);
                return;
            }

            if (args[0] == "renametarget" && args.Length > 1)
            {
                var id = args[1];
                var d = GetSpawnDraft(player.userID);
                d.RenameTarget = id;
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "profileload" && args.Length > 1)
            {
                var token = string.Join(" ", args.Skip(1).ToArray()).Trim();
                if (TryGetProfile(token, out var rec))
                {
                    var d = GetSpawnDraft(player.userID);
                    LoadProfileToDraft(d, rec);
                    var profs = GetRecentProfiles(4);
                    for (var pi = 0; pi < profs.Count; pi++)
                    {
                        if (!string.Equals(profs[pi].ViewerId, rec.ViewerId, StringComparison.OrdinalIgnoreCase))
                            continue;
                        _guiActiveProfileSlot[player.userID] = pi;
                        break;
                    }

                    player.ChatMessage($"[MaxxInvaders] Loaded profile for {rec.ViewerName}.");
                }
                else
                    player.ChatMessage("[MaxxInvaders] Profile not found.");
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "profilerespawn" && args.Length > 1)
            {
                var token = string.Join(" ", args.Skip(1).ToArray()).Trim();
                if (!TryGetProfile(token, out var rec))
                {
                    player.ChatMessage("[MaxxInvaders] Profile not found.");
                    OpenGui(player, GetGuiPage(player.userID));
                    return;
                }

                var kit = rec.KitName ?? "";
                var mode = string.IsNullOrWhiteSpace(rec.Mode) ? "roaming" : rec.Mode.Trim().ToLowerInvariant();
                var res = TrySpawn(rec.ViewerName, rec.ViewerId, rec.Tier, kit, mode, player, "profile_respawn");
                var profsR = GetRecentProfiles(4);
                for (var pi = 0; pi < profsR.Count; pi++)
                {
                    if (!string.Equals(profsR[pi].ViewerId, rec.ViewerId, StringComparison.OrdinalIgnoreCase))
                        continue;
                    _guiActiveProfileSlot[player.userID] = pi;
                    break;
                }

                player.ChatMessage(res.Success
                    ? $"[MaxxInvaders] Respawned {rec.ViewerName} ({res.NpcId})"
                    : $"[MaxxInvaders] Respawn failed: {res.Error}");
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "renamename" && args.Length > 1)
            {
                var id = args[1];
                var d = GetSpawnDraft(player.userID);
                foreach (var r in _registry.All())
                {
                    if (!string.Equals(r.NpcId, id, StringComparison.OrdinalIgnoreCase)) continue;
                    d.RenameName = r.ViewerName ?? "";
                    if (string.IsNullOrWhiteSpace(d.RenameTarget))
                        d.RenameTarget = r.NpcId;
                    break;
                }
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "kill" && args.Length > 1)
            {
                KillByNpcId(args[1], false);
                var afterKillPage = 0;
                if (_guiPage.TryGetValue(player.userID, out var killPage)) afterKillPage = killPage;
                OpenGui(player, afterKillPage);
                return;
            }

            if (args[0] == "despawn" && args.Length > 1)
            {
                KillByNpcId(args[1], true);
                var afterDespawnPage = 0;
                if (_guiPage.TryGetValue(player.userID, out var despawnPage)) afterDespawnPage = despawnPage;
                OpenGui(player, afterDespawnPage);
                return;
            }
        }

        #endregion

        #region API hooks for future relay

        /// <summary>Optional call from C# plugins: Interface.Call("SpawnInvader", name, id, tier, kit, mode).</summary>
        [HookMethod("SpawnInvader")]
        public object SpawnInvader(string viewerName, string viewerId, int tier, string kit, string mode) =>
            TrySpawn(viewerName, viewerId, tier, kit, mode, null, "api");

        [HookMethod("RemoveInvader")]
        public object RemoveInvader(string viewerId)
        {
            if (!_registry.TryGetByViewer(viewerId, out var r)) return false;
            DespawnInternal(r, "api_remove");
            return true;
        }

        /// <summary>Rename active invader by viewerId or npcId: Interface.Call("RenameInvader", "viewerIdOrNpcId", "New Name").</summary>
        [HookMethod("RenameInvader")]
        public object RenameInvader(string viewerIdOrNpcId, string newName)
        {
            return RenameInvaderInternal(viewerIdOrNpcId, newName, out _);
        }

        #endregion
    }

    internal static class VecExt
    {
        public static Vector3 Flatten(this Vector3 v)
        {
            v.y = 0;
            return v;
        }
    }
}
