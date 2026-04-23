// MaxxCrew — Naval-era crew NPCs on player boats (stations + parenting).
// v0.1: register boat from look ray, spawn ScientistNPC at configured local stations, clear on unload / boat kill.
//
// Setup: copy to oxide/plugins, then `oxide.reload MaxxCrew`
// Permissions: oxide.grant user <Steam64> maxxcrew.use   (or maxxcrew.admin for owner bypass)
// Config: oxide/config/MaxxCrew.json — deck stations + cannoneer: RoamingNPCs template key + Kits (MaxxInvaders-style bodies).

#nullable disable

using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using HarmonyLib;
using Newtonsoft.Json;
using Oxide.Core;
using Oxide.Core.Plugins;
using Rust;
using UnityEngine;
using Random = UnityEngine.Random;

namespace Oxide.Plugins
{
    [Info("Maxx Crew", "RustMaxx", "0.1.10")]
    [Description("Spawn crew on boats; cannoneers use RoamingNPCs bridge bodies + Kits (MaxxInvaders-style).")]
    public class MaxxCrew : RustPlugin
    {
        private const string HarmonyId = "com.rustmaxx.maxxcrew.entitymenu";
        private const string EntityWheelOptionToken = "maxxcrew_register_boat";

        private const string PermUse = "maxxcrew.use";
        private const string PermAdmin = "maxxcrew.admin";

        private static MaxxCrew _instance;
        private Harmony _harmony;
        private bool _entityMenuPatchLogged;

        private const string DataFile = "MaxxCrew/MaxxCrew";

        private static readonly string[] DefaultScientistPrefabs =
        {
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_roam.prefab",
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_full_lr300.prefab",
            "assets/prefabs/npc/scientist/scientist.prefab",
        };

        /// <summary>Tried in order when <see cref="ConfigData.CannoneerRoamingTemplateKey"/> is <c>auto</c> or empty (first bot that RoamingNPCs reports as ready).</summary>
        private static readonly string[] CannoneerRoamingTemplateCandidates =
        {
            "austin_fighter",
            "alfred_hunter",
            "vamp",
            "john_looter",
            "snipemb",
            "bob_resources_farmer",
            "bunny1",
            "gingy",
            "egg",
        };

        /// <summary>Combat-first scientist order (aligned with MaxxInvaders / naval gunners).</summary>
        private static readonly string[] DefaultCannoneerCombatPrefabs =
        {
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_full_lr300.prefab",
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_heavy.prefab",
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_roam.prefab",
            "assets/prefabs/npc/scientist/scientist.prefab",
            "assets/content/npc/scientist/scientist.prefab",
        };

        private ConfigData _cfg;
        private StoredData _data;
        private Timer _crewJobTimer;

        [PluginReference] private Plugin Kits;

        [PluginReference] private Plugin RoamingNPCs;

        /// <summary>Active crew keyed by NPC net id (for cleanup).</summary>
        private readonly Dictionary<ulong, CrewRecord> _crewByNpcNetId = new();

        private sealed class ConfigData
        {
            [JsonProperty("Enable plugin")]
            public bool EnablePlugin { get; set; } = true;

            [JsonProperty("Max crew per boat")]
            public int MaxCrewPerBoat { get; set; } = 8;

            [JsonProperty("Ray distance to register boat (m)")]
            public float RegisterRayDistance { get; set; } = 24f;

            [JsonProperty("Overlap fallback radius (m) — samples along your look to find hulls thin raycasts miss")]
            public float RegisterOverlapRadius { get; set; } = 8f;

            [JsonProperty("Overlap fallback step along look (m)")]
            public float RegisterOverlapStep { get; set; } = 3f;

            [JsonProperty("Scientist prefab (empty = first default that works)")]
            public string ScientistPrefab { get; set; } = "";

            [JsonProperty("Disable NavMeshAgent on spawned crew (reduces walking off deck)")]
            public bool DisableNavMeshAgent { get; set; } = true;

            [JsonProperty("Crew display name prefix")]
            public string CrewNamePrefix { get; set; } = "[Crew]";

            [JsonProperty("Despawn crew when plugin unloads")]
            public bool DespawnOnUnload { get; set; } = true;

            [JsonProperty("Deck stations (local space relative to boat root; Y up, Z typically forward)")]
            public List<StationConfig> Stations { get; set; } = DefaultStations();

            [JsonProperty("Add \"Register boat (MaxxCrew)\" to the naval boat entity wheel (Harmony; requires compatible Rust build)")]
            public bool RegisterFromEntityWheel { get; set; } = true;

            [JsonProperty("Crew job tick interval (sec) — cannoneer aim/fire scan")]
            public float CrewJobTickSeconds { get; set; } = 1.25f;

            [JsonProperty("Cannoneer scan radius (m)")]
            public float CannoneerScanRadius { get; set; } = 90f;

            [JsonProperty("Cannoneer min time between shots (sec)")]
            public float CannoneerFireCooldownSeconds { get; set; } = 4f;

            [JsonProperty("Cannoneer min dot(product) between barrel forward and target direction to fire")]
            public float CannoneerMinFireDot { get; set; } = 0.35f;

            [JsonProperty("Cannoneer scientist prefabs (only if fallback enabled; try in order)")]
            public List<string> CannoneerScientistPrefabs { get; set; } = new();

            [JsonProperty("Cannoneer uMod Kits kit name (empty = none; applied ~1s after mount)")]
            public string CannoneerKitName { get; set; } = "";

            [JsonProperty(
                "Cannoneer use RoamingNPCs bridge bodies (MaxxInvaders API; gives streamer/anchor protection). If false, cannoneers are vanilla scientists only — not streamer-safe.")]
            public bool CannoneerUseRoamingNpcBodies { get; set; } = true;

            [JsonProperty("Cannoneer RoamingNPCs template key — use \"auto\" to pick first enabled bot, or an exact Bots settings key")]
            public string CannoneerRoamingTemplateKey { get; set; } = "auto";

            [JsonProperty(
                "Cannoneer fallback to vanilla scientist prefabs if Roaming spawn fails (default off — they use default combat AI and are NOT given MaxxInvaders bridge protection, so they may attack the boat owner / streamer. Use RoamingNPCs + auto template instead.)")]
            public bool CannoneerFallbackToScientistPrefabs { get; set; } = false;
        }

        private sealed class StationConfig
        {
            [JsonProperty("Local X")]
            public float LocalX { get; set; }

            [JsonProperty("Local Y")]
            public float LocalY { get; set; } = 1.2f;

            [JsonProperty("Local Z")]
            public float LocalZ { get; set; }

            [JsonProperty("Yaw degrees (local, around Y)")]
            public float YawDegrees { get; set; }

            /// <summary>Deck job id: empty = stand at offset; "cannoneer" = mount a naval boat Cannon and engage hostiles.</summary>
            [JsonProperty("Job (empty = deck, cannoneer = naval cannon)")]
            public string Job { get; set; } = "";
        }

        private sealed class StoredData
        {
            [JsonProperty("Last registered boat net id per player (session hint; resets when boat is gone)")]
            public Dictionary<string, ulong> LastBoatNetIdBySteam = new();

            [JsonProperty("Last registered boat owner (Steam64)")]
            public Dictionary<string, ulong> LastBoatOwnerBySteam = new();
        }

        private sealed class CrewRecord
        {
            public ulong BoatNetId;
            public int StationIndex;
            public ulong OwnerSteamId;
            public string Job = "";
            public ulong CannonNetId;
            public float NextFireTime;
        }

