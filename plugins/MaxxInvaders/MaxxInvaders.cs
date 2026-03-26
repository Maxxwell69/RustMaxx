// MaxxInvaders — RustMaxx viewer-linked NPC spawns (TikFinity / RCON / relay).
// Oxide plugin: optional RoamingNPCs bridge for full bot AI; otherwise vanilla scientists.
// Uses vanilla Scientist NPC prefabs + optional Kits. Behavior modes tune prefab + light tick steering.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using Oxide.Core;
using Oxide.Core.Plugins;
using Oxide.Game.Rust.Cui;
using Rust;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.UI;
using Random = UnityEngine.Random;

namespace Oxide.Plugins
{
    [Info("MaxxInvaders", "RustMaxx", "1.7.1")]
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
        private const string HudOverlayUiName = "MaxxInvaders.HudOverlay";
        private const int GuiSchemaCurrent = 2;

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
        private Timer _overlayTimer;
        private bool _debugRuntime;
        private readonly Dictionary<ulong, string> _lastHudContentByUser = new();
        /// <summary>Admin has main MaxxInvaders CUI open — hide right INVADERS overlay so it does not stack on the GUI.</summary>
        private readonly HashSet<ulong> _adminMainGuiOpen = new HashSet<ulong>();
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
            Subscribe(nameof(OnPlayerDisconnected));
        }

        private void OnPlayerDisconnected(BasePlayer player, string reason)
        {
            if (player == null) return;
            _lastHudContentByUser.Remove(player.userID);
            _adminMainGuiOpen.Remove(player.userID);
            CuiHelper.DestroyUi(player, HudOverlayUiName);
        }

        private void OnServerInitialized()
        {
            LoadDataFile();
            _debugRuntime = _cfg.DebugMode;
            _tickTimer = timer.Every(Mathf.Clamp(_cfg.BehaviorTickSeconds, 0.25f, 10f), BehaviorTick);
            if (_cfg.PersistIntervalSeconds > 0)
                _persistTimer = timer.Every(_cfg.PersistIntervalSeconds, () => SaveDataFile());
            _overlayTimer = timer.Every(0.35f, RefreshInvaderStreamerOverlays);
        }

        private void Unload()
        {
            _tickTimer?.Destroy();
            _persistTimer?.Destroy();
            _overlayTimer?.Destroy();
            foreach (var player in BasePlayer.activePlayerList)
            {
                CuiHelper.DestroyUi(player, UiName);
                CuiHelper.DestroyUi(player, HudOverlayUiName);
            }

            _spawnDrafts.Clear();
            _lastHudContentByUser.Clear();
            _adminMainGuiOpen.Clear();

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
            public float MinimumSpawnRadiusFromAnchor { get; set; } = 5f;
            public float DefaultSpawnRadius { get; set; } = 22f;
            public float MaxDistanceFromAnchor { get; set; } = 140f;
            public float MinimumDistanceFromPlayers { get; set; } = 8f;
            public bool BlockSpawnInSafeZones { get; set; } = true;
            public bool BlockSpawnInMonuments { get; set; } = true;
            public float DefaultLifetimeSeconds { get; set; } = 3600f;
            public float PerViewerCooldownSeconds { get; set; } = 30f;
            public int SpawnAttempts { get; set; } = 36;
            public float BehaviorTickSeconds { get; set; } = 1.5f;
            public bool DespawnOnUnload { get; set; } = true;
            public float PersistIntervalSeconds { get; set; } = 60f;

            /// <summary>
            /// When TikFinity/RCON omits the 7th <c>maxxinvaders.spawn</c> arg, use this Steam64 (online or sleeping) for
            /// spawn ring + RoamingNPCs bridge anchor — same effect as GUI spawn (admin = anchor). Matches RustMaxx "TikFinity patrol anchor" when set to the same id.
            /// </summary>
            public string DefaultAnchorSteamId { get; set; } = "";

            public bool ShouldSerializeDefaultAnchorSteamId() => !string.IsNullOrWhiteSpace(DefaultAnchorSteamId);

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
            /// When set, RoamingNPCs bot key for viewer-driven spawns (TikFinity/API, RCON <c>maxxinvaders.spawn</c>, chat,
            /// profile respawn). Use the dedicated <c>streamer_patrol</c> template for anchor patrol + protection (RoamingNPCs 0.5.8+).
            /// Empty falls back to per-tier <see cref="TierDefinition.RoamingTemplateKey"/> and <see cref="DefaultRoamingTemplateKey"/>.
            /// GUI spawns use <see cref="GuiSettings.SpawnRoamingTemplateKeys"/> slots.
            /// </summary>
            public string ViewerRoamingTemplateKey { get; set; } = "";

            public bool ShouldSerializeViewerRoamingTemplateKey() => !string.IsNullOrWhiteSpace(ViewerRoamingTemplateKey);

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

            /// <summary>Bump when new Gui defaults must apply to legacy configs (see EnsureConfigDefaults).</summary>
            public int GuiSchemaVersion { get; set; } = 2;

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

            /// <summary>MAXX INVADERS header font-size markup used in the main GUI.</summary>
            public int InvadersTitleSize { get; set; } = 18;

            /// <summary>Version text (<c>v{Version}</c>) font-size markup used in the main GUI.</summary>
            public int InvadersVersionSize { get; set; } = 11;

            /// <summary>Four RoamingNPCs.json bot keys for the Invaders spawn form selector (slots 1–4).</summary>
            public List<string> SpawnRoamingTemplateKeys { get; set; } = new()
            {
                "streamer_patrol",
                "bob_resources_farmer",
                "john_looter",
                "alfred_hunter",
            };

            /// <summary>Legacy config key; 3D overhead tags are disabled (HP/distance use INVADERS panel only).</summary>
            public bool ShowInvaderWorldTags { get; set; } = false;

            /// <summary>Right-side CUI list of alive invaders. Admin clients only.</summary>
            public bool ShowInvaderHudList { get; set; } = true;

            /// <summary>World tags only drawn when bot is within this distance (meters).</summary>
            public float InvaderWorldTagMaxDistance { get; set; } = 150f;
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
            if (_cfg.DefaultAnchorSteamId == null) _cfg.DefaultAnchorSteamId = "";
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
            if (_cfg.Gui.SpawnRoamingTemplateKeys == null || _cfg.Gui.SpawnRoamingTemplateKeys.Count == 0)
                _cfg.Gui.SpawnRoamingTemplateKeys = new List<string>(d.Gui.SpawnRoamingTemplateKeys);
            while (_cfg.Gui.SpawnRoamingTemplateKeys.Count < 4)
                _cfg.Gui.SpawnRoamingTemplateKeys.Add(
                    string.IsNullOrWhiteSpace(_cfg.DefaultRoamingTemplateKey)
                        ? "bob_resources_farmer"
                        : _cfg.DefaultRoamingTemplateKey.Trim());

            MigrateGuiSpawnRoamingTemplateKeys(new InvaderConfig());

            if (_cfg.GuiSchemaVersion < GuiSchemaCurrent)
            {
                if (_cfg.GuiSchemaVersion < 1)
                {
                    _cfg.Gui.ShowInvaderWorldTags = true;
                    _cfg.Gui.ShowInvaderHudList = true;
                    if (_cfg.Gui.InvaderWorldTagMaxDistance <= 0f)
                        _cfg.Gui.InvaderWorldTagMaxDistance = 150f;
                }

                if (_cfg.GuiSchemaVersion < 2)
                {
                    // NPC world nameplates do not parse rich-text color tags (literal text + truncation). HP/distance: INVADERS panel only.
                    _cfg.Gui.ShowInvaderWorldTags = false;
                }

                _cfg.GuiSchemaVersion = GuiSchemaCurrent;
            }

            // Font sizes: if user edits config manually and leaves 0/negative, restore defaults.
            if (_cfg.Gui.InvadersTitleSize <= 0) _cfg.Gui.InvadersTitleSize = d.Gui.InvadersTitleSize;
            if (_cfg.Gui.InvadersVersionSize <= 0) _cfg.Gui.InvadersVersionSize = d.Gui.InvadersVersionSize;

            _cfg.Gui.InvadersTitleSize = Mathf.Clamp(_cfg.Gui.InvadersTitleSize, 8, 40);
            _cfg.Gui.InvadersVersionSize = Mathf.Clamp(_cfg.Gui.InvadersVersionSize, 6, 28);
        }

        /// <summary>Ensure streamer_patrol appears in the Invaders GUI slot list (defaults + one-time migration).</summary>
        private void MigrateGuiSpawnRoamingTemplateKeys(InvaderConfig defaults)
        {
            var keys = _cfg.Gui?.SpawnRoamingTemplateKeys;
            if (keys == null || keys.Count == 0) return;

            var d = defaults.Gui?.SpawnRoamingTemplateKeys;
            if (d == null || d.Count < 4) return;

            bool SeqEqual(List<string> a, List<string> b)
            {
                if (a.Count != b.Count) return false;
                for (var i = 0; i < a.Count; i++)
                    if (!string.Equals(a[i]?.Trim(), b[i]?.Trim(), StringComparison.OrdinalIgnoreCase))
                        return false;
                return true;
            }

            var legacy = new List<string>
            {
                "bob_resources_farmer",
                "john_looter",
                "alfred_hunter",
                "austin_fighter",
            };
            if (SeqEqual(keys, legacy))
            {
                _cfg.Gui.SpawnRoamingTemplateKeys = new List<string>(d);
                return;
            }

            if (keys.Any(k => string.Equals(k?.Trim(), "streamer_patrol", StringComparison.OrdinalIgnoreCase)))
                return;

            keys.Insert(0, "streamer_patrol");
            while (keys.Count > 4)
                keys.RemoveAt(keys.Count - 1);
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
            /// <summary>When non-zero, <see cref="AnchorPosition"/> is refreshed each behavior tick from this player (streamer patrol / webhook anchor).</summary>
            public ulong AnchorSteamId;
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

        /// <summary>Viewer/API/RCON/chat/profile use ViewerRoamingTemplateKey when set; GUI passes an explicit override.</summary>
        private static bool IsViewerPipelineSpawnSource(string source)
        {
            if (string.IsNullOrEmpty(source)) return false;
            return source is "api" or "console" or "chat" or "profile_respawn";
        }

        private string ResolveRoamingTemplateForSpawn(string roamingTemplateOverride, TierDefinition tierDef, string source)
        {
            if (!string.IsNullOrWhiteSpace(roamingTemplateOverride))
                return roamingTemplateOverride.Trim();
            if (!string.IsNullOrWhiteSpace(_cfg.ViewerRoamingTemplateKey) && IsViewerPipelineSpawnSource(source))
                return _cfg.ViewerRoamingTemplateKey.Trim();
            return ResolveRoamingTemplateKey(tierDef);
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

            viewerName = viewerName.Trim();
            if (IsUnexpandedWebhookPlaceholder(viewerName))
                viewerName = "Viewer";

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

            anchorPlayer = ResolveAnchorForSpawn(anchorPlayer);

            if (!TryFindSpawnPosition(anchorPlayer, out var pos))
                return SpawnResult.Fail("spawn_position");

            BasePlayer npcPlayer = null;
            var isRoaming = false;
            var roamingTemplate = ResolveRoamingTemplateForSpawn(roamingTemplateOverride, tierDef, source);

            if (_cfg.UseRoamingNPCsWhenAvailable && RoamingNPCs != null && RoamingNPCs.IsLoaded &&
                !string.IsNullOrEmpty(roamingTemplate))
            {
                try
                {
                    ulong anchorSteam = 0UL;
                    if (anchorPlayer != null)
                        anchorSteam = anchorPlayer.userID;
                    var ro = RoamingNPCs.Call("SpawnFromTemplateForBridge", roamingTemplate, viewerName, viewerId,
                        anchorSteam);
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
                AnchorSteamId = anchorPlayer != null && anchorPlayer.IsValid() ? anchorPlayer.userID : 0UL,
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

        /// <summary>
        /// Teleport an invader NPC to a horizontal ring around the admin (navmesh-safe). Used by GUI TP / TP ALL.
        /// </summary>
        private static bool TryTeleportNpcToAdmin(BasePlayer npcPlayer, BasePlayer admin, float radiusMeters,
            float angleRadians)
        {
            if (npcPlayer == null || npcPlayer.IsDestroyed || admin == null || !admin.IsValid()) return false;
            var center = admin.transform.position;
            var flat = new Vector3(Mathf.Cos(angleRadians), 0f, Mathf.Sin(angleRadians));
            var tryPos = center + flat * radiusMeters;
            tryPos.y = TerrainMeta.HeightMap.GetHeight(tryPos);
            if (!ResolveNavMeshPosition(tryPos, out tryPos))
            {
                tryPos = center + flat * (radiusMeters + 1.75f);
                tryPos.y = TerrainMeta.HeightMap.GetHeight(tryPos);
                if (!ResolveNavMeshPosition(tryPos, out tryPos)) return false;
            }

            try
            {
                npcPlayer.Teleport(tryPos);
                if (ResolveNavMeshPosition(npcPlayer.transform.position, out var after))
                    npcPlayer.Teleport(after);
            }
            catch
            {
                return false;
            }

            return true;
        }

        /// <summary>Place all alive invaders on a circle around the admin so they do not stack.</summary>
        private int TeleportAllInvadersToAdmin(BasePlayer admin)
        {
            if (admin == null || !admin.IsValid()) return 0;
            var bots = _registry.All()
                .Where(r => r.NpcPlayer != null && !r.NpcPlayer.IsDestroyed)
                .OrderBy(r => r.NpcId, StringComparer.OrdinalIgnoreCase)
                .ToList();
            var n = bots.Count;
            if (n == 0) return 0;
            // Arc length ~2πr/n — scale radius so neighbors stay ~1.5m+ apart on the ring.
            var radius = Mathf.Max(2.1f, 0.28f * n);
            // If the computed ring can't be placed on navmesh (common in areas with sparse navmesh),
            // fall back to tighter rings close to the admin so tpall still moves bots.
            var attemptRadii = new float[]
            {
                radius,
                Mathf.Max(2.1f, radius * 0.6f),
                2.35f
            };
            var moved = 0;
            for (var i = 0; i < n; i++)
            {
                var ang = (2f * Mathf.PI * i / n) + Random.Range(-0.06f, 0.06f);
                foreach (var r in attemptRadii)
                {
                    if (TryTeleportNpcToAdmin(bots[i].NpcPlayer, admin, r, ang))
                    {
                        moved++;
                        break;
                    }
                }
            }

            return moved;
        }

        /// <summary>GUI passes the admin as anchor; RCON/webhook often omit the 7th arg — optional <see cref="InvaderConfig.DefaultAnchorSteamId"/>.</summary>
        private BasePlayer ResolveAnchorForSpawn(BasePlayer explicitAnchor)
        {
            if (explicitAnchor != null && explicitAnchor.IsValid())
                return explicitAnchor;
            if (string.IsNullOrWhiteSpace(_cfg.DefaultAnchorSteamId)) return null;
            if (!ulong.TryParse(_cfg.DefaultAnchorSteamId.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture,
                    out var steam) || steam < 10000000000000000UL)
                return null;
            return FindPlayerOrSleeperByUserId(steam);
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

        /// <summary>RCON/webhook anchor: online player or sleeping body so spawn + leash use their position.</summary>
        private static BasePlayer FindPlayerOrSleeperByUserId(ulong userId)
        {
            foreach (var p in BasePlayer.activePlayerList)
                if (p != null && p.userID == userId)
                    return p;
            foreach (var p in BasePlayer.sleepingPlayerList)
                if (p != null && p.userID == userId)
                    return p;
            return null;
        }

        /// <param name="excludeUserId">Anchor streamer — ignored so viewer bots can spawn a few meters from you.</param>
        private static bool TooCloseToPlayers(Vector3 pos, float minDist, ulong excludeUserId = 0UL)
        {
            var sq = minDist * minDist;
            foreach (var pl in BasePlayer.activePlayerList)
            {
                if (pl == null || !pl.IsValid() || pl.IsNpc) continue;
                if (excludeUserId != 0UL && pl.userID == excludeUserId) continue;
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
            var attacker = info.InitiatorPlayer as BasePlayer ?? info.Initiator as BasePlayer;
            if (attacker == null || !attacker.IsNpc) return null;
            if (!_registry.TryGetByEntity(attacker.net.ID.Value, out var r)) return null;
            // Never damage the streamer anchor (even in hostile / scientist aggro).
            if (r.AnchorSteamId != 0UL && victim.userID == r.AnchorSteamId)
                return true;
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
                UpdateInvaderNameplateDisplay(r);

                // Move leash center with streamer/base anchor (RCON webhook + GUI spawns with anchor player).
                if (r.AnchorSteamId != 0UL)
                {
                    var ap = FindPlayerOrSleeperByUserId(r.AnchorSteamId);
                    if (ap != null && ap.IsValid())
                        r.AnchorPosition = ap.transform.position;
                }

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

                // Keep NPCs inside streamer-centered radius (anchor follows AnchorSteamId when set).
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
                        SteerTowardNearestPlayer(sci, 80f, true, r.AnchorSteamId);
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

        private void SteerTowardNearestPlayer(ScientistNPC npc, float range, bool aggressive, ulong excludeSteamId = 0UL)
        {
            BasePlayer best = null;
            var bestD = range * range;
            var o = npc.transform.position;
            foreach (var p in BasePlayer.activePlayerList)
            {
                if (p == null || !p.IsValid() || p.IsNpc || p.IsSleeping()) continue;
                if (excludeSteamId != 0UL && p.userID == excludeSteamId) continue;
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
                    "Usage: maxxinvaders.spawn <viewerName> <viewerId> <tier> <kitName|-> <mode> [roamingTemplateKey] [anchorSteam64]");
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
            var roamingTemplateOverride = parts.Count >= 6 && !string.IsNullOrWhiteSpace(parts[5])
                ? parts[5].Trim()
                : null;

            BasePlayer anchorPlayer = null;
            if (parts.Count >= 7 && !string.IsNullOrWhiteSpace(parts[6]))
            {
                var rawAnchor = parts[6].Trim();
                if (!ulong.TryParse(rawAnchor, NumberStyles.Integer, CultureInfo.InvariantCulture, out var anchorSteam) ||
                    anchorSteam < 10000UL)
                {
                    arg.ReplyWith("Error: invalid_anchor_steam (expect 17-digit Steam64)");
                    return;
                }

                anchorPlayer = FindPlayerOrSleeperByUserId(anchorSteam);
                if (anchorPlayer == null)
                {
                    arg.ReplyWith(
                        $"Error: anchor_offline (no active or sleeping player for Steam64 {anchorSteam})");
                    return;
                }
            }

            var result = TrySpawn(viewerName, viewerId, tier, kit, mode, anchorPlayer, "console", roamingTemplateOverride);
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
                    "Usage: /maxxinvaders ui | maxx | roaming | anchor <Steam64> | list | spawn | …");
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
                case "anchor":
                    if (!CanAdmin(player))
                    {
                        player.ChatMessage("Requires maxxinvaders.admin.");
                        return;
                    }

                    if (args.Length < 2)
                    {
                        player.ChatMessage(
                            string.IsNullOrWhiteSpace(_cfg.DefaultAnchorSteamId)
                                ? "DefaultAnchorSteamId is empty. Usage: /maxxinvaders anchor <17-digit Steam64>  |  /maxxinvaders anchor clear"
                                : $"DefaultAnchorSteamId = {_cfg.DefaultAnchorSteamId}  |  /maxxinvaders anchor <Steam64>  |  anchor clear");
                        return;
                    }

                    var anchorArg = args[1].Trim();
                    if (anchorArg.Equals("clear", StringComparison.OrdinalIgnoreCase))
                    {
                        _cfg.DefaultAnchorSteamId = "";
                        SaveConfig();
                        player.ChatMessage("[MaxxInvaders] DefaultAnchorSteamId cleared. Saved.");
                        return;
                    }

                    if (ulong.TryParse(anchorArg, NumberStyles.Integer, CultureInfo.InvariantCulture, out var steamId) &&
                        steamId >= 10000000000000000UL)
                    {
                        _cfg.DefaultAnchorSteamId = anchorArg;
                        SaveConfig();
                        player.ChatMessage($"[MaxxInvaders] DefaultAnchorSteamId set to {anchorArg}. Saved.");
                    }
                    else
                        player.ChatMessage("[MaxxInvaders] Invalid Steam64 (expect 17 digits).");
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
            if (IsUnexpandedWebhookPlaceholder(s)) return null;
            if (s.Length > 24) s = s.Substring(0, 24);
            return string.IsNullOrWhiteSpace(s) ? null : s;
        }

        /// <summary>TikFinity sometimes sends literal tokens if the action URL/body did not substitute variables.</summary>
        private static bool IsUnexpandedWebhookPlaceholder(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return false;
            var t = s.Trim();
            return t.Equals("%nickname%", StringComparison.OrdinalIgnoreCase) ||
                   t.Equals("%username%", StringComparison.OrdinalIgnoreCase) ||
                   t.Equals("%displayname%", StringComparison.OrdinalIgnoreCase) ||
                   t.Equals("%name%", StringComparison.OrdinalIgnoreCase) ||
                   t.Equals("{nickname}", StringComparison.OrdinalIgnoreCase) ||
                   t.Equals("{username}", StringComparison.OrdinalIgnoreCase);
        }

        private static string ResolveViewerNameForWorldTag(InvaderRuntime r)
        {
            if (r == null) return "?";
            var vn = r.ViewerName?.Trim();
            if (!string.IsNullOrWhiteSpace(vn) && !IsUnexpandedWebhookPlaceholder(vn))
                return vn;
            return string.IsNullOrWhiteSpace(r.NpcId) ? "?" : r.NpcId;
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

        #region Streamer HUD overlays

        private void RefreshInvaderStreamerOverlays()
        {
            if (_cfg == null || !_cfg.EnablePlugin) return;
            var bots = _registry.All()
                .Where(r => r.NpcPlayer != null && !r.NpcPlayer.IsDestroyed)
                .OrderBy(r => r.NpcId, StringComparer.OrdinalIgnoreCase)
                .ToList();

            foreach (var player in BasePlayer.activePlayerList)
            {
                if (player == null || player.IsNpc || player.IsDestroyed) continue;
                if (!CanAdmin(player)) continue;

                if (_adminMainGuiOpen.Contains(player.userID))
                {
                    _lastHudContentByUser.Remove(player.userID);
                    CuiHelper.DestroyUi(player, HudOverlayUiName);
                }
                else if (_cfg.Gui.ShowInvaderHudList)
                {
                    // Right-side INVADERS list overlaps Rust's loot / NPC inventory UI — hide while loot is open.
                    if (IsPlayerLootInventoryUiOpen(player))
                    {
                        _lastHudContentByUser.Remove(player.userID);
                        CuiHelper.DestroyUi(player, HudOverlayUiName);
                    }
                    else
                    {
                        UpdateInvaderHudPanel(player, bots);
                    }
                }
                else
                {
                    _lastHudContentByUser.Remove(player.userID);
                    CuiHelper.DestroyUi(player, HudOverlayUiName);
                }
            }
        }

        /// <summary>True while the player has the loot panel open (own inventory + looting another entity / PNPC, etc.).</summary>
        private static bool IsPlayerLootInventoryUiOpen(BasePlayer player)
        {
            try
            {
                var loot = player?.inventory?.loot;
                if (loot == null) return false;
                if (loot.entitySource != null) return true;
                return loot.containers != null && loot.containers.Count > 0;
            }
            catch
            {
                return false;
            }
        }

        private void UpdateInvaderHudPanel(BasePlayer player, List<InvaderRuntime> bots)
        {
            var sb = new StringBuilder(256);
            if (bots.Count == 0)
                sb.Append("<size=10><color=#8899aa>No active invaders</color></size>");
            else
            {
                foreach (var r in bots)
                {
                    var npc = r.NpcPlayer;
                    var dist = Vector3.Distance(player.transform.position, npc.transform.position);
                    var hpPct = GetHealthPercentDisplay(npc);
                    var nm = StripCuiMarkup(ResolveViewerNameForWorldTag(r));
                    sb.Append("<color=#ffee55>");
                    sb.Append(nm);
                    sb.Append("</color> - <color=#55ff88>");
                    sb.Append(hpPct.ToString("F0", CultureInfo.InvariantCulture));
                    sb.Append("%</color> - <color=#ffffff>");
                    sb.Append(dist.ToString("F0", CultureInfo.InvariantCulture));
                    sb.Append(" m</color>\n");
                }
            }

            var body = sb.ToString().TrimEnd();
            if (_lastHudContentByUser.TryGetValue(player.userID, out var last) && last == body)
                return;
            _lastHudContentByUser[player.userID] = body;

            CuiHelper.DestroyUi(player, HudOverlayUiName);
            var container = new CuiElementContainer();
            var root = container.Add(
                new CuiPanel
                {
                    Image = { Color = "0.05 0.06 0.08 0.82" },
                    RectTransform = { AnchorMin = "0.72 0.28", AnchorMax = "0.992 0.72" },
                    CursorEnabled = false,
                },
                "Overlay",
                HudOverlayUiName);
            container.Add(
                new CuiLabel
                {
                    Text =
                    {
                        Text =
                            $"<size=12><color=#ccddee><b>INVADERS</b></color></size>\n<size=9><color=#8899aa>name — HP% — distance</color></size>\n\n{body}",
                        FontSize = 11,
                        Align = TextAnchor.UpperLeft,
                    },
                    RectTransform = { AnchorMin = "0.03 0.03", AnchorMax = "0.97 0.97" },
                },
                root);
            CuiHelper.AddUi(player, container);
        }

        private static float GetHealthPercentDisplay(BasePlayer npc)
        {
            if (npc == null) return 0f;
            var mh = npc.MaxHealth();
            if (mh <= 0.001f) return Mathf.Clamp(npc.health, 0f, 100f);
            return Mathf.Clamp01(npc.health / mh) * 100f;
        }

        /// <summary>
        /// NPC <see cref="BasePlayer.displayName"/> does not support Unity rich text (tags show as literal garbled text). Plain name only; HP% and distance are in the INVADERS HUD panel.
        /// </summary>
        private void UpdateInvaderNameplateDisplay(InvaderRuntime r)
        {
            if (r?.NpcPlayer == null || r.NpcPlayer.IsDestroyed) return;
            var vn = NormalizeViewerName(r.ViewerName);
            if (string.IsNullOrEmpty(vn)) vn = r.ViewerName?.Trim();
            if (string.IsNullOrEmpty(vn) || IsUnexpandedWebhookPlaceholder(vn)) return;
            var safe = StripCuiMarkupForNameplate(vn);
            if (string.IsNullOrEmpty(safe)) return;
            if (r.IsRoamingNpc)
                r.NpcPlayer.displayName = safe;
            else
                r.NpcPlayer.displayName = $"[Invader] {safe}";
        }

        private static string StripCuiMarkupForNameplate(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("<", "").Replace(">", "").Trim();
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

        private static void AddCuiInputFieldPlain(
            CuiElementContainer container,
            string parent,
            string command,
            string initialText,
            string anchorMin,
            string anchorMax,
            int fontSize = 14,
            int charsLimit = 64)
        {
            AddRawCuiElement(
                container,
                new CuiElement
                {
                    Name = Guid.NewGuid().ToString("N"),
                    Parent = parent,
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
                        new CuiRectTransformComponent { AnchorMin = anchorMin, AnchorMax = anchorMax },
                    },
                });
        }

        private readonly Dictionary<ulong, int> _guiPage = new();
        /// <summary>0 = invaders, 1 = edit MaxxInvaders.json, 2 = RoamingNPCs bot toggles.</summary>
        private readonly Dictionary<ulong, int> _guiMainTab = new();

        private readonly Dictionary<ulong, int> _guiRoamingKeyPage = new();

        /// <summary>Roaming tab: which bot template key is selected for bool toggles.</summary>
        private readonly Dictionary<ulong, string> _guiRoamingSelectedKey = new();

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
            /// <summary>In-game bot display name for spawn; empty uses <see cref="ViewerName"/>.</summary>
            public string BotName = "";

            public string ViewerName = "DemoViewer";
            public string ViewerId;
            public string TierStr = "1";
            public string Kit = "-";
            public string Mode = "roaming";
            public string RenameTarget = "";
            public string RenameName = "";

            /// <summary>0–3: index into <see cref="GuiSettings.SpawnRoamingTemplateKeys"/>.</summary>
            public int RoamingTemplateSlot;

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
                case "ShowInvaderHudList":
                    _cfg.Gui.ShowInvaderHudList = !_cfg.Gui.ShowInvaderHudList;
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
            else if (field == nameof(InvaderConfig.ViewerRoamingTemplateKey))
            {
                _cfg.ViewerRoamingTemplateKey = value;
                SaveConfig();
            }
            else if (field == nameof(InvaderConfig.DefaultAnchorSteamId))
            {
                if (string.IsNullOrWhiteSpace(value))
                {
                    _cfg.DefaultAnchorSteamId = "";
                    SaveConfig();
                    return;
                }

                var t = value.Trim();
                if (ulong.TryParse(t, NumberStyles.Integer, CultureInfo.InvariantCulture, out var steam) &&
                    steam >= 10000000000000000UL)
                {
                    _cfg.DefaultAnchorSteamId = t;
                    SaveConfig();
                }
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
                "<size=17><color=#d62828>MAXX SETTINGS</color></size>\n<size=10><color=#8899aa>Writes oxide/config/MaxxInvaders.json — scroll below</color></size>",
                "0.03 0.90",
                "0.97 0.99",
                12,
                TextAnchor.UpperLeft,
                "0.95 0.97 1 1");

            container.Add(
                new CuiLabel
                {
                    Text =
                    {
                        Text =
                            "Access: /migrate-to-skills | /maxxinvaders maxx | roaming | anchor <Steam64>",
                        FontSize = 7,
                        Align = TextAnchor.LowerLeft,
                        Color = "0.65 0.72 0.78 1",
                    },
                    RectTransform = { AnchorMin = "0.02 0.02", AnchorMax = "0.98 0.048" },
                },
                panel);

            var scrollHostName = Guid.NewGuid().ToString("N");
            container.Add(
                new CuiPanel
                {
                    Image = { Color = "0.06 0.07 0.09 0.55" },
                    RectTransform = { AnchorMin = "0.02 0.055", AnchorMax = "0.985 0.885" },
                    CursorEnabled = true,
                },
                panel,
                scrollHostName);

            const int contentH = 1520;
            var panelSize = -contentH;
            var scrollerName = Guid.NewGuid().ToString("N");
            AddRawCuiElement(
                container,
                new CuiElement
                {
                    Name = scrollerName,
                    Parent = scrollHostName,
                    Components =
                    {
                        new CuiNeedsCursorComponent(),
                        new CuiImageComponent
                        {
                            Color = "0.07 0.08 0.10 0.35",
                            Sprite = "Assets/Content/UI/UI.Background.Tile.psd",
                            ImageType = Image.Type.Tiled,
                        },
                        new CuiScrollViewComponent
                        {
                            ContentTransform = new CuiRectTransform
                            {
                                AnchorMin = "0 0.98",
                                AnchorMax = "1 0.98",
                                OffsetMin = $"0 {panelSize}",
                                OffsetMax = "0 0",
                            },
                            Vertical = true,
                            Horizontal = false,
                            MovementType = ScrollRect.MovementType.Clamped,
                            Elasticity = 0.2f,
                            Inertia = true,
                            DecelerationRate = 0.3f,
                            ScrollSensitivity = 28f,
                            VerticalScrollbar = new CuiScrollbar { AutoHide = true, Size = 18 },
                        },
                        new CuiRectTransformComponent { AnchorMin = "0 0", AnchorMax = "1 1" },
                    },
                });

            var inner = Guid.NewGuid().ToString("N");
            AddRawCuiElement(
                container,
                new CuiElement
                {
                    Name = inner,
                    Parent = scrollerName,
                    Components =
                    {
                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 1",
                            AnchorMax = "1 1",
                            OffsetMin = "8 -1500",
                            OffsetMax = "-8 0",
                        },
                    },
                });

            float y = 0.995f;
            void RowLabel(string text, float h = 0.034f)
            {
                container.Add(
                    new CuiLabel
                    {
                        Text = { Text = text, FontSize = 10, Align = TextAnchor.MiddleLeft, Color = "0.9 0.92 0.96 1" },
                        RectTransform = { AnchorMin = $"0.03 {y - h}", AnchorMax = $"0.97 {y}" },
                    },
                    inner);
                y -= h + 0.006f;
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
                    inner);
                AddCuiButtonWithText(
                    container,
                    inner,
                    $"maxxinvaders.gui cfgtoggle {fieldName}",
                    "0.72 0.14 0.10 0.92",
                    "Toggle",
                    $"0.73 {y - 0.032f}",
                    $"0.97 {y}",
                    10);
                y -= 0.042f;
            }

            void RowNum(string label, string field, string display)
            {
                container.Add(
                    new CuiLabel
                    {
                        Text = { Text = label, FontSize = 9, Align = TextAnchor.LowerLeft },
                        RectTransform = { AnchorMin = $"0.03 {y - 0.02f}", AnchorMax = $"0.35 {y}" },
                    },
                    inner);
                AddRawCuiElement(
                    container,
                    new CuiElement
                    {
                        Name = Guid.NewGuid().ToString("N"),
                        Parent = inner,
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
                y -= 0.046f;
            }

            RowLabel("<b>Options</b>", 0.028f);
            RowToggle("UseRoamingNPCsWhenAvailable", _cfg.UseRoamingNPCsWhenAvailable,
                nameof(InvaderConfig.UseRoamingNPCsWhenAvailable));
            RowToggle("PreventDuplicateViewerNPCs", _cfg.PreventDuplicateViewerNPCs,
                nameof(InvaderConfig.PreventDuplicateViewerNPCs));
            RowToggle("BlockSpawnInSafeZones", _cfg.BlockSpawnInSafeZones, nameof(InvaderConfig.BlockSpawnInSafeZones));
            RowToggle("BlockSpawnInMonuments", _cfg.BlockSpawnInMonuments,
                nameof(InvaderConfig.BlockSpawnInMonuments));
            RowToggle("DespawnOnUnload", _cfg.DespawnOnUnload, nameof(InvaderConfig.DespawnOnUnload));

            RowLabel("<b>Streamer HUD</b> (maxxinvaders.admin)", 0.028f);
            AddCuiText(
                container,
                inner,
                "<size=9><color=#8899aa>Name above bot = plain text. HP% and distance: INVADERS panel (no 3D overhead).</color></size>",
                $"0.03 {y - 0.034f}",
                $"0.97 {y}",
                9,
                TextAnchor.LowerLeft,
                "0.7 0.76 0.86 1");
            y -= 0.038f;
            RowToggle("ShowInvaderHudList (right INVADERS panel)", _cfg.Gui.ShowInvaderHudList, "ShowInvaderHudList");

            RowLabel("<b>Webhook / RCON default anchor</b>", 0.026f);
            container.Add(
                new CuiLabel
                {
                    Text =
                    {
                        Text =
                            "DefaultAnchorSteamId — if spawn has no 7th RCON arg (/maxxinvaders anchor …)",
                        FontSize = 8,
                        Align = TextAnchor.LowerLeft,
                        Color = "0.72 0.78 0.88 1",
                    },
                    RectTransform = { AnchorMin = $"0.03 {y - 0.022f}", AnchorMax = $"0.97 {y}" },
                },
                inner);
            y -= 0.028f;
            container.Add(
                new CuiLabel
                {
                    Text = { Text = "Steam64", FontSize = 9, Align = TextAnchor.LowerLeft },
                    RectTransform = { AnchorMin = $"0.03 {y - 0.02f}", AnchorMax = $"0.35 {y}" },
                },
                inner);
            AddRawCuiElement(
                container,
                new CuiElement
                {
                    Name = Guid.NewGuid().ToString("N"),
                    Parent = inner,
                    Components =
                    {
                        new CuiInputFieldComponent
                        {
                            Align = TextAnchor.MiddleLeft,
                            CharsLimit = 22,
                            Command = $"maxxinvaders.gui cfgstr {nameof(InvaderConfig.DefaultAnchorSteamId)} ",
                            FontSize = 12,
                            IsPassword = false,
                            Text = _cfg.DefaultAnchorSteamId ?? "",
                            NeedsKeyboard = true,
                        },
                        new CuiRectTransformComponent { AnchorMin = $"0.36 {y - 0.038f}", AnchorMax = $"0.97 {y}" },
                    },
                });
            y -= 0.046f;

            container.Add(
                new CuiLabel
                {
                    Text = { Text = "DefaultRoamingTemplateKey", FontSize = 9, Align = TextAnchor.LowerLeft },
                    RectTransform = { AnchorMin = $"0.03 {y - 0.02f}", AnchorMax = $"0.35 {y}" },
                },
                inner);
            AddRawCuiElement(
                container,
                new CuiElement
                {
                    Name = Guid.NewGuid().ToString("N"),
                    Parent = inner,
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
            y -= 0.046f;

            container.Add(
                new CuiLabel
                {
                    Text =
                    {
                        Text = "ViewerRoamingTemplateKey (e.g. streamer_patrol; empty = tier + default)",
                        FontSize = 9,
                        Align = TextAnchor.LowerLeft,
                    },
                    RectTransform = { AnchorMin = $"0.03 {y - 0.02f}", AnchorMax = $"0.35 {y}" },
                },
                inner);
            AddRawCuiElement(
                container,
                new CuiElement
                {
                    Name = Guid.NewGuid().ToString("N"),
                    Parent = inner,
                    Components =
                    {
                        new CuiInputFieldComponent
                        {
                            Align = TextAnchor.MiddleLeft,
                            CharsLimit = 64,
                            Command = $"maxxinvaders.gui cfgstr {nameof(InvaderConfig.ViewerRoamingTemplateKey)} ",
                            FontSize = 12,
                            IsPassword = false,
                            Text = _cfg.ViewerRoamingTemplateKey ?? "",
                            NeedsKeyboard = true,
                        },
                        new CuiRectTransformComponent { AnchorMin = $"0.36 {y - 0.038f}", AnchorMax = $"0.97 {y}" },
                    },
                });
            y -= 0.046f;

            RowLabel("<b>Spawn / caps</b>", 0.028f);
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
        }

        private void AddRoamingBotsEditor(CuiElementContainer container, string panel, BasePlayer player)
        {
            AddCuiText(
                container,
                panel,
                "<size=18><color=#d62828>ROAMING NPCs</color></size>\n<size=12><color=#8899aa>Pick a bot key → toggle every bool in RoamingNPCs.json for that template (scroll).</color></size>",
                "0.02 0.88",
                "0.98 0.99",
                12,
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
                            FontSize = 12,
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
                                "Bridge API missing on this RoamingNPCs build. Replace oxide/plugins/RoamingNPCs.cs with the latest from RustMaxx repo, then oxide.reload RoamingNPCs.",
                            FontSize = 11,
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
                            FontSize = 11,
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
                        Text = { Text = "No bot templates in RoamingNPCs.json (Bots settings).", FontSize = 12 },
                        RectTransform = { AnchorMin = "0.03 0.04", AnchorMax = "0.97 0.85" },
                    },
                    panel);
                return;
            }

            _guiRoamingSelectedKey.TryGetValue(player.userID, out var selRaw);
            var canonKey = keys.FirstOrDefault(k => string.Equals(k, selRaw, StringComparison.OrdinalIgnoreCase)) ??
                           keys[0];
            _guiRoamingSelectedKey[player.userID] = canonKey;
            var sel = canonKey;

            const int perPage = 6;
            var page = GetRoamingKeyPage(player.userID);
            var totalPages = Math.Max(1, (int)Math.Ceiling(keys.Count / (float)perPage));
            page = Mathf.Clamp(page, 0, totalPages - 1);
            _guiRoamingKeyPage[player.userID] = page;

            var slice = keys.Skip(page * perPage).Take(perPage).ToList();

            AddCuiText(
                container,
                panel,
                $"Editing: {StripCuiMarkup(sel)}  —  all bool fields (nested) for this bot",
                "0.02 0.805",
                "0.98 0.845",
                12,
                TextAnchor.MiddleLeft,
                "0.85 0.92 1 1");

            container.Add(
                new CuiLabel
                {
                    Text = { Text = $"Keys {page + 1}/{totalPages}  ({keys.Count} total)", FontSize = 11, Color = "0.85 0.88 0.92 1" },
                    RectTransform = { AnchorMin = "0.02 0.755", AnchorMax = "0.5 0.795" },
                },
                panel);

            if (page > 0)
                AddCuiButtonWithText(
                    container,
                    panel,
                    $"maxxinvaders.gui roampage {page - 1}",
                    "0.14 0.14 0.16 0.95",
                    "Prev",
                    "0.52 0.755",
                    "0.60 0.795",
                    9,
                    TextAnchor.MiddleCenter,
                    "0.95 0.97 1 1");

            if (page < totalPages - 1)
                AddCuiButtonWithText(
                    container,
                    panel,
                    $"maxxinvaders.gui roampage {page + 1}",
                    "0.14 0.14 0.16 0.95",
                    "Next",
                    "0.61 0.755",
                    "0.74 0.795",
                    11,
                    TextAnchor.MiddleCenter,
                    "0.95 0.97 1 1");

            var rowH = 0.038f;
            var ry = 0.718f;
            foreach (var key in slice)
            {
                var st = "?";
                try
                {
                    var ready = NormalizeBridgeCallResult(RoamingNPCs.Call("IsBridgeTemplateReady", key));
                    if (ready == "ok") st = "ok";
                    else if (ready == "disabled") st = "off";
                    else if (ready == "missing") st = "no cfg";
                    else st = string.IsNullOrEmpty(ready) ? "?" : ready;
                }
                catch
                {
                    st = "?";
                }

                var yb = ry - rowH;
                var isSel = string.Equals(key, sel, StringComparison.OrdinalIgnoreCase);
                var keyDisp = TruncateGui(key, 20);
                AddCuiText(
                    container,
                    panel,
                    (isSel ? "► " : "") + keyDisp,
                    $"0.03 {yb.ToString("F4", CultureInfo.InvariantCulture)}",
                    $"0.36 {ry.ToString("F4", CultureInfo.InvariantCulture)}",
                    11,
                    TextAnchor.MiddleLeft,
                    isSel ? "0.4 0.85 1 1" : "0.9 0.92 1 1");
                AddCuiText(
                    container,
                    panel,
                    st,
                    $"0.37 {yb.ToString("F4", CultureInfo.InvariantCulture)}",
                    $"0.50 {ry.ToString("F4", CultureInfo.InvariantCulture)}",
                    11,
                    TextAnchor.MiddleCenter,
                    "0.65 0.75 0.9 1");
                AddCuiButtonWithText(
                    container,
                    panel,
                    $"maxxinvaders.gui roamselectkey {key}",
                    "0.22 0.42 0.62 0.95",
                    "Select",
                    $"0.51 {yb.ToString("F4", CultureInfo.InvariantCulture)}",
                    $"0.62 {ry.ToString("F4", CultureInfo.InvariantCulture)}",
                    11);
                AddCuiButtonWithText(
                    container,
                    panel,
                    $"maxxinvaders.gui roamtoggle {key}",
                    "0.72 0.14 0.10 0.92",
                    "Enable",
                    $"0.63 {yb.ToString("F4", CultureInfo.InvariantCulture)}",
                    $"0.97 {ry.ToString("F4", CultureInfo.InvariantCulture)}",
                    11);
                ry = yb - 0.004f;
            }

            var boolScrollHost = container.Add(
                new CuiPanel
                {
                    Image = { Color = "0.05 0.06 0.08 0.96" },
                    RectTransform = { AnchorMin = "0.02 0.02", AnchorMax = "0.98 0.48" },
                    CursorEnabled = true,
                },
                panel);

            AddCuiText(
                container,
                boolScrollHost,
                "Boolean options (oxide/config/RoamingNPCs.json) — click ON/OFF",
                "0.02 0.88",
                "0.98 0.98",
                12,
                TextAnchor.MiddleLeft,
                "0.75 0.82 0.95 1");

            var boolInner = container.Add(
                new CuiPanel
                {
                    Image = { Color = "0 0 0 0" },
                    RectTransform = { AnchorMin = "0.02 0.02", AnchorMax = "0.98 0.84" },
                    CursorEnabled = true,
                },
                boolScrollHost);

            AddRoamingBoolScrollList(container, boolInner, sel);

        }

        private string ResolveSpawnTemplateKeyFromDraft(SpawnDraft d)
        {
            var fallback = string.IsNullOrWhiteSpace(_cfg.DefaultRoamingTemplateKey)
                ? "bob_resources_farmer"
                : _cfg.DefaultRoamingTemplateKey.Trim();
            var keys = _cfg.Gui?.SpawnRoamingTemplateKeys;
            if (keys == null || keys.Count == 0)
                return fallback;
            var i = Mathf.Clamp(d?.RoamingTemplateSlot ?? 0, 0, 3);
            while (keys.Count <= i)
                keys.Add(fallback);
            var k = keys[i]?.Trim();
            return string.IsNullOrEmpty(k) ? fallback : k;
        }

        private static string ShortTemplateKeyLabel(string key, int maxLen = 11)
        {
            if (string.IsNullOrEmpty(key)) return "?";
            key = key.Trim();
            return key.Length <= maxLen ? key : key.Substring(0, maxLen);
        }

        private sealed class BridgeBoolRow
        {
            public string Path;
            public string Label;
            public bool Value;
        }

        /// <summary>
        /// uMod Call may not return string; JSON may be PascalCase or camelCase. Parse defensively.
        /// </summary>
        private static List<BridgeBoolRow> TryParseBridgeBoolJson(object raw)
        {
            var json = raw?.ToString()?.Trim();
            if (string.IsNullOrEmpty(json) || json == "[]")
                return null;

            try
            {
                var a = JArray.Parse(json);
                var list = new List<BridgeBoolRow>();
                foreach (var tok in a)
                {
                    if (tok is not JObject o) continue;
                    var path = (string)o["Path"] ?? (string)o["path"];
                    if (string.IsNullOrEmpty(path)) continue;
                    var valTok = o["Value"] ?? o["value"];
                    var val = valTok != null && valTok.Type != JTokenType.Null && valTok.Value<bool>();
                    list.Add(new BridgeBoolRow
                    {
                        Path = path,
                        Label = (string)o["Label"] ?? (string)o["label"] ?? path,
                        Value = val,
                    });
                }

                if (list.Count > 0)
                    return list;
            }
            catch
            {
                /* try class deserialize */
            }

            try
            {
                var list = JsonConvert.DeserializeObject<List<BridgeBoolRow>>(json);
                if (list != null && list.Count > 0)
                    return list;
            }
            catch
            {
                /* next */
            }

            try
            {
                var list = JsonConvert.DeserializeObject<List<BridgeBoolRow>>(json, new JsonSerializerSettings
                {
                    ContractResolver = new CamelCasePropertyNamesContractResolver(),
                });
                if (list != null && list.Count > 0)
                    return list;
            }
            catch
            {
                /* give up */
            }

            return null;
        }

        private static string TruncateGui(string s, int max)
        {
            if (string.IsNullOrEmpty(s)) return "";
            s = StripCuiMarkup(s);
            return s.Length <= max ? s : s.Substring(0, max) + "…";
        }

        private void AddRoamingBoolScrollList(CuiElementContainer container, string scrollHostParent, string botKey)
        {
            const int rowH = 38;
            List<BridgeBoolRow> rows = null;
            var apiMissing = RoamingNPCs == null || !RoamingNPCs.IsLoaded;
            object rawJson = null;
            if (!apiMissing && !string.IsNullOrEmpty(botKey))
            {
                try
                {
                    rawJson = RoamingNPCs.Call("GetBridgeBotBoolTogglesJson", botKey);
                    rows = TryParseBridgeBoolJson(rawJson);
                }
                catch
                {
                    rows = null;
                }
            }

            var n = rows?.Count ?? 0;
            var contentH = Mathf.Max(rowH * Mathf.Max(n, 1) + 8, rowH + 8);
            var panelSize = -contentH;

            var scrollerName = Guid.NewGuid().ToString("N");
            AddRawCuiElement(
                container,
                new CuiElement
                {
                    Name = scrollerName,
                    Parent = scrollHostParent,
                    Components =
                    {
                        new CuiNeedsCursorComponent(),
                        new CuiImageComponent
                        {
                            Color = "0.06 0.07 0.09 0.92",
                            Sprite = "Assets/Content/UI/UI.Background.Tile.psd",
                            ImageType = Image.Type.Tiled,
                        },
                        new CuiScrollViewComponent
                        {
                            ContentTransform = new CuiRectTransform
                            {
                                AnchorMin = "0 0.98",
                                AnchorMax = "1 0.98",
                                OffsetMin = $"0 {panelSize}",
                                OffsetMax = "0 0",
                            },
                            Vertical = true,
                            Horizontal = false,
                            MovementType = ScrollRect.MovementType.Clamped,
                            Elasticity = 0.25f,
                            Inertia = true,
                            DecelerationRate = 0.3f,
                            ScrollSensitivity = 24f,
                            VerticalScrollbar = new CuiScrollbar { AutoHide = true, Size = 16 },
                        },
                        new CuiRectTransformComponent { AnchorMin = "0 0", AnchorMax = "1 1" },
                    },
                });

            if (n == 0)
            {
                string msg;
                if (string.IsNullOrEmpty(botKey))
                    msg =
                        "Select a bot key above (Select), then scroll here. Each row toggles one bool in RoamingNPCs.json.";
                else if (apiMissing)
                    msg =
                        "RoamingNPCs plugin not loaded. Add RoamingNPCs.cs to oxide/plugins and: oxide.reload RoamingNPCs";
                else if (rawJson == null)
                    msg =
                        "Bridge API missing: server needs RustMaxx RoamingNPCs.cs (GetBridgeBotBoolTogglesJson). Copy plugins/RoamingNpc/RoamingNPCs.cs from the repo → oxide/plugins → oxide.reload RoamingNPCs";
                else if (string.IsNullOrWhiteSpace(rawJson.ToString()) || rawJson.ToString().Trim() == "[]")
                    msg =
                        "No bool data for this key (bot missing in config?) or plugin not updated. Reload RoamingNPCs after copying the latest RustMaxx RoamingNPCs.cs.";
                else
                    msg =
                        "Could not read bool list (JSON). Reload MaxxInvaders + RoamingNPCs from the RustMaxx repo.";

                AddCuiText(
                    container,
                    scrollerName,
                    msg,
                    "0.04 0.28",
                    "0.96 0.88",
                    12,
                    TextAnchor.MiddleCenter,
                    "0.75 0.8 0.9 1");
                return;
            }

            for (var i = 0; i < n; i++)
            {
                var row = rows[i];
                var offsetMin = -i * rowH - rowH;
                var offsetMax = -i * rowH;
                var rowName = Guid.NewGuid().ToString("N");
                AddRawCuiElement(
                    container,
                    new CuiElement
                    {
                        Name = rowName,
                        Parent = scrollerName,
                        Components =
                        {
                            new CuiImageComponent
                            {
                                Color = "0.1 0.12 0.15 0.94",
                                Sprite = "Assets/Content/UI/UI.Background.Tile.psd",
                                ImageType = Image.Type.Tiled,
                            },
                            new CuiRectTransformComponent
                            {
                                AnchorMin = "0 0.998",
                                AnchorMax = "1 0.998",
                                OffsetMin = $"0 {offsetMin}",
                                OffsetMax = $"0 {offsetMax}",
                            },
                        },
                    });

                var lbl = TruncateGui(row.Label ?? row.Path ?? "?", 48);
                AddCuiText(
                    container,
                    rowName,
                    lbl,
                    "0.02 0.12",
                    "0.70 0.88",
                    11,
                    TextAnchor.MiddleLeft,
                    "0.92 0.95 1 1");
                var on = row.Value;
                var btnCol = on ? "0.18 0.55 0.35 0.95" : "0.35 0.32 0.15 0.95";
                AddCuiButtonWithText(
                    container,
                    rowName,
                    $"maxxinvaders.gui roambooltoggle {i}",
                    btnCol,
                    on ? "ON" : "OFF",
                    "0.72 0.12",
                    "0.98 0.88",
                    11);
            }
        }

        private void AddScrollableInvadersBotList(
            CuiElementContainer container,
            string scrollHostParent,
            IReadOnlyList<InvaderRuntime> bots)
        {
            const int rowH = 44;
            const string uiCard = "0.12 0.12 0.15 0.94";
            const string uiGreen = "0.18 0.48 0.28 0.95";
            var n = bots.Count;
            var contentH = Mathf.Max(rowH * Mathf.Max(n, 1) + 8, rowH + 8);
            var panelSize = -contentH;

            var scrollerName = Guid.NewGuid().ToString("N");
            AddRawCuiElement(
                container,
                new CuiElement
                {
                    Name = scrollerName,
                    Parent = scrollHostParent,
                    Components =
                    {
                        new CuiNeedsCursorComponent(),
                        new CuiImageComponent
                        {
                            Color = "0.08 0.08 0.11 0.95",
                            Sprite = "Assets/Content/UI/UI.Background.Tile.psd",
                            ImageType = Image.Type.Tiled,
                        },
                        new CuiScrollViewComponent
                        {
                            ContentTransform = new CuiRectTransform
                            {
                                AnchorMin = "0 0.98",
                                AnchorMax = "1 0.98",
                                OffsetMin = $"0 {panelSize}",
                                OffsetMax = "0 0",
                            },
                            Vertical = true,
                            Horizontal = false,
                            MovementType = ScrollRect.MovementType.Clamped,
                            Elasticity = 0.25f,
                            Inertia = true,
                            DecelerationRate = 0.3f,
                            ScrollSensitivity = 24f,
                            VerticalScrollbar = new CuiScrollbar { AutoHide = true, Size = 20 },
                        },
                        new CuiRectTransformComponent { AnchorMin = "0 0", AnchorMax = "1 1" },
                    },
                });

            if (n == 0)
            {
                AddCuiText(
                    container,
                    scrollerName,
                    "No active bots.\nUse Spawn from form below or TikFinity.",
                    "0.05 0.45",
                    "0.95 0.92",
                    14,
                    TextAnchor.MiddleCenter,
                    "0.8 0.85 0.92 1");
                return;
            }

            for (var i = 0; i < n; i++)
            {
                var r = bots[i];
                var offsetMin = -i * rowH - rowH;
                var offsetMax = -i * rowH;
                var rowName = Guid.NewGuid().ToString("N");
                AddRawCuiElement(
                    container,
                    new CuiElement
                    {
                        Name = rowName,
                        Parent = scrollerName,
                        Components =
                        {
                            new CuiImageComponent
                            {
                                Color = uiCard,
                                Sprite = "Assets/Content/UI/UI.Background.Tile.psd",
                                ImageType = Image.Type.Tiled,
                            },
                            new CuiRectTransformComponent
                            {
                                AnchorMin = "0 0.998",
                                AnchorMax = "1 0.998",
                                OffsetMin = $"0 {offsetMin}",
                                OffsetMax = $"0 {offsetMax}",
                            },
                        },
                    });

                var hp = r.NpcPlayer != null && !r.NpcPlayer.IsDestroyed ? r.NpcPlayer.health : 0f;
                var nm = StripCuiMarkup(ResolveViewerNameForWorldTag(r));
                var tmpl = r.IsRoamingNpc
                    ? StripCuiMarkup(r.RoamingTemplateKey ?? _cfg.DefaultRoamingTemplateKey ?? "")
                    : "(scientist)";
                var line1 = $"{nm}  {StripCuiMarkup(r.NpcId)}";
                var line2 =
                    $"T{r.Tier}  {r.Mode}  HP {hp:F0}  {(r.IsRoamingNpc ? "Roam" : "Sci")}  {tmpl}";
                AddCuiText(
                    container,
                    rowName,
                    line1 + "\n" + line2,
                    "0.02 0.18",
                    "0.55 0.92",
                    11,
                    TextAnchor.UpperLeft,
                    "1 1 1 1");

                AddCuiButtonWithText(
                    container,
                    rowName,
                    $"maxxinvaders.gui tp {r.NpcId}",
                    _cfg.Gui.AccentColor,
                    "TO ME",
                    "0.56 0.15",
                    "0.66 0.88",
                    9);
                AddCuiButtonWithText(
                    container,
                    rowName,
                    $"maxxinvaders.gui returnrun {r.NpcId}",
                    uiGreen,
                    "RET",
                    "0.665 0.15",
                    "0.76 0.88",
                    9);
                AddCuiButtonWithText(
                    container,
                    rowName,
                    $"maxxinvaders.gui kill {r.NpcId}",
                    "0.45 0.12 0.12 0.95",
                    "KILL",
                    "0.77 0.15",
                    "0.855 0.88",
                    9);
                AddCuiButtonWithText(
                    container,
                    rowName,
                    $"maxxinvaders.gui despawn {r.NpcId}",
                    "0.35 0.32 0.15 0.95",
                    "DESPAWN",
                    "0.86 0.15",
                    "0.99 0.88",
                    7);
            }
        }

        private void OpenGui(BasePlayer player, int page)
        {
            if (player == null) return;
            _adminMainGuiOpen.Add(player.userID);
            _lastHudContentByUser.Remove(player.userID);
            CuiHelper.DestroyUi(player, HudOverlayUiName);
            CuiHelper.DestroyUi(player, UiName);
            _guiPage[player.userID] = page;
            if (!_guiMainTab.TryGetValue(player.userID, out var mainTab)) mainTab = 0;

            var list = _registry.All().ToList();

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
                            $"<size={_cfg.Gui.InvadersTitleSize}><color=#dddddd>MAXX</color> <color=#d62828>INVADERS</color></size>  <size={_cfg.Gui.InvadersVersionSize}><color=#8899aa>v{Version}</color></size>",
                        FontSize = 14,
                        Align = TextAnchor.MiddleLeft,
                    },
                    RectTransform = { AnchorMin = "0.02 0.93", AnchorMax = "0.42 0.99" },
                },
                panel);

            if (mainTab == GuiTabInvaders)
                AddCuiText(
                    container,
                    panel,
                    $"On map: {list.Count}  ·  scroll bot list",
                    "0.52 0.93",
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

            var draft = GetSpawnDraft(player.userID);
            var tmplKeys = _cfg.Gui?.SpawnRoamingTemplateKeys;
            if (tmplKeys == null || tmplKeys.Count == 0)
                tmplKeys = new List<string>
                {
                    "bob_resources_farmer",
                    "john_looter",
                    "alfred_hunter",
                    "austin_fighter",
                };

            var formPanel = container.Add(
                new CuiPanel
                {
                    Image = { Color = "0.10 0.11 0.14 0.95" },
                    RectTransform = { AnchorMin = "0.02 0.02", AnchorMax = "0.98 0.44" },
                    CursorEnabled = true,
                },
                contentPanel);

            AddCuiText(
                container,
                formPanel,
                "— Spawn —",
                "0.03 0.88",
                "0.46 0.98",
                15,
                TextAnchor.MiddleLeft,
                "0.95 0.97 1 1");
            AddCuiText(
                container,
                formPanel,
                "— Rename existing bot —",
                "0.52 0.88",
                "0.97 0.98",
                15,
                TextAnchor.MiddleLeft,
                "0.95 0.97 1 1");

            AddCuiButtonWithText(
                container,
                formPanel,
                "maxxinvaders.gui spawnfields",
                "0.22 0.48 0.72 0.98",
                "Spawn (use form)",
                "0.03 0.76",
                "0.23 0.86",
                12);
            AddCuiButtonWithText(
                container,
                formPanel,
                "maxxinvaders.gui spawnrandom",
                "0.20 0.55 0.35 0.95",
                "Random spawn",
                "0.25 0.76",
                "0.46 0.86",
                12);

            AddCuiText(
                container,
                formPanel,
                "Roaming template (edit list in MaxxInvaders.json → Gui)",
                "0.03 0.66",
                "0.46 0.72",
                10,
                TextAnchor.MiddleLeft,
                "0.75 0.82 0.95 1");

            for (var si = 0; si < 4; si++)
            {
                var k = si < tmplKeys.Count ? tmplKeys[si] : _cfg.DefaultRoamingTemplateKey;
                var slotSel = Mathf.Clamp(draft.RoamingTemplateSlot, 0, 3) == si;
                var x0 = 0.03f + si * 0.105f;
                var x1 = x0 + 0.098f;
                var col = slotSel ? _cfg.Gui.AccentColor : "0.18 0.22 0.28 0.95";
                AddCuiButtonWithText(
                    container,
                    formPanel,
                    $"maxxinvaders.gui tmplslot {si}",
                    col,
                    $"{si + 1}: {ShortTemplateKeyLabel(k ?? "?")}",
                    $"{x0.ToString("F3", CultureInfo.InvariantCulture)} 0.54",
                    $"{x1.ToString("F3", CultureInfo.InvariantCulture)} 0.63",
                    8);
            }

            AddCuiText(
                container,
                formPanel,
                "Bot display name (empty = viewer name)",
                "0.03 0.44",
                "0.46 0.50",
                10,
                TextAnchor.MiddleLeft,
                "0.92 0.95 1 1");
            AddCuiInputFieldPlain(
                container,
                formPanel,
                "maxxinvaders.gui draft botname",
                draft.BotName ?? "",
                "0.03 0.34",
                "0.46 0.42",
                14,
                64);

            AddCuiText(
                container,
                formPanel,
                "Viewer name (TikFinity / identity)",
                "0.03 0.26",
                "0.46 0.32",
                10,
                TextAnchor.MiddleLeft,
                "0.92 0.95 1 1");
            AddCuiInputFieldPlain(
                container,
                formPanel,
                "maxxinvaders.gui draft viewername",
                draft.ViewerName ?? "DemoViewer",
                "0.03 0.16",
                "0.46 0.24",
                13,
                64);

            AddCuiText(
                container,
                formPanel,
                "Viewer ID",
                "0.03 0.095",
                "0.12 0.13",
                9,
                TextAnchor.MiddleLeft,
                "0.7 0.78 0.9 1");
            AddCuiText(
                container,
                formPanel,
                "Tier",
                "0.14 0.095",
                "0.20 0.13",
                9,
                TextAnchor.MiddleLeft,
                "0.7 0.78 0.9 1");
            AddCuiText(
                container,
                formPanel,
                "Mode",
                "0.22 0.095",
                "0.30 0.13",
                9,
                TextAnchor.MiddleLeft,
                "0.7 0.78 0.9 1");
            AddCuiText(
                container,
                formPanel,
                "Kit",
                "0.32 0.095",
                "0.40 0.13",
                9,
                TextAnchor.MiddleLeft,
                "0.7 0.78 0.9 1");
            AddCuiInputFieldPlain(
                container,
                formPanel,
                "maxxinvaders.gui draft viewerid",
                draft.ViewerId ?? "",
                "0.03 0.02",
                "0.12 0.08",
                11,
                48);
            AddCuiInputFieldPlain(
                container,
                formPanel,
                "maxxinvaders.gui draft tier",
                draft.TierStr ?? "1",
                "0.14 0.02",
                "0.20 0.08",
                11,
                4);
            AddCuiInputFieldPlain(
                container,
                formPanel,
                "maxxinvaders.gui draft mode",
                draft.Mode ?? "roaming",
                "0.22 0.02",
                "0.30 0.08",
                11,
                24);
            AddCuiInputFieldPlain(
                container,
                formPanel,
                "maxxinvaders.gui draft kit",
                draft.Kit ?? "-",
                "0.32 0.02",
                "0.45 0.08",
                11,
                48);

            AddCuiText(
                container,
                formPanel,
                "Which bot to rename",
                "0.52 0.72",
                "0.97 0.78",
                11,
                TextAnchor.MiddleLeft,
                "0.92 0.95 1 1");
            AddCuiInputFieldPlain(
                container,
                formPanel,
                "maxxinvaders.gui draft renametarget",
                draft.RenameTarget ?? "",
                "0.52 0.60",
                "0.97 0.70",
                12,
                64);
            AddCuiText(
                container,
                formPanel,
                "New display name",
                "0.52 0.50",
                "0.97 0.56",
                11,
                TextAnchor.MiddleLeft,
                "0.92 0.95 1 1");
            AddCuiInputFieldPlain(
                container,
                formPanel,
                "maxxinvaders.gui draft renamename",
                draft.RenameName ?? "",
                "0.52 0.38",
                "0.97 0.48",
                12,
                64);
            AddCuiButtonWithText(
                container,
                formPanel,
                "maxxinvaders.gui renameapply",
                "0.24 0.52 0.72 0.98",
                "Apply rename",
                "0.52 0.26",
                "0.97 0.36",
                13);
            AddCuiButtonWithText(
                container,
                formPanel,
                "maxxinvaders.gui draftreset",
                "0.30 0.30 0.36 0.98",
                "Reset all fields",
                "0.52 0.14",
                "0.97 0.22",
                11);

            var botsOuter = container.Add(
                new CuiPanel
                {
                    Image = { Color = "0.07 0.09 0.12 0.94" },
                    RectTransform = { AnchorMin = "0.02 0.455", AnchorMax = "0.98 0.92" },
                    CursorEnabled = true,
                },
                contentPanel);

            var scrollHost = container.Add(
                new CuiPanel
                {
                    Image = { Color = "0.08 0.08 0.10 0.01" },
                    RectTransform = { AnchorMin = "0.02 0.02", AnchorMax = "0.98 0.86" },
                    CursorEnabled = true,
                },
                botsOuter);

            AddScrollableInvadersBotList(container, scrollHost, list);

            if (list.Count > 0)
            {
                AddCuiButtonWithText(
                    container,
                    botsOuter,
                    "maxxinvaders.gui tpall",
                    _cfg.Gui.AccentColor,
                    "TP ALL TO ME",
                    "0.62 0.87",
                    "0.98 0.98",
                    11,
                    TextAnchor.MiddleCenter,
                    "0.95 0.97 1 1");
            }

            AddCuiText(
                container,
                botsOuter,
                list.Count > 0
                    ? $"ACTIVE BOTS — scroll  ·  On map: {list.Count}  ·  row: bot comes to you (ring if many)"
                    : $"ACTIVE BOTS — scroll with mouse wheel  ·  On map: {list.Count}",
                "0.02 0.87",
                list.Count > 0 ? "0.60 0.98" : "0.98 0.98",
                13,
                TextAnchor.MiddleLeft,
                "0.95 0.97 1 1");

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

            if (args[0] == "roamselectkey" && args.Length > 1)
            {
                var rkey = string.Join(" ", args.Skip(1).ToArray()).Trim();
                if (!string.IsNullOrEmpty(rkey))
                    _guiRoamingSelectedKey[player.userID] = rkey;
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "roambooltoggle" && args.Length > 1 &&
                int.TryParse(args[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var boolIdx))
            {
                if (!_guiRoamingSelectedKey.TryGetValue(player.userID, out var boolSel) || string.IsNullOrEmpty(boolSel))
                {
                    player.ChatMessage("[MaxxInvaders] On the Roaming tab, click Select on a bot key first.");
                    OpenGui(player, GetGuiPage(player.userID));
                    return;
                }

                if (RoamingNPCs != null && RoamingNPCs.IsLoaded)
                {
                    try
                    {
                        var ok = RoamingNPCs.Call("ToggleBridgeBotBoolByIndex", boolSel, boolIdx);
                        if (ok is bool b && !b)
                            player.ChatMessage("[MaxxInvaders] Toggle failed (reload RoamingNPCs to latest RustMaxx build).");
                    }
                    catch (Exception ex)
                    {
                        PrintWarning($"{LogPrefix} ToggleBridgeBotBoolByIndex: {ex.Message}");
                    }
                }

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

            if (args[0] == "tmplslot" && args.Length > 1 &&
                int.TryParse(args[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var tmplSlot))
            {
                var dSlot = GetSpawnDraft(player.userID);
                dSlot.RoamingTemplateSlot = Mathf.Clamp(tmplSlot, 0, 3);
                OpenGui(player, GetGuiPage(player.userID));
                return;
            }

            if (args[0] == "spawnrandom")
            {
                var dr = GetSpawnDraft(player.userID);
                var vid = "demo_" + Random.Range(100000, 999999);
                var tierList = _cfg.TierDefinitions?.Keys.ToList();
                var tier = tierList != null && tierList.Count > 0
                    ? tierList[Random.Range(0, tierList.Count)]
                    : Random.Range(1, 6);
                var modeList = _cfg.AllowedBehaviorModes;
                var mode = modeList != null && modeList.Count > 0
                    ? modeList[Random.Range(0, modeList.Count)].Trim().ToLowerInvariant()
                    : "roaming";
                var dispName = !string.IsNullOrWhiteSpace(dr.BotName)
                    ? dr.BotName.Trim()
                    : (!string.IsNullOrWhiteSpace(dr.ViewerName) ? dr.ViewerName.Trim() : "RandomBot");
                var gk = _cfg.Gui?.SpawnRoamingTemplateKeys;
                string rtk;
                if (gk != null && gk.Count > 0)
                    rtk = gk[Random.Range(0, gk.Count)]?.Trim();
                else
                    rtk = ResolveSpawnTemplateKeyFromDraft(dr);
                if (string.IsNullOrEmpty(rtk))
                    rtk = string.IsNullOrWhiteSpace(_cfg.DefaultRoamingTemplateKey)
                        ? "bob_resources_farmer"
                        : _cfg.DefaultRoamingTemplateKey.Trim();
                var resR = TrySpawn(dispName, vid, tier, "", mode, player, "gui_random", rtk);
                player.ChatMessage(resR.Success
                    ? $"[MaxxInvaders] Random spawn {resR.NpcId} — template {rtk}, tier {tier}, {mode}"
                    : $"[MaxxInvaders] Random spawn failed: {resR.Error}");
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
                var name = !string.IsNullOrWhiteSpace(d.BotName)
                    ? d.BotName.Trim()
                    : (string.IsNullOrWhiteSpace(d.ViewerName) ? "DemoViewer" : d.ViewerName.Trim());
                var vid = string.IsNullOrWhiteSpace(d.ViewerId)
                    ? "demo_" + Random.Range(100000, 999999)
                    : d.ViewerId.Trim();
                var tmplKey = ResolveSpawnTemplateKeyFromDraft(d);
                var res = TrySpawn(name, vid, tier, kit, mode, player, "gui", tmplKey);
                player.ChatMessage(res.Success
                    ? $"[MaxxInvaders] Spawned {res.NpcId} (template {tmplKey})"
                    : $"[MaxxInvaders] Failed: {res.Error}");
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
                    case "botname":
                        d.BotName = value ?? "";
                        break;
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
                _adminMainGuiOpen.Remove(player.userID);
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
                    {
                        var ang = Random.Range(0f, Mathf.PI * 2f);
                        var ok = TryTeleportNpcToAdmin(r.NpcPlayer, player, Random.Range(2f, 2.7f), ang);
                        if (ok)
                            player.ChatMessage($"[MaxxInvaders] Pulled {StripCuiMarkup(r.ViewerName ?? id)} to you.");
                        else
                            player.ChatMessage("[MaxxInvaders] Could not place bot on navmesh near you — try open ground.");
                    }

                    break;
                }

                LogIf(_cfg.Logging.LogGui, $"gui tp (bot to admin) {player.displayName} {id}", false);
                return;
            }

            if (args[0] == "tpall")
            {
                var moved = TeleportAllInvadersToAdmin(player);
                player.ChatMessage(moved > 0
                    ? $"[MaxxInvaders] Pulled {moved} bot(s) to you in a ring (no overlap)."
                    : "[MaxxInvaders] No active bots to move.");
                LogIf(_cfg.Logging.LogGui, $"gui tpall {player.displayName} moved={moved}", false);
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
