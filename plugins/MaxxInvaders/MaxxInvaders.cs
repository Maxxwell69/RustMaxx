// MaxxInvaders — RustMaxx viewer-linked NPC spawns (TikFinity / RCON / relay).
// Standalone Oxide plugin: does NOT depend on RoamingNPCs or PersonalNPC.
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
    [Info("MaxxInvaders", "RustMaxx", "1.0.0")]
    [Description("Viewer-linked Scientist NPCs for stream events, admin GUI, tiers, Kits, and RCON.")]
    public class MaxxInvaders : RustPlugin
    {
        #region Constants & permissions

        private const string PermAdmin = "maxxinvaders.admin";
        private const string PermUse = "maxxinvaders.use";
        private const string PermDebug = "maxxinvaders.debug";

        private const string LogPrefix = "[MaxxInvaders]";
        private const string DataFile = "MaxxInvaders/MaxxInvadersData";
        private const string UiName = "MaxxInvaders.AdminUI";

        #endregion

        #region Plugin references

        [PluginReference] private Plugin Kits;

        #endregion

        #region State

        private InvaderConfig _cfg;
        private InvaderDataStore _data;
        private readonly InvaderRegistry _registry = new();
        private readonly Dictionary<string, DateTime> _viewerCooldownUntil = new(StringComparer.OrdinalIgnoreCase);
        private Timer _tickTimer;
        private Timer _persistTimer;
        private bool _debugRuntime;

        #endregion

        #region Oxide lifecycle

        private void Init()
        {
            permission.RegisterPermission(PermAdmin, this);
            permission.RegisterPermission(PermUse, this);
            permission.RegisterPermission(PermDebug, this);
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

            if (_cfg?.DespawnOnUnload == true)
                _registry.DespawnAll(this, "plugin_unload");
            SaveDataFile();
        }

        #endregion

        #region Config

        private class InvaderConfig
        {
            public bool EnablePlugin { get; set; } = true;
            public bool DebugMode { get; set; } = false;
            public int MaxActiveNPCs { get; set; } = 24;
            public bool PreventDuplicateViewerNPCs { get; set; } = true;
            public float DefaultSpawnRadius { get; set; } = 80f;
            public float MinimumDistanceFromPlayers { get; set; } = 12f;
            public bool BlockSpawnInSafeZones { get; set; } = true;
            public bool BlockSpawnInMonuments { get; set; } = true;
            public float DefaultLifetimeSeconds { get; set; } = 3600f;
            public float PerViewerCooldownSeconds { get; set; } = 30f;
            public int SpawnAttempts { get; set; } = 36;
            public float BehaviorTickSeconds { get; set; } = 1.5f;
            public bool DespawnOnUnload { get; set; } = true;
            public float PersistIntervalSeconds { get; set; } = 60f;

            public string DefaultScientistPrefab { get; set; } =
                "assets/prefabs/npc/scientist/scientistnpc_roam.prefab";

            public Dictionary<string, string> PrefabByBehaviorMode { get; set; } = new()
            {
                ["friendly"] = "assets/prefabs/npc/scientist/scientistnpc_roam.prefab",
                ["hostile"] = "assets/prefabs/npc/scientist/scientistnpc_roam.prefab",
                ["neutral"] = "assets/prefabs/npc/scientist/scientistnpc_roam.prefab",
                ["roaming"] = "assets/prefabs/npc/scientist/scientistnpc_roam.prefab",
                ["defend"] = "assets/prefabs/npc/scientist/scientistnpc_roam.prefab",
                ["escort"] = "assets/prefabs/npc/scientist/scientistnpc_roam.prefab",
                ["attackplayer"] = "assets/prefabs/npc/scientist/scientistnpc_roam.prefab",
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
            SaveConfig();
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
            public ScientistNPC Entity;
            public DateTime SpawnedAtUtc;
            public DateTime? ExpiresAtUtc;
        }

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

        private SpawnResult TrySpawn(
            string viewerName,
            string viewerId,
            int tier,
            string kitName,
            string mode,
            BasePlayer anchorPlayer,
            string source)
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

            var prefab = ResolvePrefab(mode);
            var ent = GameManager.server.CreateEntity(prefab, pos, Quaternion.identity, true);
            var scientist = ent as ScientistNPC;
            if (scientist == null)
            {
                ent?.Kill();
                return SpawnResult.Fail("prefab_invalid");
            }

            scientist.enableSaving = false;
            scientist.displayName = $"[Invader] {viewerName}";
            scientist.Spawn();

            var hp = tierDef.Health > 0 ? tierDef.Health : 100f;
            scientist.InitializeHealth(hp, hp);

            var npcId = NextNpcId();
            var netId = scientist.net.ID.Value;

            var runtime = new InvaderRuntime
            {
                NpcId = npcId,
                ViewerName = viewerName.Trim(),
                ViewerId = viewerId.Trim(),
                Tier = tier,
                KitName = kitResolved ?? "",
                Mode = mode.ToLowerInvariant(),
                EntityId = netId,
                Entity = scientist,
                SpawnedAtUtc = DateTime.UtcNow,
                ExpiresAtUtc = lifetime > 0 ? DateTime.UtcNow.AddSeconds(lifetime) : null,
            };

            _registry.Register(runtime);

            if (_cfg.PerViewerCooldownSeconds > 0)
                _viewerCooldownUntil[viewerId] = DateTime.UtcNow.AddSeconds(_cfg.PerViewerCooldownSeconds);

            ApplyKitIfPossible(scientist, kitResolved, viewerId);

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
                LastHealth = scientist.health,
                LastPosition = scientist.transform.position.ToString(),
            };
            _data.History.Add(record);
            TrimHistory();

            LogIf(_cfg.Logging.LogSpawn,
                $"spawned npc={npcId} viewer={viewerName} id={viewerId} tier={tier} mode={mode} kit={kitResolved} src={source}",
                false);

            return SpawnResult.Ok(npcId, netId);
        }

        private sealed class SpawnResult
        {
            public bool Success;
            public string Error;
            public string NpcId;
            public ulong EntityId;

            public static SpawnResult Ok(string npcId, ulong entityId) =>
                new() { Success = true, NpcId = npcId, EntityId = entityId };

            public static SpawnResult Fail(string err) =>
                new() { Success = false, Error = err };
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
                var tryPos = anchor + flat * Random.Range(_cfg.DefaultSpawnRadius * 0.25f, _cfg.DefaultSpawnRadius);
                tryPos.y = TerrainMeta.HeightMap.GetHeight(tryPos);

                if (_cfg.BlockSpawnInMonuments && InMonumentArea(tryPos)) continue;
                if (_cfg.BlockSpawnInSafeZones && InSafeZone(tryPos)) continue;
                if (WaterLevel.Test(tryPos, true, true)) continue;
                if (!NavMesh.SamplePosition(tryPos, out var hit, 4f, NavMesh.AllAreas)) continue;
                tryPos = hit.position;

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

        private void ApplyKitIfPossible(ScientistNPC npc, string kitName, string viewerIdForLog)
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

        private void BehaviorTick()
        {
            foreach (var r in _registry.All().ToArray())
            {
                if (r.Entity == null || r.Entity.IsDestroyed)
                {
                    HandleDeadOrMissing(r, "entity_gone");
                    continue;
                }

                if (r.ExpiresAtUtc.HasValue && DateTime.UtcNow >= r.ExpiresAtUtc.Value)
                {
                    DespawnInternal(r, "lifetime_expired");
                    continue;
                }

                r.Entity.health = Mathf.Clamp(r.Entity.health, 0f, r.Entity.MaxHealth());
                var pos = r.Entity.transform.position;
                UpdateRecordPosition(r.EntityId, pos, r.Entity.health);

                switch (r.Mode)
                {
                    case "defend":
                        TrySetDestination(r.Entity, r.Entity.transform.position);
                        break;
                    case "attackplayer":
                    case "hostile":
                        SteerTowardNearestPlayer(r.Entity, 80f, true);
                        break;
                    case "escort":
                        SteerTowardNearestAdmin(r.Entity, 12f);
                        break;
                    case "friendly":
                    case "neutral":
                    case "roaming":
                    default:
                        SteerRandomRoam(r.Entity, 24f);
                        break;
                }
            }
        }

        private void SteerRandomRoam(ScientistNPC npc, float radius)
        {
            if (npc == null || Random.value > 0.15f) return;
            var origin = npc.transform.position;
            var target = origin + Random.insideUnitSphere.Flatten() * radius;
            target.y = TerrainMeta.HeightMap.GetHeight(target);
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
                TrySetDestination(npc, best.transform.position);
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
                TrySetDestination(npc, best.transform.position);
        }

        private static void TrySetDestination(ScientistNPC npc, Vector3 worldPos)
        {
            try
            {
                var agent = npc.GetComponent<NavMeshAgent>();
                if (agent != null && agent.isOnNavMesh)
                    agent.SetDestination(worldPos);
            }
            catch
            {
                // NavMesh steering is best-effort; scientist brain still runs engine-side.
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
            var npc = entity as ScientistNPC;
            if (npc == null) return;
            if (!_registry.TryGetByEntity(npc.net.ID.Value, out var r)) return;

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
                if (r.Entity != null && !r.Entity.IsDestroyed)
                    rec.LastHealth = r.Entity.health;
            }
        }

        private void DespawnInternal(InvaderRuntime r, string reason)
        {
            try
            {
                if (r.Entity != null && !r.Entity.IsDestroyed)
                    r.Entity.Kill();
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
            if (r.Entity != null && !r.Entity.IsDestroyed)
            {
                r.Entity.InitializeHealth(def.Health, def.Health);
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
                player.ChatMessage("Usage: /maxxinvaders ui | list | spawn | kill | despawn | clear | debug on|off");
                return;
            }

            var sub = args[0].ToLowerInvariant();
            switch (sub)
            {
                case "ui":
                    if (!CanAdmin(player)) return;
                    OpenGui(player, 0);
                    break;
                case "list":
                    if (!CanUse(player)) return;
                    ChatList(player);
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

        /// <summary>Alias so /maxxinvaders.ui works as a single token on many Oxide builds.</summary>
        [ChatCommand("maxxinvaders.ui")]
        private void ChatUiAlias(BasePlayer player, string command, string[] args)
        {
            if (player == null) return;
            if (!CanAdmin(player)) return;
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

        private void ChatList(BasePlayer player)
        {
            var n = 0;
            foreach (var r in _registry.All())
            {
                n++;
                if (n > 15) break;
                player.ChatMessage($"{r.NpcId} | {r.ViewerName} | tier {r.Tier} | {r.Mode} | hp {r.Entity?.health ?? 0:F0}");
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
                else if (r.Entity != null && !r.Entity.IsDestroyed)
                    r.Entity.Kill();
                return;
            }
        }

        #endregion

        #region GUI

        private readonly Dictionary<ulong, int> _guiPage = new();

        private void OpenGui(BasePlayer player, int page)
        {
            if (player == null) return;
            CuiHelper.DestroyUi(player, UiName);
            _guiPage[player.userID] = page;

            var rows = _cfg.Gui.RowsPerPage;
            var list = _registry.All().ToList();
            var totalPages = Math.Max(1, (int)Math.Ceiling(list.Count / (float)rows));
            page = Mathf.Clamp(page, 0, totalPages - 1);
            var slice = list.Skip(page * rows).Take(rows).ToList();

            var container = new CuiElementContainer();
            var panel = container.Add(
                new CuiPanel
                {
                    Image = { Color = _cfg.Gui.PanelColor },
                    RectTransform = { AnchorMin = "0.05 0.1", AnchorMax = "0.95 0.9" },
                    CursorEnabled = true,
                },
                "Overlay",
                UiName);

            container.Add(
                new CuiLabel
                {
                    Text =
                    {
                        Text =
                            $"<size=18><b>MaxxInvaders</b></size>  Active: {list.Count}  Page {page + 1}/{totalPages}",
                        FontSize = 14,
                        Align = TextAnchor.MiddleLeft,
                    },
                    RectTransform = { AnchorMin = "0.02 0.92", AnchorMax = "0.98 0.99" },
                },
                panel);

            container.Add(
                new CuiButton
                {
                    Button = { Command = $"maxxinvaders.gui action close", Color = "0.4 0.15 0.15 0.9" },
                    RectTransform = { AnchorMin = "0.88 0.92", AnchorMax = "0.98 0.99" },
                    Text = { Text = "Close", FontSize = 12 },
                },
                panel);

            container.Add(
                new CuiButton
                {
                    Button = { Command = $"maxxinvaders.gui action refresh", Color = "0.15 0.35 0.4 0.9" },
                    RectTransform = { AnchorMin = "0.74 0.92", AnchorMax = "0.86 0.99" },
                    Text = { Text = "Refresh", FontSize = 12 },
                },
                panel);

            if (page > 0)
                container.Add(
                    new CuiButton
                    {
                        Button = { Command = $"maxxinvaders.gui page {page - 1}", Color = "0.2 0.2 0.25 0.9" },
                        RectTransform = { AnchorMin = "0.60 0.92", AnchorMax = "0.72 0.99" },
                        Text = { Text = "Prev", FontSize = 12 },
                    },
                    panel);

            if (page < totalPages - 1)
                container.Add(
                    new CuiButton
                    {
                        Button = { Command = $"maxxinvaders.gui page {page + 1}", Color = "0.2 0.2 0.25 0.9" },
                        RectTransform = { AnchorMin = "0.46 0.92", AnchorMax = "0.58 0.99" },
                        Text = { Text = "Next", FontSize = 12 },
                    },
                    panel);

            float y = 0.88f;
            foreach (var r in slice)
            {
                var hp = r.Entity != null && !r.Entity.IsDestroyed ? r.Entity.health : 0f;
                var pos = r.Entity != null ? r.Entity.transform.position.ToString() : r.ToString();
                var age = (DateTime.UtcNow - r.SpawnedAtUtc).TotalMinutes;

                var row = container.Add(
                    new CuiPanel
                    {
                        Image = { Color = "0.15 0.15 0.18 0.85" },
                        RectTransform = { AnchorMin = $"0.02 {y - 0.08f}", AnchorMax = $"0.98 {y}" },
                    },
                    panel);

                container.Add(
                    new CuiLabel
                    {
                        Text =
                        {
                            Text =
                                $"{r.NpcId}  {r.ViewerName}  ({r.ViewerId})  T{r.Tier}  {r.Mode}  HP:{hp:F0}  {age:F1}m",
                            FontSize = 11,
                            Align = TextAnchor.MiddleLeft,
                        },
                        RectTransform = { AnchorMin = "0.02 0", AnchorMax = "0.72 1" },
                    },
                    row);

                container.Add(
                    new CuiButton
                    {
                        Button = { Command = $"maxxinvaders.gui tp {r.NpcId}", Color = _cfg.Gui.AccentColor },
                        RectTransform = { AnchorMin = "0.73 0.15", AnchorMax = "0.82 0.85" },
                        Text = { Text = "TP", FontSize = 10 },
                    },
                    row);

                container.Add(
                    new CuiButton
                    {
                        Button = { Command = $"maxxinvaders.gui kill {r.NpcId}", Color = "0.5 0.2 0.2 0.9" },
                        RectTransform = { AnchorMin = "0.83 0.15", AnchorMax = "0.91 0.85" },
                        Text = { Text = "Kill", FontSize = 10 },
                    },
                    row);

                container.Add(
                    new CuiButton
                    {
                        Button = { Command = $"maxxinvaders.gui despawn {r.NpcId}", Color = "0.35 0.35 0.2 0.9" },
                        RectTransform = { AnchorMin = "0.92 0.15", AnchorMax = "0.99 0.85" },
                        Text = { Text = "Despawn", FontSize = 9 },
                    },
                    row);

                y -= 0.09f;
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
                    if (r.Entity != null && !r.Entity.IsDestroyed)
                        player.Teleport(r.Entity.transform.position);
                    break;
                }
                LogIf(_cfg.Logging.LogGui, $"gui tp {player.displayName} {id}", false);
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