        private static List<StationConfig> DefaultStations()
        {
            return new List<StationConfig>
            {
                new() { LocalX = 0f, LocalY = 1.2f, LocalZ = 2f, YawDegrees = 180f },
                new() { LocalX = -1f, LocalY = 1.2f, LocalZ = -1f, YawDegrees = 0f },
                new() { LocalX = 1f, LocalY = 1.2f, LocalZ = -1f, YawDegrees = 0f },
                new() { LocalX = 0f, LocalY = 1.2f, LocalZ = -3f, YawDegrees = 0f },
                // Example naval job: spawn with `/maxxcrew add 4` after registering a PlayerBoat with deployable cannons.
                new() { LocalX = 0f, LocalY = 1.4f, LocalZ = -6f, YawDegrees = 0f, Job = "cannoneer" },
            };
        }

        private void Init()
        {
            _instance = this;
            permission.RegisterPermission(PermUse, this);
            permission.RegisterPermission(PermAdmin, this);
        }

        private void OnServerInitialized()
        {
            LoadConfigValues();
            LoadData();
            if (_cfg.RegisterFromEntityWheel)
                TryApplyEntityWheelMenuPatch();

            _crewJobTimer?.Destroy();
            _crewJobTimer = timer.Every(_cfg.CrewJobTickSeconds, CrewJobTick);
        }

        private void Unload()
        {
            _crewJobTimer?.Destroy();
            _crewJobTimer = null;
            try
            {
                _harmony?.UnpatchAll(HarmonyId);
            }
            catch
            {
                /* ignore */
            }

            _harmony = null;
            _instance = null;
            if (_cfg != null && _cfg.DespawnOnUnload)
                DespawnAllCrew("plugin_unload");
            SaveData();
        }

        private void OnEntityKill(BaseNetworkable net)
        {
            if (net == null) return;
            var id = net.net?.ID.Value ?? 0UL;
            if (id == 0UL) return;

            // Boat destroyed — remove crew parented to it
            if (IsBoatEntity(net as BaseEntity))
            {
                KillCrewForBoat(id, "boat_killed");
                return;
            }

            if (net is Cannon)
            {
                RemoveCrewForDestroyedCannon(id);
                return;
            }

            if (_crewByNpcNetId.Remove(id, out var rec))
            {
                // NPC died naturally; record already removed
            }
        }

        protected override void LoadDefaultConfig()
        {
            Config.WriteObject(new ConfigData(), true);
        }

        private void LoadConfigValues()
        {
            if (!Config.Exists())
                LoadDefaultConfig();

            try
            {
                _cfg = Config.ReadObject<ConfigData>();
                if (_cfg == null) throw new Exception("null config");
            }
            catch
            {
                PrintWarning("[MaxxCrew] Config invalid — writing defaults.");
                _cfg = new ConfigData();
                Config.WriteObject(_cfg, true);
            }

            _cfg.MaxCrewPerBoat = Mathf.Clamp(_cfg.MaxCrewPerBoat, 1, 32);
            _cfg.RegisterRayDistance = Mathf.Clamp(_cfg.RegisterRayDistance, 4f, 80f);
            _cfg.RegisterOverlapRadius = Mathf.Clamp(_cfg.RegisterOverlapRadius, 2f, 24f);
            _cfg.RegisterOverlapStep = Mathf.Clamp(_cfg.RegisterOverlapStep, 1f, 15f);
            _cfg.CrewJobTickSeconds = Mathf.Clamp(_cfg.CrewJobTickSeconds, 0.5f, 5f);
            _cfg.CannoneerScanRadius = Mathf.Clamp(_cfg.CannoneerScanRadius, 20f, 200f);
            _cfg.CannoneerFireCooldownSeconds = Mathf.Clamp(_cfg.CannoneerFireCooldownSeconds, 1f, 30f);
            _cfg.CannoneerMinFireDot = Mathf.Clamp(_cfg.CannoneerMinFireDot, 0.05f, 0.98f);
            if (_cfg.Stations == null || _cfg.Stations.Count == 0)
                _cfg.Stations = DefaultStations();
            if (_cfg.CannoneerScientistPrefabs == null)
                _cfg.CannoneerScientistPrefabs = new List<string>();

            var tk = (_cfg.CannoneerRoamingTemplateKey ?? "").Trim();
            if (_cfg.CannoneerUseRoamingNpcBodies && string.IsNullOrWhiteSpace(tk))
                _cfg.CannoneerRoamingTemplateKey = "auto";
        }

        private void LoadData()
        {
            try
            {
                _data = Interface.Oxide.DataFileSystem.ReadObject<StoredData>(DataFile) ?? new StoredData();
            }
            catch
            {
                _data = new StoredData();
            }

            if (_data.LastBoatNetIdBySteam == null) _data.LastBoatNetIdBySteam = new Dictionary<string, ulong>();
            if (_data.LastBoatOwnerBySteam == null) _data.LastBoatOwnerBySteam = new Dictionary<string, ulong>();
        }

        private void SaveData()
        {
            if (_data == null) return;
            Interface.Oxide.DataFileSystem.WriteObject(DataFile, _data);
        }

        [ChatCommand("maxxcrew")]
        private void CmdMaxxCrew(BasePlayer player, string command, string[] args)
        {
            if (!_cfg.EnablePlugin)
            {
                Reply(player, "MaxxCrew is disabled in config.");
                return;
            }

            if (!permission.UserHasPermission(player.UserIDString, PermUse) &&
                !permission.UserHasPermission(player.UserIDString, PermAdmin))
            {
                Reply(player, "You need permission maxxcrew.use (or maxxcrew.admin).");
                return;
            }

            var sub = args.Length > 0 ? args[0].ToLowerInvariant() : "help";

            switch (sub)
            {
                case "register":
                case "reg":
                    CmdRegister(player);
                    break;
                case "add":
                case "spawn":
                    CmdAdd(player, args);
                    break;
                case "clear":
                case "despawn":
                    CmdClear(player);
                    break;
                case "status":
                case "who":
                    CmdStatus(player);
                    break;
                case "stations":
                    CmdStations(player);
                    break;
                case "templates":
                case "bots":
                    CmdRoamingTemplates(player);
                    break;
                case "diagnose":
                case "diag":
                    CmdDiagnose(player);
                    break;
                default:
                    Reply(player,
                        "<color=#7ec8e3>MaxxCrew</color> — boat crew (v0.1.10)\n" +
                        "<color=#aaa>/maxxcrew register</color> — look at your boat (deck/helm) and save it\n" +
                        "<color=#aaa>Boat wheel</color> — hold Use on helm/lock: choose <color=#7ec8e3>Register boat (MaxxCrew)</color> when available\n" +
                        "<color=#aaa>/maxxcrew add [station]</color> — spawn crew at station index (0-based); omit = first free\n" +
                        "<color=#aaa>Jobs</color> — <color=#7ec8e3>cannoneer</color> = RoamingNPCs bot + optional Kits; template <color=#7ec8e3>auto</color> picks first working bot\n" +
                        "<color=#aaa>/maxxcrew clear</color> — remove all crew on your last registered boat\n" +
                        "<color=#aaa>/maxxcrew stations</color> — list station slots from config\n" +
                        "<color=#aaa>/maxxcrew templates</color> — list RoamingNPCs bot keys (for cannoneer template)\n" +
                        "<color=#aaa>/maxxcrew status</color> — show registered boat + crew count\n" +
                        "<color=#aaa>/maxxcrew diagnose</color> — Roaming readiness + boat type (when crew does not appear)");
                    break;
            }
        }

        [ConsoleCommand("maxxcrew.registerboat")]
        private void CmdConsoleRegisterBoat(ConsoleSystem.Arg arg)
        {
            var player = arg?.Player();
            if (player == null) return;
            if (!_cfg.EnablePlugin)
            {
                Reply(player, "MaxxCrew is disabled in config.");
                return;
            }

            if (!permission.UserHasPermission(player.UserIDString, PermUse) &&
                !permission.UserHasPermission(player.UserIDString, PermAdmin))
            {
                Reply(player, "You need permission maxxcrew.use (or maxxcrew.admin).");
                return;
            }

            CmdRegister(player);
        }

