// MaxxCrew — Naval-era crew NPCs on player boats (stations + parenting).
// v0.1: register boat from look ray, spawn ScientistNPC at configured local stations, clear on unload / boat kill.
//
// Setup: copy to oxide/plugins, then `oxide.reload MaxxCrew`
// Permissions: oxide.grant user <Steam64> maxxcrew.use   (or maxxcrew.admin for owner bypass)
// Config: oxide/config/MaxxCrew.json — tune "Deck stations" local offsets for your typical hull layout.

#nullable disable

using System;
using System.Collections.Generic;
using System.Globalization;
using Newtonsoft.Json;
using Oxide.Core;
using Rust;
using UnityEngine;
using Random = UnityEngine.Random;

namespace Oxide.Plugins
{
    [Info("Maxx Crew", "RustMaxx", "0.1.2")]
    [Description("Spawn crew NPCs on player-built boats at fixed deck stations (naval update).")]
    public class MaxxCrew : RustPlugin
    {
        private const string PermUse = "maxxcrew.use";
        private const string PermAdmin = "maxxcrew.admin";

        private const string DataFile = "MaxxCrew/MaxxCrew";

        private static readonly string[] DefaultScientistPrefabs =
        {
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_roam.prefab",
            "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_full_lr300.prefab",
            "assets/prefabs/npc/scientist/scientist.prefab",
        };

        private ConfigData _cfg;
        private StoredData _data;

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
        }

        private static List<StationConfig> DefaultStations()
        {
            return new List<StationConfig>
            {
                new() { LocalX = 0f, LocalY = 1.2f, LocalZ = 2f, YawDegrees = 180f },
                new() { LocalX = -1f, LocalY = 1.2f, LocalZ = -1f, YawDegrees = 0f },
                new() { LocalX = 1f, LocalY = 1.2f, LocalZ = -1f, YawDegrees = 0f },
                new() { LocalX = 0f, LocalY = 1.2f, LocalZ = -3f, YawDegrees = 0f },
            };
        }

        private void Init()
        {
            permission.RegisterPermission(PermUse, this);
            permission.RegisterPermission(PermAdmin, this);
        }

        private void OnServerInitialized()
        {
            LoadConfigValues();
            LoadData();
        }

        private void Unload()
        {
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
            if (_cfg.Stations == null || _cfg.Stations.Count == 0)
                _cfg.Stations = DefaultStations();
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
                default:
                    Reply(player,
                        "<color=#7ec8e3>MaxxCrew</color> — boat crew (v0.1)\n" +
                        "<color=#aaa>/maxxcrew register</color> — look at your boat (deck/helm) and save it\n" +
                        "<color=#aaa>/maxxcrew add [station]</color> — spawn crew at station index (0-based); omit = first free\n" +
                        "<color=#aaa>/maxxcrew clear</color> — remove all crew on your last registered boat\n" +
                        "<color=#aaa>/maxxcrew stations</color> — list station slots from config\n" +
                        "<color=#aaa>/maxxcrew status</color> — show registered boat + crew count");
                    break;
            }
        }

        private void CmdStations(BasePlayer player)
        {
            Reply(player, $"Stations in config ({_cfg.Stations.Count}):");
            for (var i = 0; i < _cfg.Stations.Count; i++)
            {
                var s = _cfg.Stations[i];
                Reply(player,
                    $"  [{i}] local ({s.LocalX:0.##}, {s.LocalY:0.##}, {s.LocalZ:0.##}) yaw {s.YawDegrees:0.#}°");
            }
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
            if (!TryRaycastBoat(player, out var boat, out var fail))
            {
                Reply(player, fail);
                return;
            }

            var boatId = boat.net.ID.Value;
            var key = player.UserIDString;
            _data.LastBoatNetIdBySteam[key] = boatId;
            _data.LastBoatOwnerBySteam[key] = boat.OwnerID;
            SaveData();

            Reply(player,
                $"Boat registered (netId {boatId}). Use <color=#7ec8e3>/maxxcrew add</color> to place crew at deck stations.");
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

            Reply(player, $"Crew placed at station [{stationIndex}].");
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
            var toKill = new List<ScientistNPC>();
            foreach (var kv in _crewByNpcNetId)
            {
                if (kv.Value.BoatNetId != boatId) continue;
                var ent = BaseNetworkable.serverEntities.Find(new NetworkableId(kv.Key)) as BaseEntity;
                if (ent is ScientistNPC s && !s.IsDestroyed)
                    toKill.Add(s);
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

            ScientistNPC scientist = null;
            BaseEntity created = null;
            var prefabList = new List<string>();
            if (!string.IsNullOrWhiteSpace(_cfg.ScientistPrefab))
                prefabList.Add(_cfg.ScientistPrefab.Trim());
            foreach (var p in DefaultScientistPrefabs)
            {
                if (!prefabList.Contains(p))
                    prefabList.Add(p);
            }

            foreach (var path in prefabList)
            {
                var ent = GameManager.server.CreateEntity(path, worldPos, worldRot, true);
                if (ent == null) continue;
                var sci = ent as ScientistNPC;
                if (sci != null)
                {
                    scientist = sci;
                    created = ent;
                    break;
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

            if (scientist == null)
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

            return true;
        }

        private static void Reply(BasePlayer player, string msg)
        {
            if (player == null || !player.IsConnected) return;
            player.ChatMessage(msg);
        }
    }
}