        private void CmdStations(BasePlayer player)
        {
            Reply(player, $"Stations in config ({_cfg.Stations.Count}):");
            for (var i = 0; i < _cfg.Stations.Count; i++)
            {
                var s = _cfg.Stations[i];
                var job = string.IsNullOrWhiteSpace(s.Job) ? "deck" : s.Job.Trim();
                Reply(player,
                    $"  [{i}] job=<color=#7ec8e3>{job}</color> local ({s.LocalX:0.##}, {s.LocalY:0.##}, {s.LocalZ:0.##}) yaw {s.YawDegrees:0.#}°");
            }
        }

        /// <summary>Lists RoamingNPCs <c>Bots settings</c> keys (same bridge MaxxInvaders uses).</summary>
        private void CmdRoamingTemplates(BasePlayer player)
        {
            if (RoamingNPCs == null || !RoamingNPCs.IsLoaded)
            {
                Reply(player, "<color=#7ec8e3>RoamingNPCs</color> is not loaded — install it to see bot template keys.");
                return;
            }

            try
            {
                var summary = RoamingNPCs.Call("GetMaxxInvadersGuiSummary") as string;
                if (string.IsNullOrEmpty(summary))
                {
                    Reply(player, "RoamingNPCs did not return a summary (check console).");
                    return;
                }

                Reply(player,
                    "<color=#7ec8e3>RoamingNPCs</color> bot keys — paste one into MaxxCrew.json → Cannoneer RoamingNPCs template key, or keep <color=#7ec8e3>auto</color>:");
                const int chunkSize = 420;
                var clipped = summary.Length > 4800 ? summary.Substring(0, 4800) + "\n… (truncated)" : summary;
                for (var i = 0; i < clipped.Length; i += chunkSize)
                    Reply(player, clipped.Substring(i, Math.Min(chunkSize, clipped.Length - i)));
            }
            catch (Exception ex)
            {
                Reply(player, $"Could not read RoamingNPCs summary: {ex.Message}");
            }
        }

        /// <summary>When crew never appears, use this to see Roaming template readiness, boat type, and tracked entities.</summary>
        private void CmdDiagnose(BasePlayer player)
        {
            Reply(player, "<color=#7ec8e3>MaxxCrew diagnose</color> (v0.1.10)");
            Reply(player,
                $"Config: cannoneer Roaming bodies={_cfg.CannoneerUseRoamingNpcBodies}, scientist fallback if Roaming fails={_cfg.CannoneerFallbackToScientistPrefabs} (fallback scientists may attack the streamer — keep off unless you accept vanilla AI), template key={_cfg.CannoneerRoamingTemplateKey ?? "auto"}");

            if (RoamingNPCs == null || !RoamingNPCs.IsLoaded)
            {
                Reply(player, "RoamingNPCs: <color=#ff8866>not loaded</color> — cannoneer Roaming bodies unavailable (scientist fallback still works if enabled).");
            }
            else
            {
                Reply(player, "RoamingNPCs: loaded");
                if (TryResolveCannoneerRoamingTemplateKey(out var resolvedKey, out var resolveErr))
                    Reply(player, $"Resolved cannoneer template: <color=#7ec8e3>{resolvedKey}</color>");
                else
                    Reply(player, $"Template resolve: <color=#ff8866>{resolveErr ?? "?"}</color>");

                var okList = new List<string>();
                foreach (var c in CannoneerRoamingTemplateCandidates)
                {
                    try
                    {
                        var st = RoamingNPCs.Call("IsBridgeTemplateReady", c) as string;
                        if (st == "ok") okList.Add(c);
                    }
                    catch
                    {
                        /* ignore */
                    }
                }

                Reply(player,
                    okList.Count > 0
                        ? $"Auto candidates ready ({okList.Count}): <color=#7ec8e3>{string.Join(", ", okList)}</color>"
                        : "<color=#ff8866>No auto candidates ready</color> — enable at least one bot under RoamingNPCs → Bots settings, or set an exact template key.");
            }

            if (!TryGetLastBoat(player, out var boat, out var boatId, out var boatErr))
            {
                Reply(player, $"Registered boat: {boatErr}");
                return;
            }

            var pb = boat as PlayerBoat;
            Reply(player,
                $"Boat netId=<color=#7ec8e3>{boatId}</color> type={boat.GetType().Name} prefab={boat.ShortPrefabName}");
            if (pb != null)
            {
                var depN = pb.Deployables?.Cached?.Count ?? 0;
                var cannons = 0;
                if (pb.Deployables?.Cached != null)
                {
                    foreach (var e in pb.Deployables.Cached)
                    {
                        if (e is Cannon) cannons++;
                    }
                }

                Reply(player,
                    $"Naval <color=#7ec8e3>PlayerBoat</color>: deployables={depN}, cannons ~{cannons} (cannoneer needs a free cannon).");
            }
            else
            {
                Reply(player,
                    "<color=#ff8866>Not a modular PlayerBoat</color> — deck crew works; <color=#ff8866>cannoneer</color> requires a naval hull + deployable cannon.");
            }

            var n = CountCrewOnBoat(boatId);
            Reply(player, $"Tracked crew records for this boat: <color=#7ec8e3>{n}</color>");
            foreach (var kv in _crewByNpcNetId)
            {
                if (kv.Value.BoatNetId != boatId) continue;
                var ent = BaseNetworkable.serverEntities.Find(new NetworkableId(kv.Key));
                var alive = ent != null && !ent.IsDestroyed;
                var bp = ent as BasePlayer;
                Reply(player,
                    $"  station {kv.Value.StationIndex} job={kv.Value.Job ?? ""} entityAlive={alive} netId={kv.Key} isNpc={(bp != null ? bp.IsNpc.ToString() : "?")}");
            }

            Reply(player,
                "If spawn claims success but you see nobody: check the server console for [MaxxCrew] Spawn OK lines, oxide.reload MaxxCrew, then /maxxcrew clear and add again.");
        }

        private void CmdStatus(BasePlayer player)
        {
            if (!TryGetLastBoat(player, out var boat, out var boatId, out var err))
            {
                Reply(player, err);
                return;
            }

            var count = CountCrewOnBoat(boatId);
            Reply(player,
                $"Registered boat netId={boatId} (prefab: {boat.ShortPrefabName}). Crew on this boat: {count}.");
        }

        private void CmdRegister(BasePlayer player)
        {
            if (!TryRegisterBoat(player, null, out var boatId, out var fail))
            {
                Reply(player, fail);
                return;
            }

            Reply(player,
                $"Boat registered (netId {boatId}). Use <color=#7ec8e3>/maxxcrew add</color> to place crew at deck stations.");
        }

        /// <summary>Register boat for crew commands. If <paramref name="boatRootHint"/> is set, uses it instead of a look raycast.</summary>
        private bool TryRegisterBoat(BasePlayer player, BaseEntity boatRootHint, out ulong boatId, out string error)
        {
            boatId = 0UL;
            error = null;
            BaseEntity boat;
            if (boatRootHint != null)
            {
                boat = ResolveBoatRoot(boatRootHint);
                if (boat == null)
                {
                    error = "That object is not part of a supported boat.";
                    return false;
                }
            }
            else if (!TryRaycastBoat(player, out boat, out error))
                return false;

            boatId = boat.net.ID.Value;
            var key = player.UserIDString;
            _data.LastBoatNetIdBySteam[key] = boatId;
            _data.LastBoatOwnerBySteam[key] = boat.OwnerID;
            SaveData();
            return true;
        }

        private void CmdAdd(BasePlayer player, string[] args)
        {
            if (!TryGetLastBoat(player, out var boat, out var boatId, out var err))
            {
                Reply(player, err);
                return;
            }

            if (!CanManageBoat(player, boat))
            {
                Reply(player, "You are not allowed to add crew on this boat (owner mismatch). Admins: maxxcrew.admin bypasses.");
                return;
            }

            var stationIndex = -1;
            if (args.Length > 1 && int.TryParse(args[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
                stationIndex = parsed;

            if (stationIndex < 0)
                stationIndex = FindFirstFreeStation(boatId);
            else if (stationIndex >= _cfg.Stations.Count)
            {
                Reply(player, $"Station index must be 0..{_cfg.Stations.Count - 1}.");
                return;
            }

            if (stationIndex < 0)
            {
                Reply(player, $"No free station (max {_cfg.MaxCrewPerBoat} crew per boat). Use /maxxcrew clear.");
                return;
            }

            if (CountCrewOnBoat(boatId) >= _cfg.MaxCrewPerBoat)
            {
                Reply(player, "Max crew per boat reached.");
                return;
            }

            if (IsStationOccupied(boatId, stationIndex))
            {
                Reply(player, $"Station {stationIndex} is already occupied. Try another index or /maxxcrew clear.");
                return;
            }

            var station = _cfg.Stations[stationIndex];
            if (!TrySpawnCrewAtStation(player, boat, boatId, stationIndex, station, out var spawnErr))
            {
                Reply(player, spawnErr);
                return;
            }

            var jobLabel = string.IsNullOrWhiteSpace(station.Job) ? "deck" : station.Job.Trim();
            Reply(player, $"Crew placed at station [{stationIndex}] (job: {jobLabel}).");
        }

        private void CmdClear(BasePlayer player)
        {
            if (!TryGetLastBoat(player, out var boat, out var boatId, out var err))
            {
                Reply(player, err);
                return;
            }

            if (!CanManageBoat(player, boat) &&
                !permission.UserHasPermission(player.UserIDString, PermAdmin))
            {
                Reply(player, "You are not allowed to clear crew on this boat.");
                return;
            }

            var n = KillCrewForBoat(boatId, "player_clear");
            Reply(player, n > 0 ? $"Removed {n} crew." : "No active crew on that boat.");
        }

        private bool TryGetLastBoat(BasePlayer player, out BaseEntity boat, out ulong boatId, out string error)
        {
            boat = null;
            boatId = 0UL;
            error = null;
            if (!_data.LastBoatNetIdBySteam.TryGetValue(player.UserIDString, out var netId) || netId == 0UL)
            {
                error = "No boat registered. Look at your boat and run <color=#7ec8e3>/maxxcrew register</color>.";
                return false;
            }

            var ent = BaseNetworkable.serverEntities.Find(new NetworkableId(netId)) as BaseEntity;
            if (ent == null || ent.IsDestroyed)
            {
                error = "Your saved boat no longer exists (destroyed or map reload). Register again.";
                _data.LastBoatNetIdBySteam.Remove(player.UserIDString);
                _data.LastBoatOwnerBySteam.Remove(player.UserIDString);
                SaveData();
                return false;
            }

            if (!IsBoatEntity(ent))
            {
                error = "Saved entity is not a supported boat type.";
                return false;
            }

            boat = ent;
            boatId = netId;
            return true;
        }

        private bool TryRaycastBoat(BasePlayer player, out BaseEntity boat, out string error)
        {
            boat = null;
            error = null;
            var ray = player.eyes.HeadRay();
            // Layers.Solid matches Rust world + construction + vehicles (avoids wrong layer names like "Vehicle_world").
            var solidMask = Layers.Solid;

            if (Physics.Raycast(ray, out var hit, _cfg.RegisterRayDistance, solidMask, QueryTriggerInteraction.Ignore))
            {
                var hitEnt = hit.GetEntity();
                if (hitEnt != null)
                {
                    boat = ResolveBoatRoot(hitEnt);
                    if (boat != null)
                        return true;
                }
            }

            if (TryFindBoatOverlapAlongLook(player, ray, solidMask, out boat))
                return true;

            error =
                "No boat found along your aim. Stand closer to the deck/hull, look at solid parts (not open water), try again, or increase <color=#7ec8e3>RegisterRayDistance</color> / overlap settings in MaxxCrew.json.";
            return false;
        }

        /// <summary>When raycast misses thin colliders or wrong layer, sample spheres along look for any boat root.</summary>
        private bool TryFindBoatOverlapAlongLook(BasePlayer player, Ray ray, int solidMask, out BaseEntity boat)
        {
            boat = null;
            var best = (BaseEntity)null;
            var bestSqr = float.MaxValue;
            var maxDist = _cfg.RegisterRayDistance;
            var step = Mathf.Max(1f, _cfg.RegisterOverlapStep);
            var rad = _cfg.RegisterOverlapRadius;

            for (var d = 1f; d <= maxDist; d += step)
            {
                var center = ray.origin + ray.direction * d;
                var cols = Physics.OverlapSphere(center, rad, solidMask, QueryTriggerInteraction.Ignore);
                foreach (var col in cols)
                {
                    var ent = col.ToBaseEntity();
                    if (ent == null) continue;
                    var root = ResolveBoatRoot(ent);
                    if (root == null) continue;
                    var sqr = (root.transform.position - player.eyes.position).sqrMagnitude;
                    if (sqr < bestSqr)
                    {
                        bestSqr = sqr;
                        best = root;
                    }
                }
            }

            boat = best;
            return boat != null;
        }

        /// <summary>Walk parents to find a supported boat entity (naval BaseBoat or legacy rowboat).</summary>
        private static BaseEntity ResolveBoatRoot(BaseEntity start)
        {
            var cur = start;
            var guard = 0;
            while (cur != null && guard++ < 24)
            {
                if (IsBoatEntity(cur))
                    return cur;
                cur = cur.GetParentEntity();
            }

            return null;
        }

        private static bool IsBoatEntity(BaseEntity ent)
        {
            if (ent == null) return false;
            if (ent is BaseBoat) return true;
            if (ent is MotorRowboat) return true;
            // Naval player-built modular boat — if it does not inherit BaseBoat on some builds, name still matches.
            if (ent.GetType().Name == "PlayerBoat") return true;
            return false;
        }

        private bool CanManageBoat(BasePlayer player, BaseEntity boat)
        {
            if (permission.UserHasPermission(player.UserIDString, PermAdmin))
                return true;
            if (boat == null) return false;
            if (boat.OwnerID == 0UL) return true; // unowned test boats
            return boat.OwnerID == player.userID;
        }

        private int FindFirstFreeStation(ulong boatId)
        {
            for (var i = 0; i < _cfg.Stations.Count; i++)
            {
                if (!IsStationOccupied(boatId, i))
                    return i;
            }

            return -1;
        }

        private bool IsStationOccupied(ulong boatId, int stationIndex)
        {
            foreach (var kv in _crewByNpcNetId)
            {
                if (kv.Value.BoatNetId == boatId && kv.Value.StationIndex == stationIndex)
                    return true;
            }

            return false;
        }

        private int CountCrewOnBoat(ulong boatId)
        {
            var n = 0;
            foreach (var kv in _crewByNpcNetId)
            {
                if (kv.Value.BoatNetId == boatId) n++;
            }

            return n;
        }

        private int KillCrewForBoat(ulong boatId, string reason)
        {
            var toKill = new List<BasePlayer>();
            foreach (var kv in _crewByNpcNetId)
            {
                if (kv.Value.BoatNetId != boatId) continue;
                var ent = BaseNetworkable.serverEntities.Find(new NetworkableId(kv.Key)) as BaseEntity;
                // Do not rely on bp.IsNpc — Roaming bridge bodies / some builds vary; these net ids are only ours.
                if (ent is BasePlayer bp && !bp.IsDestroyed)
                    toKill.Add(bp);
            }

            foreach (var s in toKill)
            {
                try
                {
                    s.Kill();
                }
                catch
                {
                    /* ignore */
                }
            }

            var removed = 0;
            foreach (var kv in new List<KeyValuePair<ulong, CrewRecord>>(_crewByNpcNetId))
            {
                if (kv.Value.BoatNetId == boatId && _crewByNpcNetId.Remove(kv.Key))
                    removed++;
            }

            if (_cfg != null && _cfg.EnablePlugin && removed > 0)
                Puts($"[MaxxCrew] Removed {removed} crew ({reason}).");
            return removed;
        }

        private void DespawnAllCrew(string reason)
        {
            var ids = new List<ulong>(_crewByNpcNetId.Keys);
            foreach (var id in ids)
            {
                var ent = BaseNetworkable.serverEntities.Find(new NetworkableId(id)) as BaseEntity;
                try
                {
                    ent?.Kill();
                }
                catch
                {
                    /* ignore */
                }
            }

            _crewByNpcNetId.Clear();
            Puts($"[MaxxCrew] DespawnAll ({reason}).");
        }

        private bool TrySpawnCrewAtStation(
            BasePlayer player,
            BaseEntity boat,
            ulong boatId,
            int stationIndex,
            StationConfig station,
            out string error)
        {
            error = null;
            var localPos = new Vector3(station.LocalX, station.LocalY, station.LocalZ);
            var localRot = Quaternion.Euler(0f, station.YawDegrees, 0f);
            var worldPos = boat.transform.TransformPoint(localPos);
            var worldRot = boat.transform.rotation * localRot;

            var job = NormalizeStationJob(station.Job);
            if (job == "cannoneer")
                return TrySpawnCannoneerAtStation(player, boat, boatId, stationIndex, station, worldPos, worldRot, out error);

            if (!TryCreateScientistFromPaths(ResolveDeckPrefabPaths(), worldPos, worldRot, out var scientist, out var created))
            {
                error = "Could not spawn ScientistNPC (prefab list failed). Check Scientist prefab paths for your Rust build.";
                return false;
            }

            try
            {
                scientist.enableSaving = false;
                scientist.displayName = $"{_cfg.CrewNamePrefix} {stationIndex}";
                scientist.Spawn();

                scientist.SetParent(boat);
                scientist.transform.localPosition = localPos;
                scientist.transform.localRotation = localRot;

                TryWakeCrewNpc(scientist);

                if (_cfg.DisableNavMeshAgent)
                {
                    var agent = scientist.GetComponent<UnityEngine.AI.NavMeshAgent>();
                    if (agent != null)
                        agent.enabled = false;
                }

                var hp = 100f;
                scientist.InitializeHealth(hp, hp);

                var npcNet = scientist.net.ID.Value;
                _crewByNpcNetId[npcNet] = new CrewRecord
                {
                    BoatNetId = boatId,
                    StationIndex = stationIndex,
                    OwnerSteamId = player.userID,
                    Job = "",
                    CannonNetId = 0UL,
                    NextFireTime = 0f,
                };
            }
            catch (Exception ex)
            {
                try
                {
                    created?.Kill();
                }
                catch
                {
                    /* ignore */
                }

                error = $"Spawn failed: {ex.Message}";
                return false;
            }

            Puts(
                $"[MaxxCrew] Spawn OK: deck station={stationIndex} boat={boatId} npc={(scientist?.net.ID.Value ?? 0UL)} prefab={scientist?.ShortPrefabName ?? "?"}");
            return true;
        }

        private static string NormalizeStationJob(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return "";
            return raw.Trim().ToLowerInvariant();
        }

        private bool TrySpawnCannoneerAtStation(
            BasePlayer player,
            BaseEntity boat,
            ulong boatId,
            int stationIndex,
            StationConfig station,
            Vector3 deckWorldPos,
            Quaternion deckWorldRot,
            out string error)
        {
            error = null;
            var playerBoat = boat as PlayerBoat;
            if (playerBoat == null)
            {
                error =
                    "Cannoneer stations only work on a modular <color=#7ec8e3>PlayerBoat</color> (naval build). Rowboats / non-modular hulls have no deployable cannons.";
                return false;
            }

            if (playerBoat.Deployables == null || playerBoat.Deployables.Cached == null)
            {
                error = "This boat has no deployables cache yet (try again after modules finish spawning).";
                return false;
            }

            if (!TryPickUnclaimedCannon(playerBoat, boatId, deckWorldPos, out var cannon, out var pickErr))
            {
                error = pickErr;
                return false;
            }

            var spawnPos = cannon.mountAnchor != null ? cannon.mountAnchor.position : deckWorldPos;
            var spawnRot = cannon.mountAnchor != null ? cannon.mountAnchor.rotation : deckWorldRot;

            BasePlayer gunner = null;
            BaseEntity createdForCleanup = null;
            var fromRoaming = false;

            if (_cfg.CannoneerUseRoamingNpcBodies)
            {
                if (!TrySpawnRoamingBridgeBodyForCannoneer(player, stationIndex, spawnPos, spawnRot, out gunner, out var roamErr))
                {
                    if (!_cfg.CannoneerFallbackToScientistPrefabs)
                    {
                        error = roamErr;
                        return false;
                    }

                    PrintWarning(
                        $"[MaxxCrew] Cannoneer roaming spawn failed ({roamErr}); using scientist prefab fallback — vanilla scientists lack bridge anchor protection and may attack the boat owner. Set Cannoneer fallback to false (default) and fix RoamingNPCs / template instead.");
                    if (!TryCreateScientistFromPaths(ResolveCannoneerPrefabPaths(), spawnPos, spawnRot, out var sci, out createdForCleanup))
                    {
                        error = roamErr + " (scientist fallback also failed.)";
                        return false;
                    }

                    gunner = sci;
                }
                else
                {
                    fromRoaming = true;
                }
            }
            else
            {
                if (!TryCreateScientistFromPaths(ResolveCannoneerPrefabPaths(), spawnPos, spawnRot, out var sci, out createdForCleanup))
                {
                    error = "Could not spawn ScientistNPC for cannoneer (prefab list failed). Enable Roaming bodies or fix prefabs.";
                    return false;
                }

                gunner = sci;
            }

            try
            {
                gunner.enableSaving = false;
                gunner.displayName = $"{_cfg.CrewNamePrefix} {stationIndex} (cannoneer)";

                if (!fromRoaming)
                {
                    gunner.Spawn();
                }
                else
                {
                    try
                    {
                        gunner.Teleport(spawnPos);
                    }
                    catch
                    {
                        gunner.transform.position = spawnPos;
                    }

                    try
                    {
                        gunner.transform.rotation = spawnRot;
                    }
                    catch
                    {
                        /* ignore */
                    }
                }

                TryWakeCrewNpc(gunner);

                if (cannon.IsMounted())
                {
                    error = "That cannon already has a gunner.";
                    gunner.Kill();
                    return false;
                }

                cannon.MountPlayer(gunner);
                try
                {
                    cannon.AdminReload(1);
                }
                catch
                {
                    /* ignore */
                }

                if (_cfg.DisableNavMeshAgent)
                {
                    var agent = gunner.GetComponent<UnityEngine.AI.NavMeshAgent>();
                    if (agent != null)
                        agent.enabled = false;
                }

                var hp = 100f;
                try
                {
                    gunner.InitializeHealth(hp, hp);
                }
                catch
                {
                    /* ignore */
                }

                var npcNet = gunner.net.ID.Value;
                _crewByNpcNetId[npcNet] = new CrewRecord
                {
                    BoatNetId = boatId,
                    StationIndex = stationIndex,
                    OwnerSteamId = player.userID,
                    Job = "cannoneer",
                    CannonNetId = cannon.net.ID.Value,
                    NextFireTime = 0f,
                };

                if (!string.IsNullOrWhiteSpace(_cfg.CannoneerKitName))
                    timer.Once(1f, () => ApplyCannoneerKitDelayed(npcNet));

                Puts(
                    $"[MaxxCrew] Spawn OK: cannoneer station={stationIndex} boat={boatId} npc={npcNet} roaming={fromRoaming} cannon={cannon.net.ID.Value}");
            }
            catch (Exception ex)
            {
                try
                {
                    createdForCleanup?.Kill();
                    gunner?.Kill();
                }
                catch
                {
                    /* ignore */
                }

                error = $"Cannoneer spawn failed: {ex.Message}";
                return false;
            }

            return true;
        }

        /// <summary>Same bridge call as MaxxInvaders: <c>SpawnFromTemplateForBridge(template, viewerName, viewerId, anchorSteam)</c>.</summary>
        private bool TrySpawnRoamingBridgeBodyForCannoneer(
            BasePlayer ownerPlayer,
            int stationIndex,
            Vector3 teleportPos,
            Quaternion teleportRot,
            out BasePlayer npc,
            out string error)
        {
            npc = null;
            error = null;

            if (RoamingNPCs == null || !RoamingNPCs.IsLoaded)
            {
                error =
                    "<color=#7ec8e3>RoamingNPCs</color> is not loaded. Add the RoamingNPCs plugin (MaxxInvaders bridge) for invader-style bodies.";
                return false;
            }

            if (!TryResolveCannoneerRoamingTemplateKey(out var templateKey, out var resolveErr))
            {
                error = resolveErr;
                return false;
            }

            var viewerName = $"{_cfg.CrewNamePrefix} {stationIndex} (cannoneer)".Trim();
            var viewerId = "maxxcrew_" + Guid.NewGuid().ToString("N");

            try
            {
                var raw = RoamingNPCs.Call("SpawnFromTemplateForBridge", templateKey, viewerName, viewerId, ownerPlayer.userID);
                npc = raw as BasePlayer;
            }
            catch (Exception ex)
            {
                error = $"RoamingNPCs.SpawnFromTemplateForBridge failed: {ex.Message}";
                return false;
            }

            if (npc == null || npc.IsDestroyed)
            {
                error =
                    "RoamingNPCs returned no bot for that template. Check <color=#7ec8e3>Cannoneer RoamingNPCs template key</color> and server console.";
                return false;
            }

            return true;
        }

        /// <summary>
        /// Resolves <see cref="ConfigData.CannoneerRoamingTemplateKey"/>: <c>auto</c> or empty picks the first candidate that
        /// <c>IsBridgeTemplateReady</c> reports as <c>ok</c>. An explicit key that fails falls back to the same auto scan with a warning.
        /// </summary>
        private bool TryResolveCannoneerRoamingTemplateKey(out string templateKey, out string errorDetail)
        {
            templateKey = null;
            errorDetail = null;

            if (RoamingNPCs == null || !RoamingNPCs.IsLoaded)
            {
                errorDetail =
                    "<color=#7ec8e3>RoamingNPCs</color> is not loaded. Install RoamingNPCs for bridge bodies, or disable cannons Roaming bodies and use scientist fallback.";
                return false;
            }

            bool IsReady(string k)
            {
                if (string.IsNullOrWhiteSpace(k)) return false;
                try
                {
                    return RoamingNPCs.Call("IsBridgeTemplateReady", k.Trim()) as string == "ok";
                }
                catch
                {
                    return false;
                }
            }

            bool TryAutoPick(out string picked)
            {
                picked = null;
                foreach (var c in CannoneerRoamingTemplateCandidates)
                {
                    if (!IsReady(c)) continue;
                    picked = c;
                    return true;
                }

                return false;
            }

            var configured = (_cfg.CannoneerRoamingTemplateKey ?? "").Trim();

            if (string.Equals(configured, "auto", StringComparison.OrdinalIgnoreCase) || string.IsNullOrEmpty(configured))
            {
                if (TryAutoPick(out var picked))
                {
                    templateKey = picked;
                    return true;
                }

                errorDetail =
                    "<color=#7ec8e3>auto</color> found no enabled bot. Enable at least one bot under RoamingNPCs <color=#7ec8e3>Bots settings</color>, or run <color=#7ec8e3>/maxxcrew templates</color> and set an exact key.";
                return false;
            }

            var status = RoamingNPCs.Call("IsBridgeTemplateReady", configured) as string;
            if (status == "ok")
            {
                templateKey = configured;
                return true;
            }

            if (TryAutoPick(out var fallback))
            {
                templateKey = fallback;
                PrintWarning(
                    $"[MaxxCrew] Cannoneer template \"{configured}\" not usable ({status ?? "?"}). Using \"{fallback}\" instead. Fix MaxxCrew.json or RoamingNPCs.json.");
                return true;
            }

            errorDetail =
                $"Template <color=#7ec8e3>{configured}</color> is not usable ({status ?? "missing"}). Run <color=#7ec8e3>/maxxcrew templates</color> or set <color=#7ec8e3>Cannoneer RoamingNPCs template key</color> to <color=#7ec8e3>auto</color>.";
            return false;
        }

        private void ApplyCannoneerKitDelayed(ulong npcNetId)
        {
            var npc = BaseNetworkable.serverEntities.Find(new NetworkableId(npcNetId)) as BasePlayer;
            if (npc == null || npc.IsDestroyed) return;
            ApplyKitIfPossible(npc, _cfg.CannoneerKitName, "cannoneer");
        }

        /// <summary>Same pattern as MaxxInvaders: optional uMod <c>Kits</c> <c>GiveKit</c>.</summary>
        private void ApplyKitIfPossible(BasePlayer npc, string kitName, string logTag)
        {
            if (string.IsNullOrWhiteSpace(kitName) || Kits == null || !Kits.IsLoaded)
                return;

            try
            {
                var result = Kits.Call("GiveKit", npc, kitName.Trim());
                if (result is bool b && !b)
                    PrintWarning($"[MaxxCrew] Kits returned false for kit={kitName} ({logTag}).");
            }
            catch (Exception ex)
            {
                PrintWarning($"[MaxxCrew] Kits GiveKit failed ({logTag}): {ex.Message}");
            }
        }

        private List<string> ResolveDeckPrefabPaths()
        {
            var paths = new List<string>();
            void Add(string p)
            {
                if (string.IsNullOrWhiteSpace(p)) return;
                var t = p.Trim();
                if (!paths.Contains(t)) paths.Add(t);
            }

            Add(_cfg.ScientistPrefab);
            foreach (var p in DefaultScientistPrefabs)
                Add(p);
            return paths;
        }

        /// <summary>Combat scientists first (MaxxInvaders-style), then global Scientist prefab, then generic fallbacks.</summary>
        private List<string> ResolveCannoneerPrefabPaths()
        {
            var paths = new List<string>();
            void Add(string p)
            {
                if (string.IsNullOrWhiteSpace(p)) return;
                var t = p.Trim();
                if (!paths.Contains(t)) paths.Add(t);
            }

            if (_cfg.CannoneerScientistPrefabs != null && _cfg.CannoneerScientistPrefabs.Count > 0)
            {
                foreach (var p in _cfg.CannoneerScientistPrefabs)
                    Add(p);
            }
            else
            {
                foreach (var p in DefaultCannoneerCombatPrefabs)
                    Add(p);
            }

            Add(_cfg.ScientistPrefab);
            foreach (var p in DefaultScientistPrefabs)
                Add(p);
            return paths;
        }

        private static bool TryCreateScientistFromPaths(
            List<string> paths,
            Vector3 worldPos,
            Quaternion worldRot,
            out HumanNPC scientist,
            out BaseEntity created)
        {
            scientist = null;
            created = null;
            if (paths == null || paths.Count == 0)
                return false;

            foreach (var path in paths)
            {
                if (string.IsNullOrWhiteSpace(path)) continue;
                var ent = GameManager.server.CreateEntity(path.Trim(), worldPos, worldRot, true);
                if (ent == null) continue;
                var sci = ent as ScientistNPC;
                var hum = sci ?? ent as global::HumanNPC;
                if (hum != null)
                {
                    scientist = hum;
                    created = ent;
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

        /// <summary>Roaming bridge spawns sometimes come up sleeping; mounting usually wakes, but this avoids invisible crew.</summary>
        private static void TryWakeCrewNpc(BasePlayer p)
        {
            if (p == null || p.IsDestroyed) return;
            try
            {
                if (!p.IsSleeping()) return;
                var mi = typeof(BasePlayer).GetMethod("EndSleeping",
                    BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                mi?.Invoke(p, null);
            }
            catch
            {
                /* ignore */
            }
        }

        private bool TryPickUnclaimedCannon(PlayerBoat boat, ulong boatNetId, Vector3 nearWorld, out Cannon cannon, out string error)
        {
            cannon = null;
            error = null;
            Cannon best = null;
            var bestSqr = float.MaxValue;

            foreach (var ent in boat.Deployables.Cached)
            {
                var c = ent as Cannon;
                if (c == null || c.IsDestroyed) continue;
                var parentBoat = c.GetParentEntity() as PlayerBoat;
                if (parentBoat != null && parentBoat != boat) continue;
                if (IsCannonClaimedByCrew(c.net.ID.Value)) continue;

                var anchorPos = c.mountAnchor != null ? c.mountAnchor.position : c.transform.position;
                var sqr = (anchorPos - nearWorld).sqrMagnitude;
                if (sqr < bestSqr)
                {
                    bestSqr = sqr;
                    best = c;
                }
            }

            if (best == null)
            {
                error =
                    "No free <color=#7ec8e3>Cannon</color> found on this boat (place a deployable cannon, or clear crew that already claimed one).";
                return false;
            }

            cannon = best;
            return true;
        }

        private bool IsCannonClaimedByCrew(ulong cannonNetId)
        {
            foreach (var kv in _crewByNpcNetId)
            {
                if (kv.Value.CannonNetId == cannonNetId)
                    return true;
            }

            return false;
        }

        private void RemoveCrewForDestroyedCannon(ulong cannonNetId)
        {
            foreach (var kv in new List<KeyValuePair<ulong, CrewRecord>>(_crewByNpcNetId))
            {
                if (kv.Value.CannonNetId != cannonNetId) continue;
                var ent = BaseNetworkable.serverEntities.Find(new NetworkableId(kv.Key)) as BaseEntity;
                try
                {
                    ent?.Kill();
                }
                catch
                {
                    /* ignore */
                }

                _crewByNpcNetId.Remove(kv.Key);
            }
        }

        private void CrewJobTick()
        {
            if (_cfg == null || !_cfg.EnablePlugin) return;

            foreach (var kv in new List<KeyValuePair<ulong, CrewRecord>>(_crewByNpcNetId))
            {
                if (string.IsNullOrEmpty(kv.Value.Job) ||
                    !kv.Value.Job.Equals("cannoneer", StringComparison.OrdinalIgnoreCase))
                    continue;

                var npcId = kv.Key;
                var rec = kv.Value;
                var gunner = BaseNetworkable.serverEntities.Find(new NetworkableId(npcId)) as BasePlayer;
                if (gunner == null || gunner.IsDestroyed)
                {
                    _crewByNpcNetId.Remove(npcId);
                    continue;
                }

                var cannon = BaseNetworkable.serverEntities.Find(new NetworkableId(rec.CannonNetId)) as Cannon;
                if (cannon == null || cannon.IsDestroyed)
                {
                    try
                    {
                        gunner.Kill();
                    }
                    catch
                    {
                        /* ignore */
                    }

                    _crewByNpcNetId.Remove(npcId);
                    continue;
                }

                var owner = BasePlayer.FindByID(rec.OwnerSteamId);
                if (owner == null || !owner.IsConnected)
                    continue;

                if (!gunner.isMounted && !cannon.IsMounted())
                {
                    try
                    {
                        cannon.MountPlayer(gunner);
                    }
                    catch
                    {
                        /* ignore */
                    }
                }

                if (Time.time < rec.NextFireTime)
                    continue;

                try
                {
                    if (!cannon.IsLoaded())
                    {
                        cannon.AdminReload(1);
                        continue;
                    }

                    if (cannon.FirePoint == null || cannon.AmmoPrefab == null)
                        continue;

                    var target = FindCannoneerHostile(gunner, cannon, owner);
                    if (target == null)
                        continue;

                    var aimFrom = cannon.FirePoint.position;
                    var aimTo = target.eyes.position;
                    var dir = (aimTo - aimFrom).normalized;
                    if (dir.sqrMagnitude < 0.001f)
                        continue;
                    if (Vector3.Dot(dir, cannon.FirePoint.forward) < _cfg.CannoneerMinFireDot)
                        continue;

                    if (!CannoneerHasLoS(aimFrom, aimTo, gunner, cannon))
                        continue;

                    if (cannon.FireProjectile(cannon.AmmoPrefab, aimFrom, dir, owner, 0.25f, 100f, out _))
                    {
                        try
                        {
                            cannon.SERVER_OnProjectileFired(owner.Connection, owner);
                        }
                        catch
                        {
                            /* ignore */
                        }
                    }

                    try
                    {
                        cannon.AdminReload(1);
                    }
                    catch
                    {
                        /* ignore */
                    }

                    rec.NextFireTime = Time.time + _cfg.CannoneerFireCooldownSeconds;
                }
                catch
                {
                    /* ignore */
                }
            }
        }

        private BasePlayer FindCannoneerHostile(BasePlayer gunner, Cannon cannon, BasePlayer owner)
        {
            var origin = cannon.transform.position;
            var rad = _cfg.CannoneerScanRadius;
            var radSqr = rad * rad;

            BasePlayer best = null;
            var bestSqr = float.MaxValue;

            foreach (var pl in BasePlayer.activePlayerList)
            {
                if (pl == null || pl.IsDestroyed || !pl.IsConnected) continue;
                if (pl == gunner || pl == owner) continue;
                if (pl.IsNpc || pl.IsSleeping()) continue;

                if (IsFriendly(owner, pl))
                    continue;

                var sqr = (pl.transform.position - origin).sqrMagnitude;
                if (sqr > radSqr || sqr >= bestSqr)
                    continue;

                bestSqr = sqr;
                best = pl;
            }

            return best;
        }

        private static bool IsFriendly(BasePlayer owner, BasePlayer other)
        {
            if (owner == null || other == null) return true;
            if (other.userID == owner.userID) return true;
            if (owner.currentTeam != 0UL && owner.currentTeam == other.currentTeam)
                return true;
            return false;
        }

        private static bool CannoneerHasLoS(Vector3 from, Vector3 to, BasePlayer gunner, Cannon cannon)
        {
            var dist = Vector3.Distance(from, to);
            if (dist < 0.1f) return true;
            var dir = (to - from).normalized;
            if (!Physics.Raycast(from, dir, out var hit, dist + 0.25f, Layers.Solid, QueryTriggerInteraction.Ignore))
                return true;

            var ent = hit.GetEntity();
            if (ent == null) return false;
            if (ent == gunner || ent == cannon) return true;
            if (ent is BasePlayer bp && bp.IsConnected) return true;
            return false;
        }

        private static void Reply(BasePlayer player, string msg)
        {
            if (player == null || !player.IsConnected) return;
            player.ChatMessage(msg);
        }

        private void TryApplyEntityWheelMenuPatch()
        {
            try
            {
                var asm = typeof(BaseEntity).Assembly;
                var playerBoat = asm.GetType("PlayerBoat");
                MethodInfo target = null;
                var listParamFirst = true;
                if (playerBoat != null)
                {
                    var found = FindMenuOptionsListMethod(playerBoat);
                    if (found.HasValue)
                    {
                        target = found.Value.method;
                        listParamFirst = found.Value.listParamFirst;
                    }
                }

                if (target == null)
                {
                    var found = FindMenuOptionsListMethod(typeof(BaseBoat));
                    if (found.HasValue)
                    {
                        target = found.Value.method;
                        listParamFirst = found.Value.listParamFirst;
                    }
                }

                if (target == null)
                {
                    var found = FindMenuOptionsListMethod(typeof(BaseEntity));
                    if (found.HasValue)
                    {
                        target = found.Value.method;
                        listParamFirst = found.Value.listParamFirst;
                    }
                }

                if (target == null)
                {
                    PrintWarning(
                        "[MaxxCrew] Could not find a List+BasePlayer menu builder on PlayerBoat/BaseBoat/BaseEntity — entity wheel entry not injected. Chat/console register still works.");
                    return;
                }

                var postfixName = listParamFirst
                    ? nameof(EntityWheelMenuPostfixListThenPlayer)
                    : nameof(EntityWheelMenuPostfixPlayerThenList);
                var postfix = AccessTools.Method(typeof(MaxxCrew), postfixName);
                _harmony = new Harmony(HarmonyId);
                _harmony.Patch(target, postfix: new HarmonyMethod(postfix));
                Puts($"[MaxxCrew] Patched entity menu builder: {target.DeclaringType?.Name}.{target.Name} (wheel register).");
            }
            catch (Exception ex)
            {
                PrintWarning($"[MaxxCrew] Entity wheel Harmony patch failed: {ex.Message}");
            }
        }

        /// <summary>Finds methods like <c>void Foo(List&lt;SomeOption&gt;, BasePlayer)</c> used to populate the hold-Use entity wheel.</summary>
        private static (MethodInfo method, bool listParamFirst)? FindMenuOptionsListMethod(Type startType)
        {
            var type = startType;
            while (type != null && type != typeof(object))
            {
                foreach (var m in type.GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic |
                                                 BindingFlags.DeclaredOnly))
                {
                    if (m.IsStatic || m.IsGenericMethodDefinition) continue;
                    var mn = m.Name;
                    if (!mn.Contains("Menu") && !mn.Contains("Option") && !mn.Contains("Radial"))
                        continue;
                    var ps = m.GetParameters();
                    if (ps.Length != 2) continue;

                    if (ps[0].ParameterType != typeof(BasePlayer) && ps[1].ParameterType == typeof(BasePlayer))
                    {
                        var p0 = ps[0].ParameterType;
                        if (!p0.IsGenericType || p0.GetGenericTypeDefinition() != typeof(List<>)) continue;
                        var elem = p0.GetGenericArguments()[0];
                        if (elem == null || !elem.Name.Contains("Option")) continue;
                        return (m, true);
                    }

                    if (ps[0].ParameterType == typeof(BasePlayer) && ps[1].ParameterType != typeof(BasePlayer))
                    {
                        var p1 = ps[1].ParameterType;
                        if (!p1.IsGenericType || p1.GetGenericTypeDefinition() != typeof(List<>)) continue;
                        var elem = p1.GetGenericArguments()[0];
                        if (elem == null || !elem.Name.Contains("Option")) continue;
                        return (m, false);
                    }
                }

                type = type.BaseType;
            }

            return null;
        }

        private static void EntityWheelMenuPostfixListThenPlayer(BaseEntity __instance, IList options, BasePlayer player)
        {
            EntityWheelMenuAppend(__instance, options, player);
        }

        private static void EntityWheelMenuPostfixPlayerThenList(BaseEntity __instance, BasePlayer player, IList options)
        {
            EntityWheelMenuAppend(__instance, options, player);
        }

        /// <summary>Harmony postfix: append a MaxxCrew register entry when the game builds entity-wheel options for a boat.</summary>
        private static void EntityWheelMenuAppend(BaseEntity __instance, IList options, BasePlayer player)
        {
            var inst = _instance;
            if (inst == null || inst._cfg == null || !inst._cfg.EnablePlugin || !inst._cfg.RegisterFromEntityWheel)
                return;
            if (__instance == null || player == null || options == null) return;
            if (ResolveBoatRoot(__instance) == null)
                return;
            if (!inst.permission.UserHasPermission(player.UserIDString, PermUse) &&
                !inst.permission.UserHasPermission(player.UserIDString, PermAdmin))
                return;

            if (ListAlreadyHasMaxxCrewToken(options))
                return;

            var optionType = options.GetType().IsGenericType
                ? options.GetType().GetGenericArguments()[0]
                : null;
            if (optionType == null) return;

            object entry;
            try
            {
                entry = Activator.CreateInstance(optionType);
            }
            catch
            {
                if (!inst._entityMenuPatchLogged)
                {
                    inst._entityMenuPatchLogged = true;
                    inst.PrintWarning("[MaxxCrew] Could not construct menu Option type — wheel register disabled for this build.");
                }

                return;
            }

            if (!TryPopulateMenuOptionFields(entry, optionType, __instance))
            {
                if (!inst._entityMenuPatchLogged)
                {
                    inst._entityMenuPatchLogged = true;
                    inst.PrintWarning(
                        "[MaxxCrew] Menu Option type has no Action<BasePlayer> field — wheel line may not appear or may not run on this Rust build.");
                }

                return;
            }

            try
            {
                options.Add(entry);
            }
            catch
            {
                /* ignore */
            }
        }

        private static bool ListAlreadyHasMaxxCrewToken(IList options)
        {
            foreach (var o in options)
            {
                if (o == null) continue;
                var t = o.GetType();
                foreach (var f in t.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
                {
                    if (f.FieldType != typeof(string)) continue;
                    var s = f.GetValue(o) as string;
                    if (s == EntityWheelOptionToken)
                        return true;
                }
            }

            return false;
        }

        /// <returns>True if a server-side click handler was assigned.</returns>
        private static bool TryPopulateMenuOptionFields(object entry, Type optionType, BaseEntity contextEntity)
        {
            void AssignStringMember(string value, params string[] names)
            {
                foreach (var name in names)
                {
                    var f = optionType.GetField(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                    if (f != null && f.FieldType == typeof(string))
                    {
                        try
                        {
                            f.SetValue(entry, value);
                        }
                        catch
                        {
                            /* ignore */
                        }

                        return;
                    }

                    var p = optionType.GetProperty(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                    if (p != null && p.PropertyType == typeof(string) && p.CanWrite)
                    {
                        try
                        {
                            p.SetValue(entry, value, null);
                        }
                        catch
                        {
                            /* ignore */
                        }

                        return;
                    }
                }
            }

            AssignStringMember(EntityWheelOptionToken, "name", "Name", "token", "id", "api");
            AssignStringMember("Register boat (MaxxCrew)", "english", "English", "title", "fullName", "text");
            AssignStringMember("Save this hull for /maxxcrew crew placement.", "description", "Description", "desc", "subtitle");

            foreach (var f in optionType.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
            {
                if (f.FieldType == typeof(Action<BasePlayer>))
                {
                    Action<BasePlayer> handler = p =>
                    {
                        var i = _instance;
                        if (i == null || p == null || !p.IsConnected) return;
                        if (!i._cfg.EnablePlugin) return;
                        if (!i.permission.UserHasPermission(p.UserIDString, PermUse) &&
                            !i.permission.UserHasPermission(p.UserIDString, PermAdmin))
                        {
                            Reply(p, "You need permission maxxcrew.use (or maxxcrew.admin).");
                            return;
                        }

                        if (!i.TryRegisterBoat(p, contextEntity, out var boatId, out var err))
                        {
                            Reply(p, err);
                            return;
                        }

                        Reply(p,
                            $"Boat registered (netId {boatId}). Use <color=#7ec8e3>/maxxcrew add</color> to place crew at deck stations.");
                    };

                    try
                    {
                        f.SetValue(entry, handler);
                    }
                    catch
                    {
                        /* ignore */
                    }

                    return true;
                }
            }

            return false;
        }
    }
}
