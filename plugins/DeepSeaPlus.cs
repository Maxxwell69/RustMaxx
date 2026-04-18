#nullable disable

using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;

using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using HarmonyLib;
using ProtoBuf;
using Priority = HarmonyLib.Priority;

using UnityEngine;
using Random = UnityEngine.Random;

using Oxide.Core;
using Oxide.Core.Libraries.Covalence;
using Oxide.Core.Plugins;

using Rust;
using Facepunch;
using Network;
using Prefabs.Misc;
using static RpcTarget;

namespace Oxide.Plugins;

[Info("DeepSeaPlus", "crash", "1.2.1")]
[Description("Enhances the Deep Sea experience with notifications, admin tools, custom loot, events, portal features, and more")]
public class DeepSeaPlus : RustPlugin
{
    #region Constants & Fields

    private static DeepSeaPlus _instance;
    private PluginConfig _config;
    private StoredData _data;
    private bool _dataChanged;

    private DeepSeaManager _manager;
    private bool _deepSeaOpen;
    private bool _globalPatchesApplied;
    private bool _originalDeepSeaFogOfWar;
    private DeepSeaTrackingZone _trackingZone;
    private readonly HashSet<Coroutine> _activeCoroutines = new();
    private Dictionary<int, string> _formattedIntervals;
    private HashSet<string> _allowedVehiclePrefabsSet;
    private readonly HashSet<ulong> _playersInDeepSea = new();
    private readonly Dictionary<ulong, PlayerSession> _activeSessions = new();
    private readonly Dictionary<ulong, float> _portalCooldowns = new();
    private readonly Dictionary<ulong, float> _recentFeeCharges = new();
    private readonly Dictionary<ulong, List<SnapshotItem>> _inventorySnapshots = new();
    private readonly HashSet<ulong> _deathsInDeepSea = new();
    private readonly List<BaseEntity> _spawnedEventEntities = new();
    private readonly HashSet<int> _announcedMilestones = new();
    private readonly Dictionary<ulong, int> _foundationCounts = new();
    private readonly HashSet<ulong> _enhancedContainers = new();
    private readonly Dictionary<ulong, float> _portalInfoShownAt = new();
    private readonly List<PortalApproachZone> _portalZones = new();
    private Timer _debugPathTimer;
    private readonly HashSet<BasePlayer> _debugPathViewers = new();
    private readonly Dictionary<ulong, List<Vector3>> _mappingWaypoints = new();
    private Dictionary<string, ItemDefinition> _cachedItemDefs;

    private static readonly Bounds DeepSeaBounds = new(new Vector3(-5900f, 0f, 0f), new Vector3(4000f, 4000f, 4000f));
    private static readonly float[] ShoreSearchOffsets = { 30f, 50f, 80f, 120f, 200f };

    private const string PermAdmin = "deepseaplus.admin";
    private const string PermTeleport = "deepseaplus.tp";
    private const string PermVIP = "deepseaplus.vip";
    private const string PermNotify = "deepseaplus.notify";
    private const string PermStats = "deepseaplus.stats";
    private const string PermBuildBypass = "deepseaplus.build.bypass";

    private const string SmallStashPrefab = "assets/prefabs/deployable/small stash/small_stash_deployed.prefab";
    private const string BradleyPrefab = "assets/prefabs/npc/m2bradley/bradleyapc.prefab";
    private const string SupplyDropPrefab = "assets/prefabs/misc/supply drop/supply_drop.prefab";

    private static readonly Dictionary<DeepSeaIsland.IslandType, Vector3[]> IslandPatrolRoutes = new()
    {
        [DeepSeaIsland.IslandType.Horseshoe] = new[]
        {
            new Vector3(90.7f, 0f, -2.4f),
            new Vector3(65.7f, 0f, -9.2f),
            new Vector3(45.0f, 0f, -7.0f),
            new Vector3(8.5f, 0f, -28.3f),
            new Vector3(-28.9f, 0f, -36.0f),
            new Vector3(-66.5f, 0f, -25.6f),
            new Vector3(-58.0f, 0f, -3.9f),
            new Vector3(-61.9f, 0f, 15.9f),
            new Vector3(-54.1f, 0f, 37.2f),
            new Vector3(-33.7f, 0f, 55.1f),
            new Vector3(-46.3f, 0f, 87.2f),
            new Vector3(-29.5f, 0f, 113.4f),
            new Vector3(-3.8f, 0f, 133.3f),
            new Vector3(22.1f, 0f, 140.7f),
            new Vector3(28.2f, 0f, 128.9f),
            new Vector3(44.6f, 0f, 113.7f),
            new Vector3(14.3f, 0f, 77.0f),
            new Vector3(13.6f, 0f, 42.0f),
            new Vector3(36.0f, 0f, 18.7f),
            new Vector3(61.8f, 0f, 11.3f),
            new Vector3(96.7f, 0f, 28.9f),
            new Vector3(103.4f, 0f, 17.9f) 
        },
        [DeepSeaIsland.IslandType.Blob] = new[]
        {
            new Vector3(40.5f, 0f, -32.4f),
            new Vector3(-7.1f, 0f, -11.6f),
            new Vector3(-50.1f, 0f, 36.6f),
            new Vector3(-85.3f, 0f, 43.1f),
            new Vector3(-88.5f, 0f, -11.2f),
            new Vector3(-53.4f, 0f, -82.1f),
            new Vector3(-34.7f, 0f, -103.7f),
            new Vector3(-22.1f, 0f, -106.5f),
            new Vector3(-10.3f, 0f, -93.8f),
            new Vector3(-1.1f, 0f, -82.6f),
            new Vector3(14.4f, 0f, -95.9f),
            new Vector3(38.0f, 0f, -135.9f),
            new Vector3(60.3f, 0f, -149.9f),
            new Vector3(94.8f, 0f, -128.8f),
            new Vector3(121.9f, 0f, -124.4f),
            new Vector3(130.0f, 0f, -108.4f),
            new Vector3(132.7f, 0f, -83.9f),
            new Vector3(120.3f, 0f, -58.8f),
            new Vector3(85.4f, 0f, -34.0f)
        },
        [DeepSeaIsland.IslandType.Round] = new[]
        {
            new Vector3(-9.1f, 0f, -18.3f),
            new Vector3(-42.7f, 0f, 0.3f),
            new Vector3(-68.4f, 0f, 41.1f),
            new Vector3(-69.1f, 0f, 68.1f),
            new Vector3(-51.8f, 0f, 80.9f),
            new Vector3(-14.6f, 0f, 79.4f),
            new Vector3(8.6f, 0f, 69.9f),
            new Vector3(37.8f, 0f, 37.8f),
            new Vector3(44.1f, 0f, 9.1f),
            new Vector3(27.8f, 0f, -16.7f)
        },
        [DeepSeaIsland.IslandType.Line] = new[]
        {
            new Vector3(8.1f, 0f, 8.8f),
            new Vector3(-22.1f, 0f, 27.6f),
            new Vector3(-56.7f, 0f, 34.9f),
            new Vector3(-65.5f, 0f, 46.3f),
            new Vector3(-88.8f, 0f, 41.0f),
            new Vector3(-98.0f, 0f, 56.5f),
            new Vector3(-78.2f, 0f, 80.6f),
            new Vector3(-62.9f, 0f, 80.5f),
            new Vector3(-37.6f, 0f, 56.2f),
            new Vector3(-14.0f, 0f, 44.7f),
            new Vector3(12.3f, 0f, 34.5f),
            new Vector3(57.6f, 0f, 10.9f),
            new Vector3(67.6f, 0f, -24.5f),
            new Vector3(49.5f, 0f, -41.9f),
            new Vector3(33.3f, 0f, -12.0f)
        }
    };

    private static readonly Translate.Phrase CooldownPhrase = new("deepsea.plus.cooldown", "Portal cooldown is active. Please wait.");
    private static readonly Translate.Phrase InsufficientFundsPhrase = new("deepsea.plus.nofunds", "Insufficient funds to enter the Deep Sea.");
    private static readonly Dictionary<string, string> DiscordHeaders = new() { ["Content-Type"] = "application/json" };

    private const int NcpInfo = 0;
    private const int NcpWarning = 1;
    private const int NcpError = 2;
    private const int NcpSuccess = 3;

    [PluginReference] private readonly Plugin Economics, ServerRewards, NCP;

    private readonly HashSet<string> _conditionalHooks = new()
    {
        nameof(CanBuild)
    };

    private static readonly HashSet<Type> GlobalPatchTypeSet = new()
    {
        typeof(NpcDeathTrackingPatch),
        typeof(LootEntityTrackingPatch),
        typeof(PlayerDeathPatch),
        typeof(PlayerRespawnedPatch),
        typeof(EntityBuiltPatch),
        typeof(EntityKillPatch)
    };

    #endregion

    #region Configuration

    private enum ScheduleMode
    {
        Vanilla,
        AlwaysOpen,
        Disabled
    }

    private enum DeepSeaEnabledOverride
    {
        DontTouch,
        ForceEnabled,
        ForceDisabled
    }

    private sealed class PluginConfig
    {
        [JsonProperty("General Controls")]
        public GeneralControlSettings GeneralControls { get; set; } = new();

        [JsonProperty("Schedule")]
        public ScheduleSettings Schedule { get; set; } = new();

        [JsonProperty("Notifications")]
        public NotificationSettings Notifications { get; set; } = new();

        [JsonProperty("Loot Overrides")]
        public LootOverrideSettings LootOverrides { get; set; } = new();

        [JsonProperty("Portal Settings")]
        public PortalSettings PortalSettings { get; set; } = new();

        [JsonProperty("Deep Sea Overrides")]
        public DeepSeaOverrideSettings DeepSeaOverrides { get; set; } = new();

        [JsonProperty("Respawn System")]
        public RespawnSystemSettings RespawnSystem { get; set; } = new();

        [JsonProperty("Building Controls")]
        public BuildingControlSettings BuildingControls { get; set; } = new();

        [JsonProperty("Events")]
        public EventSettings Events { get; set; } = new();

        [JsonProperty("Death Rules")]
        public DeathRuleSettings DeathRules { get; set; } = new();

        [JsonProperty("Discord Webhook")]
        public DiscordSettings Discord { get; set; } = new();

        [JsonProperty("Config Version (DO NOT MODIFY)")]
        public VersionNumber Version { get; set; }
    }

    private sealed class GeneralControlSettings
    {
        [JsonProperty("Control schedule (enables schedule modes)")]
        public bool ControlSchedule { get; set; }

        [JsonProperty("Control content (enables spawn count overrides)")]
        public bool ControlContent { get; set; }

        [JsonProperty("Control travel rules (enables granular portal access)")]
        public bool ControlTravelRules { get; set; }

        [JsonProperty("Control building (enables building controls)")]
        public bool ControlBuilding { get; set; }

        [JsonProperty("Control loot (enables loot overrides)")]
        public bool ControlLoot { get; set; } = true;

        [JsonProperty("Control events (enables deep sea events)")]
        public bool ControlEvents { get; set; } = true;

        [JsonProperty("Control notifications (enables announcements)")]
        public bool ControlNotifications { get; set; } = true;

        [JsonProperty("Force apply on reload (close and reopen Deep Sea)")]
        public bool ForceApplyOnReload { get; set; }

        [JsonProperty("Enforce interval seconds (0 = once on startup, >0 = repeating)")]
        public float EnforceIntervalSeconds { get; set; }
    }

    private sealed class ScheduleSettings
    {
        [JsonProperty("Mode (Vanilla, AlwaysOpen, Disabled)")]
        [JsonConverter(typeof(StringEnumConverter))]
        public ScheduleMode Mode { get; set; } = ScheduleMode.Vanilla;

        [JsonProperty("Open time seconds (Vanilla mode, overrides wipeDuration)")]
        public int OpenTimeSeconds { get; set; } = 10800;

        [JsonProperty("Cooldown seconds (Vanilla mode, overrides wipeCooldownMin/Max)")]
        public int CooldownSeconds { get; set; } = 5400;

        [JsonProperty("Final phase seconds (Vanilla mode, overrides wipeEndPhaseDuration)")]
        public int FinalPhaseSeconds { get; set; } = 1800;

        [JsonProperty("Radiation warning phase seconds (Vanilla mode)")]
        public int RadiationWarningPhaseSeconds { get; set; } = 300;

        [JsonProperty("AlwaysOpen - Keep time left around (seconds)")]
        public float AlwaysOpenKeepTimeLeftAround { get; set; } = 9000f;

        [JsonProperty("AlwaysOpen - Refill when below (seconds)")]
        public float AlwaysOpenRefillWhenBelow { get; set; } = 3600f;

        [JsonProperty("Disabled - Push next opening to (seconds)")]
        public float DisabledPushNextOpeningTo { get; set; } = 999999f;

        [JsonProperty("Deep Sea enabled override (DontTouch, ForceEnabled, ForceDisabled)")]
        [JsonConverter(typeof(StringEnumConverter))]
        public DeepSeaEnabledOverride EnabledOverride { get; set; } = DeepSeaEnabledOverride.DontTouch;
    }

    private sealed class NotificationSettings
    {
        [JsonProperty("Announce when Deep Sea opens")]
        public bool AnnounceOnOpen { get; set; } = true;

        [JsonProperty("Announce when Deep Sea closes")]
        public bool AnnounceOnClose { get; set; } = true;

        [JsonProperty("Countdown intervals (seconds remaining)", ObjectCreationHandling = ObjectCreationHandling.Replace)]
        public List<int> CountdownIntervals { get; set; } = new() { 1800, 900, 300, 60 };

        [JsonProperty("Use toast messages")]
        public bool UseToastMessages { get; set; } = true;

        [JsonProperty("Use chat messages")]
        public bool UseChatMessages { get; set; } = true;

        [JsonProperty("Countdown check interval (seconds)")]
        public float CountdownCheckInterval { get; set; } = 10f;

        [JsonProperty("Use NCP notifications (requires NCP plugin)")]
        public bool UseNCPNotifications { get; set; }
    }

    private sealed class LootOverrideSettings
    {
        [JsonProperty("Enable loot overrides")]
        public bool Enabled { get; set; } = true;

        [JsonProperty("Stack size multiplier")]
        public float StackMultiplier { get; set; } = 1.5f;

        [JsonProperty("Bonus items", ObjectCreationHandling = ObjectCreationHandling.Replace)]
        public List<BonusItemEntry> BonusItems { get; set; } = new()
        {
            new BonusItemEntry { Shortname = "rifle.ak", Amount = 1, Chance = 0.1f },
            new BonusItemEntry { Shortname = "ammo.rifle", Amount = 128, Chance = 0.5f }
        };

        [JsonProperty("Override hackable crate loot on ghost ships")]
        public bool OverrideHackableCrates { get; set; }

        [JsonProperty("Override hackable crate hack time in Deep Sea (seconds, 0 to use vanilla)")]
        public float HackableCrateHackTimeOverride { get; set; } = 450f;

        [JsonProperty("Hackable crate bonus items", ObjectCreationHandling = ObjectCreationHandling.Replace)]
        public List<BonusItemEntry> HackableCrateBonusItems { get; set; } = new();

        [JsonProperty("Dynamic Loot Scaling")]
        public DynamicLootScalingSettings DynamicScaling { get; set; } = new();
    }

    private sealed class DynamicLootScalingSettings
    {
        [JsonProperty("Enable dynamic scaling")]
        public bool Enabled { get; set; }

        [JsonProperty("Base player threshold")]
        public int BasePlayerThreshold { get; set; } = 3;

        [JsonProperty("Max bonus multiplier")]
        public float MaxBonusMultiplier { get; set; } = 2f;

        [JsonProperty("Bonus per extra player")]
        public float BonusPerExtraPlayer { get; set; } = 0.1f;
    }

    private sealed class BonusItemEntry
    {
        [JsonProperty("Item shortname")]
        public string Shortname { get; set; } = "";

        [JsonProperty("Amount")]
        public int Amount { get; set; } = 1;

        [JsonProperty("Chance (0.0 - 1.0)")]
        public float Chance { get; set; } = 1f;

        [JsonProperty("Skin ID")]
        public ulong SkinId { get; set; }
    }

    private sealed class EntitySpawnOverride
    {
        [JsonProperty("Count")]
        public int Count { get; set; }

        [JsonProperty("Radius")]
        public float Radius { get; set; }

        [JsonProperty("Edge margin")]
        public float EdgeMargin { get; set; }

        [JsonProperty("Minimum distance")]
        public float MinDistance { get; set; }
    }

    private sealed class PortalSettings
    {
        [JsonProperty("Enable portal features")]
        public bool EnablePortalFeatures { get; set; } = true;

        [JsonProperty("Cooldown after leaving Deep Sea (seconds)")]
        public float CooldownSeconds { get; set; } = 300f;

        [JsonProperty("Entry fee amount (0 to disable)")]
        public double EntryFee { get; set; } = 500.0;

        [JsonProperty("Entry fee plugin (Economics or ServerRewards)")]
        public string EntryFeePlugin { get; set; } = "Economics";

        [JsonProperty("VIP bypasses cooldown")]
        public bool VIPBypassCooldown { get; set; } = true;

        [JsonProperty("VIP bypasses food toll")]
        public bool VIPBypassFoodToll { get; set; } = true;

        [JsonProperty("Allow any vehicle (bypass whitelist)")]
        public bool AllowAnyVehicle { get; set; }

        [JsonProperty("Allowed vehicle prefabs (overrides vanilla whitelist)", ObjectCreationHandling = ObjectCreationHandling.Replace)]
        public List<string> AllowedVehiclePrefabs { get; set; } = new();

        [JsonProperty("Require boat type only")]
        public bool RequireBoatTypeOnly { get; set; } = true;

        [JsonProperty("Allow players without vehicle (on foot)")]
        public bool AllowPlayersWithoutVehicle { get; set; }

        [JsonProperty("Allow noclip/admin players to bypass checks")]
        public bool AllowNoclipPlayers { get; set; } = true;

        [JsonProperty("Allow NPC passengers")]
        public bool AllowNPCPassengers { get; set; }

        [JsonProperty("Allow NPC player teleport")]
        public bool AllowNPCPlayerTeleport { get; set; }

        [JsonProperty("Allow entry during radiation warning phase")]
        public bool AllowEntryDuringRadiationWarningPhase { get; set; }

        [JsonProperty("Ignore extra vehicle onboard check")]
        public bool IgnoreExtraVehicleOnboardCheck { get; set; }

        [JsonProperty("Log entry/exit decisions")]
        public bool LogEntryExit { get; set; }

        [JsonProperty("Show info panel on portal approach")]
        public bool PortalApproachInfoEnabled { get; set; } = true;

        [JsonProperty("Portal approach trigger radius (portals are ~300 wide)")]
        public float PortalApproachRadius { get; set; } = 150f;

        [JsonProperty("Portal info cooldown per player (seconds)")]
        public float PortalInfoCooldownSeconds { get; set; } = 30f;
    }

    private sealed class DeepSeaOverrideSettings
    {
        [JsonProperty("Enable ConVar overrides")]
        public bool Enabled { get; set; }

        [JsonProperty("Wipe duration (seconds)")]
        public int WipeDuration { get; set; } = 10800;

        [JsonProperty("Wipe cooldown min (seconds)")]
        public int WipeCooldownMin { get; set; } = 5400;

        [JsonProperty("Wipe cooldown max (seconds)")]
        public int WipeCooldownMax { get; set; } = 10800;

        [JsonProperty("Radiation phase duration (seconds)")]
        public int WipeRadiationPhaseDuration { get; set; } = 300;

        [JsonProperty("End phase duration (seconds)")]
        public int WipeEndPhaseDuration { get; set; } = 1800;

        [JsonProperty("Island Spawns")]
        public EntitySpawnOverride Islands { get; set; } = new() { Count = 6, Radius = 100f, EdgeMargin = 200f, MinDistance = 400f };

        [JsonProperty("Ghost Ship Spawns")]
        public EntitySpawnOverride GhostShips { get; set; } = new() { Count = 4, Radius = 200f, EdgeMargin = 450f, MinDistance = 400f };

        [JsonProperty("Floating City Spawns")]
        public EntitySpawnOverride FloatingCities { get; set; } = new() { Count = 1, Radius = 300f, EdgeMargin = 1500f, MinDistance = 1500f };

        [JsonProperty("RHIB Spawns")]
        public EntitySpawnOverride RHIBs { get; set; } = new() { Count = 4, Radius = 10f, EdgeMargin = 1150f, MinDistance = 300f };

        [JsonProperty("Hackable crate count")]
        public int HackableCrateCount { get; set; } = 1;

        [JsonProperty("Force entrance portal direction (0=Map-based, 1=N, 2=E, 3=S, 4=W)")]
        public int ForceEntrancePortalDirection { get; set; }

        [JsonProperty("Remove fog of war")]
        public bool RemoveFogOfWar { get; set; }
    }

    private sealed class EventSettings
    {
        [JsonProperty("Treasure Hunt")]
        public TreasureHuntSettings TreasureHunt { get; set; } = new();

        [JsonProperty("Boss Spawn")]
        public BossSpawnSettings BossSpawn { get; set; } = new();

        [JsonProperty("Supply Drops")]
        public SupplyDropSettings SupplyDrops { get; set; } = new();

        [JsonProperty("Announce ghost ship crate hacking")]
        public bool AnnounceGhostShipHack { get; set; } = true;
    }

    private sealed class TreasureHuntSettings
    {
        [JsonProperty("Enable treasure hunt")]
        public bool Enabled { get; set; } = true;

        [JsonProperty("Number of stashes to spawn")]
        public int Count { get; set; } = 3;

        [JsonProperty("Treasure items", ObjectCreationHandling = ObjectCreationHandling.Replace)]
        public List<BonusItemEntry> TreasureItems { get; set; } = new()
        {
            new BonusItemEntry { Shortname = "supply.signal", Amount = 2, Chance = 1f },
            new BonusItemEntry { Shortname = "targeting.computer", Amount = 1, Chance = 0.5f },
            new BonusItemEntry { Shortname = "techparts", Amount = 3, Chance = 1f }
        };

        [JsonProperty("Show treasure markers on map")]
        public bool ShowMapMarkers { get; set; } = true;

        [JsonProperty("Map marker radius")]
        public float MapMarkerRadius { get; set; } = 0.08f;
    }

    private sealed class BossSpawnSettings
    {
        [JsonProperty("Enable boss spawn")]
        public bool Enabled { get; set; }

        [JsonProperty("Minutes before wipe to spawn boss")]
        public int MinutesBeforeWipe { get; set; } = 30;

        [JsonProperty("Boss health multiplier")]
        public float HealthMultiplier { get; set; } = 2f;

        [JsonProperty("Patrol radius around island")]
        public float PatrolRadius { get; set; } = 75f;

        [JsonProperty("Show boss marker on map")]
        public bool ShowMapMarker { get; set; } = true;

        [JsonProperty("Boss map marker radius")]
        public float MapMarkerRadius { get; set; } = 0.15f;
    }

    private sealed class SupplyDropSettings
    {
        [JsonProperty("Enable supply drops")]
        public bool Enabled { get; set; } = true;

        [JsonProperty("Interval between drops (minutes)")]
        public int IntervalMinutes { get; set; } = 45;

        [JsonProperty("Show supply drop markers on map")]
        public bool ShowMapMarkers { get; set; } = true;
    }

    private sealed class DeathRuleSettings
    {
        [JsonProperty("Enable death tracking")]
        public bool EnableDeathTracking { get; set; } = true;

        [JsonProperty("Show death summary message")]
        public bool ShowDeathMessage { get; set; } = true;

        [JsonProperty("Snapshot inventory on entry")]
        public bool SnapshotInventoryOnEntry { get; set; }

        [JsonProperty("Restore inventory on respawn after Deep Sea death")]
        public bool RestoreInventoryOnRespawn { get; set; }
    }

    private sealed class RespawnSystemSettings
    {
        [JsonProperty("Enable respawn system")]
        public bool Enabled { get; set; }

        [JsonProperty("Check interval (minutes)")]
        public float CheckIntervalMinutes { get; set; } = 15f;

        [JsonProperty("Minimum distance from players to respawn")]
        public float MinDistanceFromPlayers { get; set; } = 50f;

        [JsonProperty("Respawn hackable crates via ghost ships")]
        public bool RespawnHackableCrates { get; set; } = true;

        [JsonProperty("Maximum hackable crates active at once")]
        public int HackableCratesCount { get; set; } = 1;

        [JsonProperty("Trigger island spawn groups (NPCs/loot)")]
        public bool TriggerIslandSpawnGroups { get; set; } = true;

        [JsonProperty("Respawn RHIBs when all are destroyed")]
        public bool RespawnRHIBs { get; set; } = true;

        [JsonProperty("RHIB groups to respawn (each group = 3 boats)")]
        public int RHIBGroupCount { get; set; } = 4;
    }

    private sealed class BuildingControlSettings
    {
        [JsonProperty("Allow building in Deep Sea")]
        public bool AllowBuildingInDeepSea { get; set; }

        [JsonProperty("Limit foundations per player")]
        public bool LimitFoundations { get; set; }

        [JsonProperty("Max foundations per player")]
        public int MaxFoundationsPerPlayer { get; set; } = 10;

        [JsonProperty("Show remaining foundations on place")]
        public bool ShowRemainingOnPlace { get; set; } = true;

        [JsonProperty("Show message when denied")]
        public bool ShowMessageWhenDenied { get; set; } = true;
    }

    private sealed class DiscordSettings
    {
        [JsonProperty("Enable Discord webhook")]
        public bool Enabled { get; set; }

        [JsonProperty("Webhook URL")]
        public string WebhookUrl { get; set; } = "";

        [JsonProperty("Announce Deep Sea open")]
        public bool AnnounceOpen { get; set; } = true;

        [JsonProperty("Announce Deep Sea close")]
        public bool AnnounceClose { get; set; } = true;

        [JsonProperty("Announce notable player achievements")]
        public bool AnnounceAchievements { get; set; } = true;

        [JsonProperty("Embed color (decimal)")]
        public int EmbedColor { get; set; } = 3447003;
    }

    protected override void LoadDefaultConfig()
    {
        _config = new PluginConfig { Version = Version };
        SaveConfig();
    }

    protected override void LoadConfig()
    {
        base.LoadConfig();
        try
        {
            _config = Config.ReadObject<PluginConfig>();
            if (_config == null)
            {
                LoadDefaultConfig();
                return;
            }
            if (_config.Version < Version)
            {
                MigrateConfig();
                _config.Version = Version;
            }
        }
        catch
        {
            PrintError("Configuration file is corrupt. Creating new config.");
            LoadDefaultConfig();
        }
        ValidateConfig();
        SaveConfig();
    }

    protected override void SaveConfig() => Config.WriteObject(_config, true);

    private void ValidateConfig()
    {
        var n = _config.Notifications;
        n.CountdownCheckInterval = Mathf.Max(n.CountdownCheckInterval, 1f);

        var l = _config.LootOverrides;
        l.StackMultiplier = Mathf.Max(l.StackMultiplier, 1f);
        l.HackableCrateHackTimeOverride = Mathf.Max(l.HackableCrateHackTimeOverride, 0f);

        var ds = l.DynamicScaling;
        if (ds != null)
        {
            ds.BasePlayerThreshold = Mathf.Max(ds.BasePlayerThreshold, 1);
            ds.MaxBonusMultiplier = Mathf.Max(ds.MaxBonusMultiplier, 1f);
            ds.BonusPerExtraPlayer = Mathf.Max(ds.BonusPerExtraPlayer, 0f);
        }

        var p = _config.PortalSettings;
        p.CooldownSeconds = Mathf.Max(p.CooldownSeconds, 0f);
        p.EntryFee = Math.Max(p.EntryFee, 0);
        p.PortalApproachRadius = Mathf.Max(p.PortalApproachRadius, 10f);
        p.PortalInfoCooldownSeconds = Mathf.Max(p.PortalInfoCooldownSeconds, 0f);

        var b = _config.BuildingControls;
        b.MaxFoundationsPerPlayer = Mathf.Max(b.MaxFoundationsPerPlayer, 1);

        var boss = _config.Events.BossSpawn;
        boss.HealthMultiplier = Mathf.Max(boss.HealthMultiplier, 1f);
        boss.PatrolRadius = Mathf.Max(boss.PatrolRadius, 10f);
        boss.MinutesBeforeWipe = Mathf.Max(boss.MinutesBeforeWipe, 1);

        var sd = _config.Events.SupplyDrops;
        sd.IntervalMinutes = Mathf.Max(sd.IntervalMinutes, 1);

        var th = _config.Events.TreasureHunt;
        th.Count = Mathf.Max(th.Count, 1);

        if (p.EntryFee > 0 && string.IsNullOrEmpty(p.EntryFeePlugin))
            PrintWarning("Entry fee is set but EntryFeePlugin is empty. Fee checks will fail.");

        if (!string.IsNullOrEmpty(p.EntryFeePlugin) &&
            !string.Equals(p.EntryFeePlugin, "Economics", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(p.EntryFeePlugin, "ServerRewards", StringComparison.OrdinalIgnoreCase))
            PrintWarning($"Unknown EntryFeePlugin '{p.EntryFeePlugin}'. Must be 'Economics' or 'ServerRewards'.");
    }

    private void MigrateConfig()
    {
        _config.GeneralControls ??= new GeneralControlSettings();
        _config.Schedule ??= new ScheduleSettings();
        _config.Notifications ??= new NotificationSettings();
        _config.LootOverrides ??= new LootOverrideSettings();
        _config.PortalSettings ??= new PortalSettings();
        _config.DeepSeaOverrides ??= new DeepSeaOverrideSettings();
        _config.RespawnSystem ??= new RespawnSystemSettings();
        _config.BuildingControls ??= new BuildingControlSettings();
        _config.Events ??= new EventSettings();
        _config.DeathRules ??= new DeathRuleSettings();
        _config.Discord ??= new DiscordSettings();

        var overrides = _config.DeepSeaOverrides;
        overrides.Islands ??= new EntitySpawnOverride { Count = 6, Radius = 100f, EdgeMargin = 200f, MinDistance = 400f };
        overrides.GhostShips ??= new EntitySpawnOverride { Count = 4, Radius = 200f, EdgeMargin = 450f, MinDistance = 400f };
        overrides.FloatingCities ??= new EntitySpawnOverride { Count = 1, Radius = 300f, EdgeMargin = 1500f, MinDistance = 1500f };
        overrides.RHIBs ??= new EntitySpawnOverride { Count = 4, Radius = 10f, EdgeMargin = 1150f, MinDistance = 300f };

        _config.LootOverrides.DynamicScaling ??= new DynamicLootScalingSettings();
        
        try
        {
            var rawConfig = Config.ReadObject<Dictionary<string, object>>();
            if (rawConfig != null && rawConfig.TryGetValue("Deep Sea Overrides", out var overridesObj))
            {
                if (overridesObj is JObject overridesJObj)
                {
                    if (overridesJObj["Wipe cooldown (seconds)"] != null &&
                        overridesJObj["Wipe cooldown min (seconds)"] == null)
                    {
                        var oldCooldown = overridesJObj["Wipe cooldown (seconds)"]?.Value<int>() ?? 5400;
                        _config.DeepSeaOverrides.WipeCooldownMin = oldCooldown;
                        _config.DeepSeaOverrides.WipeCooldownMax = oldCooldown;
                        Puts($"Migrated WipeCooldown ({oldCooldown}s) to WipeCooldownMin/WipeCooldownMax.");
                    }
                }
            }
        }
        catch
        {
            // Ignore migration errors for raw config reading
        }

        Puts("Configuration migrated to latest version.");
    }

    #endregion

    #region Data Classes

    [ProtoContract]
    private sealed class StoredData
    {
        [ProtoMember(1)]
        public readonly Dictionary<ulong, PlayerLifetimeStats> PlayerStats = new();

        [ProtoMember(2)]
        public int TotalCyclesCompleted;
    }

    [ProtoContract]
    private sealed class PlayerLifetimeStats
    {
        [ProtoMember(1)] public string DisplayName = "";
        [ProtoMember(2)] public int TotalVisits;
        [ProtoMember(3)] public float TotalTimeSpent;
        [ProtoMember(4)] public int TotalNpcKills;
        [ProtoMember(5)] public int TotalContainersLooted;
        [ProtoMember(6)] public int TotalDeaths;
    }

    private sealed class PlayerSession : Pool.IPooled
    {
        public ulong UserId;
        public string DisplayName;
        public float EntryTime;
        public int NpcKills;
        public int ContainersLooted;
        public int Deaths;
        public bool HasDiedThisCycle;
        public BasePlayer Player;

        public void EnterPool()
        {
            UserId = 0;
            DisplayName = null;
            EntryTime = 0f;
            NpcKills = 0;
            ContainersLooted = 0;
            Deaths = 0;
            HasDiedThisCycle = false;
            Player = null;
        }

        public void LeavePool() { }
    }

    private struct SnapshotItem
    {
        public string Shortname;
        public int Amount;
        public float Condition;
        public float MaxCondition;
        public ulong SkinId;
        public int Position;
        public string Container;
        public int BlueprintTarget;
        public List<SnapshotItem> Contents;
    }

    #endregion

    #region Initialization & Cleanup

    private void Init()
    {
        _instance = this;

        permission.RegisterPermission(PermAdmin, this);
        permission.RegisterPermission(PermTeleport, this);
        permission.RegisterPermission(PermVIP, this);
        permission.RegisterPermission(PermNotify, this);
        permission.RegisterPermission(PermStats, this);
        permission.RegisterPermission(PermBuildBypass, this);

        foreach (var hook in _conditionalHooks)
            Unsubscribe(hook);

        LoadData();

        PatchNestedClasses();
    }

    private void OnServerInitialized()
    {
        _manager = FindDeepSeaManager();
        CacheFormattedIntervals();
        CacheAllowedVehiclePrefabs();
        CacheItemDefinitions();

        if (_manager is null)
            PrintWarning("DeepSeaManager not found on this server. Hooks will activate if it spawns later.");
        else if (_manager.IsOpen())
        {
            _deepSeaOpen = true;
            ApplyGlobalPatches();
            SubscribeConditionalHooks();
            StartCountdownTimer();
            AttachTrackingZone();
            AttachPortalApproachZones();

            if (_config.GeneralControls.ControlBuilding && _config.BuildingControls.LimitFoundations)
                StartTrackedCoroutine(ScanExistingFoundationsCoroutine());

            if (_config.GeneralControls.ControlEvents)
                ScheduleEvents();

            if (_config.RespawnSystem.Enabled)
                StartRespawnTimer();
        }

        if (_config.DeepSeaOverrides.Enabled)
            ApplyConVarOverrides();

        if (_config.GeneralControls.ControlSchedule)
        {
            ApplyScheduleMode();

            if (_config.Schedule.EnabledOverride != DeepSeaEnabledOverride.DontTouch)
            {
                ConVar.DeepSea.enabled = _config.Schedule.EnabledOverride == DeepSeaEnabledOverride.ForceEnabled;
                BroadcastReplicatedVars();
            }
        }

        if (_config.GeneralControls.EnforceIntervalSeconds > 0f)
            StartEnforceTimer();

        if (_config.GeneralControls.ForceApplyOnReload && _manager is not null)
        {
            if (!_manager.IsBusy())
            {
                Puts("Force apply on reload enabled - closing and reopening Deep Sea.");
                _manager.CloseDeepSea();
                timer.Once(15f, () =>
                {
                    if (_manager is null || _manager.IsDestroyed || _manager.IsBusy()) return;
                    _manager.OpenDeepSea();
                });
            }
            else
            {
                Puts("Force apply on reload skipped - Deep Sea is busy transitioning.");
            }
        }

        if (_config.GeneralControls.ControlBuilding && !_config.DeepSeaOverrides.Enabled)
            ConVar.DeepSea.block_building = !_config.BuildingControls.AllowBuildingInDeepSea;
    }

    private void Unload()
    {
        _debugPathTimer?.Destroy();
        _debugPathTimer = null;
        _debugPathViewers.Clear();
        _mappingWaypoints.Clear();

        RemoveGlobalPatches();
        StopCountdownTimer();
        StopEnforceTimer();
        StopEventTimers();
        StopRespawnTimer();
        StopAllTrackedCoroutines();

        DetachTrackingZone();
        DetachPortalApproachZones();
        CleanupEventEntities();

        foreach (var session in _activeSessions.Values)
        {
            FinalizeSession(session);
            var s = session; Pool.Free(ref s);
        }
        _activeSessions.Clear();
        _playersInDeepSea.Clear();

        _foundationCounts.Clear();
        _enhancedContainers.Clear();
        _inventorySnapshots.Clear();
        _deathsInDeepSea.Clear();
        _portalCooldowns.Clear();
        _recentFeeCharges.Clear();
        _portalInfoShownAt.Clear();
        _announcedMilestones.Clear();

        if (_config.DeepSeaOverrides.Enabled && _config.DeepSeaOverrides.RemoveFogOfWar)
        {
            ConVar.Server.deepSeaFogofwar = _originalDeepSeaFogOfWar;
            BroadcastReplicatedVars();
        }

        SaveData();

        _instance = null;
    }

    private void OnServerSave()
    {
        if (!_dataChanged) return;
        SaveData();
        _dataChanged = false;
    }

    private static DeepSeaManager FindDeepSeaManager()
    {
        try { return UnityEngine.Object.FindFirstObjectByType<DeepSeaManager>(); }
        catch { return null; }
    }

    private void ApplyConVarOverrides()
    {
        var cfg = _config.DeepSeaOverrides;
        var gc = _config.GeneralControls;
        try
        {
            ConVar.DeepSea.wipeDuration = cfg.WipeDuration;
            ConVar.DeepSea.wipeCooldownMin = cfg.WipeCooldownMin;
            ConVar.DeepSea.wipeCooldownMax = cfg.WipeCooldownMax;
            ConVar.DeepSea.wipeRadiationPhaseDuration = cfg.WipeRadiationPhaseDuration;
            ConVar.DeepSea.wipeEndPhaseDuration = cfg.WipeEndPhaseDuration;

            if (gc.ControlContent)
            {
                ConVar.DeepSea.island_count = cfg.Islands.Count;
                ConVar.DeepSea.island_radius = cfg.Islands.Radius;
                ConVar.DeepSea.island_edgeMargin = cfg.Islands.EdgeMargin;
                ConVar.DeepSea.island_minDist = cfg.Islands.MinDistance;
                ConVar.DeepSea.ghostship_count = cfg.GhostShips.Count;
                ConVar.DeepSea.ghostship_radius = cfg.GhostShips.Radius;
                ConVar.DeepSea.ghostship_edgeMargin = cfg.GhostShips.EdgeMargin;
                ConVar.DeepSea.ghostship_minDist = cfg.GhostShips.MinDistance;
                ConVar.DeepSea.floatingcity_count = cfg.FloatingCities.Count;
                ConVar.DeepSea.floatingcity_radius = cfg.FloatingCities.Radius;
                ConVar.DeepSea.floatingcity_edgeMargin = cfg.FloatingCities.EdgeMargin;
                ConVar.DeepSea.floatingcity_minDist = cfg.FloatingCities.MinDistance;
                ConVar.DeepSea.rhib_count = cfg.RHIBs.Count;
                ConVar.DeepSea.rhib_radius = cfg.RHIBs.Radius;
                ConVar.DeepSea.rhib_edgeMargin = cfg.RHIBs.EdgeMargin;
                ConVar.DeepSea.rhib_minDist = cfg.RHIBs.MinDistance;
                ConVar.DeepSea.hackablecrate_count = cfg.HackableCrateCount;
            }

            if (gc.ControlBuilding)
                ConVar.DeepSea.block_building = !_config.BuildingControls.AllowBuildingInDeepSea;

            if (gc.ControlTravelRules)
            {
                ConVar.DeepSea.allow_all_vehicles = _config.PortalSettings.AllowAnyVehicle;
                ConVar.DeepSea.allow_swimmers = _config.PortalSettings.AllowPlayersWithoutVehicle;
            }

            if (cfg.ForceEntrancePortalDirection > 0)
                ConVar.DeepSea.forceEntrancePortalDirection = cfg.ForceEntrancePortalDirection;

            if (!cfg.RemoveFogOfWar) return;
            _originalDeepSeaFogOfWar = ConVar.Server.deepSeaFogofwar;
            ConVar.Server.deepSeaFogofwar = false;
            BroadcastReplicatedVars();

            //Puts("Deep Sea ConVar overrides applied.");
        }
        catch (Exception ex)
        {
            PrintWarning($"Failed to apply some ConVar overrides: {ex.Message}");
        }
    }

    private static void BroadcastReplicatedVars()
    {
        foreach (var player in BasePlayer.activePlayerList)
        {
            if (player?.net?.connection != null)
                ServerMgr.SendReplicatedVars(player.net.connection);
        }
    }

    private void SubscribeConditionalHooks()
    {
        if (!_config.GeneralControls.ControlBuilding) return;
        Subscribe(nameof(CanBuild));
    }

    private void UnsubscribeConditionalHooks()
    {
        foreach (var hook in _conditionalHooks)
            Unsubscribe(hook);
    }

    private void PatchNestedClasses()
    {
        foreach (var type in typeof(DeepSeaPlus).GetNestedTypes(BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Public))
        {
            var harmonyPatchAttributes = type.GetCustomAttributes(typeof(HarmonyPatch), true);
            if (harmonyPatchAttributes.Length == 0) continue;

            if (GlobalPatchTypeSet.Contains(type)) continue;

            try
            {
                HarmonyInstance.CreateClassProcessor(type).Patch();
            }
            catch (Exception ex)
            {
                PrintError($"Failed to apply Harmony patch for nested type {type.Name}: {ex}");
            }
        }
    }

    private void ApplyGlobalPatches()
    {
        if (_globalPatchesApplied) return;

        foreach (var type in GlobalPatchTypeSet)
        {
            try
            {
                HarmonyInstance.CreateClassProcessor(type).Patch();
            }
            catch (Exception ex)
            {
                PrintError($"Failed to apply global Harmony patch {type.Name}: {ex}");
            }
        }

        _globalPatchesApplied = true;
        //Puts("Global Harmony patches applied (Deep Sea open).");
    }

    private void RemoveGlobalPatches()
    {
        if (!_globalPatchesApplied) return;

        var harmonyId = HarmonyInstance.Id;

        UnpatchMethod(typeof(BaseCombatEntity), nameof(BaseCombatEntity.Die), harmonyId);
        UnpatchMethod(typeof(BaseNetworkable), nameof(BaseNetworkable.Kill), harmonyId);
        UnpatchMethod(typeof(BasePlayer), nameof(BasePlayer.Die), harmonyId);
        UnpatchMethod(typeof(BasePlayer), nameof(BasePlayer.RespawnAt), harmonyId);
        UnpatchMethod(typeof(PlayerLoot), nameof(PlayerLoot.StartLootingEntity), harmonyId);
        UnpatchMethod(typeof(Planner), "DoBuild", harmonyId,
            new[] { typeof(Construction.Target), typeof(Construction) });

        _globalPatchesApplied = false;
        //Puts("Global Harmony patches removed (Deep Sea closed).");
    }

    private void UnpatchMethod(Type type, string methodName, string harmonyId, Type[] parameters = null)
    {
        try
        {
            var original = parameters != null
                ? AccessTools.Method(type, methodName, parameters)
                : AccessTools.Method(type, methodName);
            if (original != null)
                HarmonyInstance.Unpatch(original, HarmonyPatchType.All, harmonyId);
        }
        catch (Exception ex)
        {
            PrintWarning($"Failed to unpatch {type.Name}.{methodName}: {ex.Message}");
        }
    }

    private void CacheFormattedIntervals()
    {
        _formattedIntervals = new Dictionary<int, string>();
        if (_config.Notifications.CountdownIntervals == null) return;
        foreach (var interval in _config.Notifications.CountdownIntervals)
            _formattedIntervals[interval] = FormatTime(interval);
    }

    private void CacheAllowedVehiclePrefabs()
    {
        _allowedVehiclePrefabsSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (_config.PortalSettings.AllowedVehiclePrefabs == null) return;
        foreach (var prefab in _config.PortalSettings.AllowedVehiclePrefabs)
        {
            if (!string.IsNullOrEmpty(prefab))
                _allowedVehiclePrefabsSet.Add(prefab);
        }
    }

    private void CacheItemDefinitions()
    {
        _cachedItemDefs = new Dictionary<string, ItemDefinition>(StringComparer.OrdinalIgnoreCase);

        CacheList(_config.LootOverrides.BonusItems, "LootOverrides.BonusItems");
        CacheList(_config.LootOverrides.HackableCrateBonusItems, "LootOverrides.HackableCrateBonusItems");
        CacheList(_config.Events.TreasureHunt.TreasureItems, "TreasureHunt.TreasureItems");

        //Puts($"Cached {_cachedItemDefs.Count} item definitions from config.");
        return;

        void CacheList(List<BonusItemEntry> list, string source)
        {
            if (list == null) return;
            for (var i = 0; i < list.Count; i++)
            {
                var shortname = list[i].Shortname;
                if (string.IsNullOrEmpty(shortname) || _cachedItemDefs.ContainsKey(shortname)) continue;

                var def = ItemManager.FindItemDefinition(shortname);
                if (def is not null)
                    _cachedItemDefs[shortname] = def;
                else
                    PrintWarning($"Invalid item shortname '{shortname}' in {source} config.");
            }
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private ItemDefinition GetCachedItemDef(string shortname)
    {
        if (_cachedItemDefs != null && _cachedItemDefs.TryGetValue(shortname, out var def))
            return def;
        return ItemManager.FindItemDefinition(shortname);
    }

    #endregion

    #region Localization

    protected override void LoadDefaultMessages()
    {
        lang.RegisterMessages(new Dictionary<string, string>
        {
            ["DeepSea.Opened"] = "<size=14><color=#5bc0de>DEEP SEA OPENED</color></size>\n<size=11><color=#DBE2E9>The Deep Sea has opened! Find the portal and sail in before it closes.</color></size>",
            ["DeepSea.Closing"] = "<size=14><color=#d9534f>DEEP SEA CLOSING</color></size>\n<size=11><color=#DBE2E9>The Deep Sea is closing! All players inside will be irradiated.</color></size>",
            ["DeepSea.Closed"] = "<size=14><color=#5bc0de>DEEP SEA CLOSED</color></size>\n<size=11><color=#DBE2E9>The Deep Sea has closed. It will reopen in <color=#F3E7B3>{0}</color>.</color></size>",
            ["DeepSea.Countdown"] = "<size=14><color=#f0ad4e>DEEP SEA COUNTDOWN</color></size>\n<size=11><color=#DBE2E9><color=#E45858>{0}</color> remaining before the Deep Sea wipes!</color></size>",
            ["DeepSea.Toast.Opened"] = "The Deep Sea has opened! Sail to the portal.",
            ["DeepSea.Toast.Closing"] = "WARNING: Deep Sea closing! Evacuate now!",
            ["DeepSea.Toast.Countdown"] = "{0} remaining in the Deep Sea!",
            ["Admin.NoPermission"] = "<size=12><color=#d9534f>You do not have permission to use this command.</color></size>",
            ["Admin.NoManager"] = "<size=12><color=#d9534f>DeepSeaManager is not available on this server.</color></size>",
            ["Admin.Status.Header"] = "<size=16><color=#5bc0de>DEEP SEA STATUS</color></size>",
            ["Admin.Status.State"] = "<size=12><color=#DBE2E9>State:</color> <color=#f0ad4e>{0}</color></size>",
            ["Admin.Status.TimeToWipe"] = "<size=12><color=#DBE2E9>Time to Wipe:</color> <color=#F3E7B3>{0}</color></size>",
            ["Admin.Status.TimeToOpen"] = "<size=12><color=#DBE2E9>Time to Next Opening:</color> <color=#F3E7B3>{0}</color></size>",
            ["Admin.Status.Players"] = "<size=12><color=#DBE2E9>Players Inside:</color> <color=#F3E7B3>{0}</color></size>",
            ["Admin.Status.Islands"] = "<size=12><color=#DBE2E9>Islands: <color=#F3E7B3>{0}</color> | Ghost Ships: <color=#F3E7B3>{1}</color> | Floating Cities: <color=#F3E7B3>{2}</color> | RHIBs: <color=#F3E7B3>{3}</color></color></size>",
            ["Admin.Status.Entities"] = "<size=12><color=#DBE2E9>Total Event Entities:</color> <color=#F3E7B3>{0}</color></size>",
            ["Admin.Tp.ToDeepSea"] = "<size=14><color=#9CFF1E>TELEPORTED</color></size>\n<size=11><color=#DBE2E9>Teleported to the nearest Deep Sea island.</color></size>",
            ["Admin.Tp.ToMain"] = "<size=14><color=#9CFF1E>TELEPORTED</color></size>\n<size=11><color=#DBE2E9>Teleported back to the main island.</color></size>",
            ["Admin.Tp.Island"] = "<size=14><color=#9CFF1E>TELEPORTED</color></size>\n<size=11><color=#DBE2E9>Teleported to island <color=#F3E7B3>#{0}</color>.</color></size>",
            ["Admin.Tp.NoIslands"] = "<size=12><color=#d9534f>No islands found in the Deep Sea.</color></size>",
            ["Admin.Tp.NotOpen"] = "<size=12><color=#d9534f>The Deep Sea is not open. Use <color=#f0ad4e>/deepsea forceopen</color> first.</color></size>",
            ["Admin.Kick.Usage"] = "<size=12><color=#DBE2E9>Usage: <color=#f0ad4e>/deepsea kick &lt;player name or id&gt;</color></color></size>",
            ["Admin.Help.Header"] = "<size=16><color=#5bc0de>DEEP SEA COMMANDS</color></size>",
            ["Admin.Kick.NotFound"] = "<size=12><color=#d9534f>Player '<color=#F3E7B3>{0}</color>' not found.</color></size>",
            ["Admin.Kick.NotInDeepSea"] = "<size=12><color=#d9534f>Player '<color=#F3E7B3>{0}</color>' is not in the Deep Sea.</color></size>",
            ["Admin.Kick.Success"] = "<size=14><color=#9CFF1E>PLAYER EJECTED</color></size>\n<size=11><color=#DBE2E9>Ejected '<color=#F3E7B3>{0}</color>' from the Deep Sea.</color></size>",
            ["Admin.Kick.Notify"] = "<size=14><color=#d9534f>EJECTED</color></size>\n<size=11><color=#DBE2E9>You have been ejected from the Deep Sea by an admin.</color></size>",
            ["Admin.ForceOpen"] = "<size=12><color=#f0ad4e>Force-opening the Deep Sea...</color></size>",
            ["Admin.ForceClose"] = "<size=12><color=#f0ad4e>Force-closing the Deep Sea...</color></size>",
            ["Portal.Cooldown"] = "<size=14><color=#d9534f>PORTAL COOLDOWN</color></size>\n<size=11><color=#DBE2E9>Portal cooldown active. Wait <color=#E45858>{0}</color> seconds.</color></size>",
            ["Portal.FeePaid"] = "<size=14><color=#9CFF1E>FEE CHARGED</color></size>\n<size=11><color=#DBE2E9>Charged <color=#F3E7B3>{0} {1}</color> for Deep Sea entry.</color></size>",
            ["Portal.NoFunds"] = "<size=14><color=#d9534f>INSUFFICIENT FUNDS</color></size>\n<size=11><color=#DBE2E9>You need <color=#E45858>{0} {1}</color> to enter the Deep Sea.</color></size>",
            ["Portal.Info.Open"] = "<size=12><color=#DBE2E9>Deep Sea is <color=#9CFF1E>OPEN</color> | Time left: <color=#F3E7B3>{0}</color> | Players inside: <color=#F3E7B3>{1}</color>{2}</color></size>",
            ["Portal.Info.Closed"] = "<size=12><color=#DBE2E9>Deep Sea is <color=#d9534f>CLOSED</color> | Opens in: <color=#F3E7B3>{0}</color>{1}</color></size>",
            ["Portal.Info.Fee"] = " | Entry fee: <color=#F3E7B3>{0} {1}</color>",
            ["Tracking.Welcome"] = "<size=14><color=#5bc0de>WELCOME TO THE DEEP SEA</color></size>\n<size=11><color=#DBE2E9>Good luck out there, <color=#F3E7B3>{0}</color>!</color></size>",
            ["Tracking.Farewell"] = "<size=14><color=#5bc0de>DEEP SEA SESSION COMPLETE</color></size>\n<size=11><color=#DBE2E9>Time: <color=#F3E7B3>{0}</color>\nNPCs Killed: <color=#F3E7B3>{1}</color>\nContainers Looted: <color=#F3E7B3>{2}</color></color></size>",
            ["Tracking.Stats.Header"] = "<size=16><color=#5bc0de>YOUR DEEP SEA STATS</color></size>",
            ["Tracking.Stats.Visits"] = "<size=12><color=#DBE2E9>Total Visits:</color> <color=#F3E7B3>{0}</color></size>",
            ["Tracking.Stats.Time"] = "<size=12><color=#DBE2E9>Total Time:</color> <color=#F3E7B3>{0}</color></size>",
            ["Tracking.Stats.Kills"] = "<size=12><color=#DBE2E9>Total NPC Kills:</color> <color=#F3E7B3>{0}</color></size>",
            ["Tracking.Stats.Looted"] = "<size=12><color=#DBE2E9>Total Containers Looted:</color> <color=#F3E7B3>{0}</color></size>",
            ["Tracking.Stats.Deaths"] = "<size=12><color=#DBE2E9>Total Deaths:</color> <color=#E45858>{0}</color></size>",
            ["Death.Message"] = "<size=14><color=#d9534f>KILLED BY RADIATION</color></size>\n<size=11><color=#DBE2E9>You were killed by the Deep Sea wipe radiation.</color></size>",
            ["Death.Restored"] = "<size=14><color=#9CFF1E>INVENTORY RESTORED</color></size>\n<size=11><color=#DBE2E9>Your inventory has been restored from your entry snapshot.</color></size>",
            ["Events.TreasureSpawned"] = "<size=14><color=#f0ad4e>TREASURE HUNT</color></size>\n<size=11><color=#DBE2E9>Hidden treasure stashes have been placed on the islands! Find them in your (G) map.</color></size>",
            ["Events.BossSpawning"] = "<size=14><color=#d9534f>BOSS DEPLOYED</color></size>\n<size=11><color=#DBE2E9>A Bradley APC has been deployed to the Deep Sea! Destroy it for extra loot.</color></size>",
            ["Events.SupplyDrop"] = "<size=14><color=#5bc0de>SUPPLY DROP</color></size>\n<size=11><color=#DBE2E9>A supply drop is falling over the Deep Sea!</color></size>",
            ["Events.CrateHacked"] = "<size=14><color=#f0ad4e>CRATE HACKING</color></size>\n<size=11><color=#DBE2E9>Someone is hacking a locked crate on a ghost ship!</color></size>",
            ["NCP.Opened"] = "The Deep Sea has opened! Sail to the portal.",
            ["NCP.Closing"] = "The Deep Sea is closing! Evacuate now!",
            ["NCP.Closed"] = "The Deep Sea has closed. Reopens in {0}.",
            ["NCP.Countdown"] = "{0} remaining before Deep Sea wipes!",
            ["NCP.Welcome"] = "Welcome to the Deep Sea! Good luck.",
            ["NCP.Farewell"] = "Deep Sea session: {0} | Kills: {1} | Looted: {2}",
            ["NCP.TreasureSpawned"] = "Hidden treasure stashes placed on the islands!",
            ["NCP.BossSpawning"] = "A Bradley APC has been deployed to the Deep Sea!",
            ["NCP.SupplyDrop"] = "A supply drop is falling over the Deep Sea!",
            ["NCP.CrateHacked"] = "Someone is hacking a locked crate on a ghost ship!",
            ["NCP.Death"] = "You were killed by the Deep Sea wipe radiation.",
            ["NCP.InventoryRestored"] = "Your inventory has been restored.",
            ["Building.Denied"] = "<size=14><color=#d9534f>BUILDING DENIED</color></size>\n<size=11><color=#DBE2E9>Building is not allowed in the Deep Sea.</color></size>",
            ["Building.Toast.Denied"] = "Building is not allowed in the Deep Sea.",
            ["Building.LimitReached"] = "<size=14><color=#d9534f>FOUNDATION LIMIT</color></size>\n<size=11><color=#DBE2E9>You have reached the maximum foundation limit (<color=#E45858>{0}</color>) in the Deep Sea.</color></size>",
            ["Building.Remaining"] = "<size=12><color=#DBE2E9>Foundations remaining: <color=#F3E7B3>{0}</color></color></size>",
            ["Schedule.AlwaysOpen"] = "<size=14><color=#5bc0de>ALWAYS OPEN MODE</color></size>\n<size=11><color=#DBE2E9>The Deep Sea is in AlwaysOpen mode and will remain open.</color></size>",
            ["Schedule.Disabled"] = "<size=14><color=#d9534f>DEEP SEA DISABLED</color></size>\n<size=11><color=#DBE2E9>The Deep Sea is disabled and will not open.</color></size>",
            ["Respawn.Notification"] = "<size=14><color=#9CFF1E>RESOURCES REPLENISHED</color></size>\n<size=11><color=#DBE2E9>Island resources have been replenished.</color></size>",
            ["NCP.Respawn"] = "Deep Sea island resources have been replenished.",
            ["Tracking.Top.Header"] = "<size=16><color=#5bc0de>DEEP SEA LEADERBOARD - {0}</color></size>",
            ["Tracking.Top.Entry"] = "<size=12><color=#DBE2E9>#{0} <color=#F3E7B3>{1}</color> - <color=#9CFF1E>{2}</color></color></size>",
            ["Tracking.Top.Empty"] = "<size=12><color=#DBE2E9>No Deep Sea stats recorded yet.</color></size>",
            ["Tracking.Top.Footer"] = "<size=11><color=#DBE2E9>Showing top {0} players.</color></size>",
            ["Admin.ResetStats.Usage"] = "<size=12><color=#DBE2E9>Usage: <color=#f0ad4e>/deepsea resetstats &lt;player name or id | all&gt;</color></color></size>",
            ["Admin.ResetStats.Player"] = "<size=14><color=#9CFF1E>STATS RESET</color></size>\n<size=11><color=#DBE2E9>Reset Deep Sea stats for <color=#F3E7B3>{0}</color>.</color></size>",
            ["Admin.ResetStats.All"] = "<size=14><color=#9CFF1E>STATS RESET</color></size>\n<size=11><color=#DBE2E9>Reset Deep Sea stats for all <color=#F3E7B3>{0}</color> players.</color></size>",
            ["Admin.ResetStats.NotFound"] = "<size=12><color=#d9534f>No stats found for '<color=#F3E7B3>{0}</color>'.</color></size>",
            ["Discord.Opened"] = "The Deep Sea has opened!",
            ["Discord.Closed"] = "The Deep Sea has closed.",
            ["Discord.Achievement"] = "Player {0} completed a Deep Sea run with {1} NPC kills and {2} containers looted."
        }, this);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private string GetMsg(string key, string userId = null) => lang.GetMessage(key, this, userId);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private string GetMsg(string key, BasePlayer player) => lang.GetMessage(key, this, player?.UserIDString);

    #endregion

    #region Deep Sea Lifecycle

    private void OnDeepSeaOpen(DeepSeaManager manager)
    {
        _manager = manager;
    }

    private void OnDeepSeaOpened(DeepSeaManager manager)
    {
        _manager = manager;
        _deepSeaOpen = true;
        _announcedMilestones.Clear();
        _foundationCounts.Clear();
        _enhancedContainers.Clear();

        ApplyGlobalPatches();
        SubscribeConditionalHooks();
        StartCountdownTimer();
        AttachTrackingZone();
        AttachPortalApproachZones();

        if (_config.GeneralControls.ControlBuilding && _config.BuildingControls.LimitFoundations)
            StartTrackedCoroutine(ScanExistingFoundationsCoroutine());

        if (_config.GeneralControls.ControlEvents)
            ScheduleEvents();

        if (_config.RespawnSystem.Enabled)
            StartRespawnTimer();

        if (_config.GeneralControls.ControlNotifications && _config.Notifications.AnnounceOnOpen)
        {
            BroadcastChat(GetMsg("DeepSea.Opened"));

            if (_config.Notifications.UseToastMessages)
                BroadcastToast(GetMsg("DeepSea.Toast.Opened"), GameTip.Styles.Blue_Normal);

            NotifyAll(NcpInfo, GetMsg("NCP.Opened"));
        }

        if (_config.Discord.Enabled && _config.Discord.AnnounceOpen)
            SendDiscordMessage(GetMsg("Discord.Opened"), "Deep Sea Opened", 3447003);

        //Puts("Deep Sea opened. Enhancer systems activated.");
    }

    private void OnDeepSeaClosed(DeepSeaManager manager)
    {
        _manager = manager;
        _deepSeaOpen = false;

        _data.TotalCyclesCompleted++;
        _dataChanged = true;

        foreach (var session in _activeSessions.Values)
        {
            FinalizeSession(session);
            var s = session; Pool.Free(ref s);
        }
        _activeSessions.Clear();
        _playersInDeepSea.Clear();

        RemoveGlobalPatches();
        UnsubscribeConditionalHooks();
        StopCountdownTimer();
        DetachTrackingZone();
        DetachPortalApproachZones();
        StopEventTimers();
        StopRespawnTimer();
        CleanupEventEntities();

        PruneDestroyedEntries(DeepSeaManager.ServerRHIBS);
        PruneDestroyedEntries(DeepSeaManager.ServerIslands);
        PruneDestroyedEntries(DeepSeaManager.ServerGhostShips);
        PruneDestroyedEntries(DeepSeaManager.ServerFloatingCities);

        _foundationCounts.Clear();
        _enhancedContainers.Clear();
        _announcedMilestones.Clear();
        _portalInfoShownAt.Clear();
        _recentFeeCharges.Clear();
        _deathsInDeepSea.Clear();

        var timeToNext = _manager.TimeToNextOpening;

        if (_config.GeneralControls.ControlNotifications && _config.Notifications.AnnounceOnClose)
        {
            var formatted = FormatTime(timeToNext);
            BroadcastChat(string.Format(GetMsg("DeepSea.Closed"), formatted));
            NotifyAll(NcpInfo, string.Format(GetMsg("NCP.Closed"), formatted));
        }

        if (_config.Discord.Enabled && _config.Discord.AnnounceClose)
            SendDiscordMessage(GetMsg("Discord.Closed"), "Deep Sea Closed", 15158332);

        if (_config.GeneralControls.ControlSchedule && _config.Schedule.Mode == ScheduleMode.AlwaysOpen)
        {
            Puts("AlwaysOpen mode: Deep Sea closed. Reopening in 15 seconds...");
            timer.Once(15f, () =>
            {
                if (_instance is null || _manager is null || _manager.IsDestroyed) return;
                if (_manager.IsBusy()) return;
                _manager.OpenDeepSea();
            });
        }

        SaveData();
        //Puts("Deep Sea closed. Enhancer systems deactivated.");
    }

    #endregion

    #region Countdown System

    private void StartCountdownTimer()
    {
        StopCountdownTimer();
        var interval = Mathf.Max(_config.Notifications.CountdownCheckInterval, 1f);
        ServerMgr.Instance.InvokeRandomized(CountdownTick, interval, interval, interval * 0.05f);
    }

    private void StopCountdownTimer()
    {
        ServerMgr.Instance.CancelInvoke(CountdownTick);
    }

    private void CountdownTick()
    {
        if (_manager is null || !_deepSeaOpen) return;

        float timeToWipe;
        try { timeToWipe = _manager.TimeToWipe; }
        catch { return; }

        if (timeToWipe <= 0f) return;

        var secondsRemaining = Mathf.RoundToInt(timeToWipe);

        foreach (var milestone in _config.Notifications.CountdownIntervals)
        {
            if (_announcedMilestones.Contains(milestone)) continue;

            var tolerance = Mathf.Max(Mathf.RoundToInt(_config.Notifications.CountdownCheckInterval), 5);

            if (secondsRemaining > milestone || secondsRemaining < milestone - tolerance) continue;
            _announcedMilestones.Add(milestone);
            var formatted = _formattedIntervals != null && _formattedIntervals.TryGetValue(milestone, out var cached)
                ? cached : FormatTime(milestone);
            var chatMsg = string.Format(GetMsg("DeepSea.Countdown"), formatted);
            var toastMsg = string.Format(GetMsg("DeepSea.Toast.Countdown"), formatted);

            if (_config.Notifications.UseChatMessages)
                BroadcastToDeepSeaPlayers(chatMsg);

            if (_config.Notifications.UseToastMessages)
                BroadcastToastToDeepSeaPlayers(toastMsg, GameTip.Styles.Blue_Normal);

            NotifyDeepSeaPlayers(NcpWarning, string.Format(GetMsg("NCP.Countdown"), formatted));
            break;
        }

        if (!_config.Events.BossSpawn.Enabled || _announcedMilestones.Contains(-1)) return;
        var bossThreshold = _config.Events.BossSpawn.MinutesBeforeWipe * 60;
        if (secondsRemaining > bossThreshold) return;
        _announcedMilestones.Add(-1);
        SpawnBoss();
    }

    #endregion

    #region Schedule Mode & Enforcement

    private void ApplyScheduleMode()
    {
        if (_manager is null) return;

        var schedule = _config.Schedule;

        switch (schedule.Mode)
        {
            case ScheduleMode.Vanilla:
                ConVar.DeepSea.wipeDuration = schedule.OpenTimeSeconds;
                ConVar.DeepSea.wipeCooldownMin = schedule.CooldownSeconds;
                ConVar.DeepSea.wipeCooldownMax = schedule.CooldownSeconds;
                ConVar.DeepSea.wipeEndPhaseDuration = schedule.FinalPhaseSeconds;
                ConVar.DeepSea.wipeRadiationPhaseDuration = schedule.RadiationWarningPhaseSeconds;
                Puts("Schedule mode: Vanilla with custom timings applied.");
                break;

            case ScheduleMode.AlwaysOpen:
                ConVar.DeepSea.openOnServerWipe = true;
                if (_manager.IsBusy()) break;
                if (!_manager.IsOpen())
                {
                    _manager.OpenDeepSea();
                    Puts("Schedule mode: AlwaysOpen - forcing Deep Sea open.");
                }
                else
                {
                    EnforceAlwaysOpen();
                }
                break;

            case ScheduleMode.Disabled:
                ConVar.DeepSea.openOnServerWipe = false;
                if (_manager.IsBusy()) break;
                if (_manager.IsOpen())
                {
                    _manager.CloseDeepSea();
                    Puts("Schedule mode: Disabled - forcing Deep Sea closed.");
                }
                EnforceDisabled();
                break;
        }
    }

    private void EnforceAlwaysOpen()
    {
        if (_manager is null || _manager.IsBusy()) return;

        try
        {
            if (!_manager.IsOpen())
            {
                _manager.OpenDeepSea();
                return;
            }

            var timeToWipe = _manager.TimeToWipe;
            if (!(timeToWipe < _config.Schedule.AlwaysOpenRefillWhenBelow)) return;
            var refillTo = _config.Schedule.AlwaysOpenKeepTimeLeftAround;
            ConVar.DeepSea.wipeDuration = Mathf.RoundToInt(refillTo);
            _manager.SetTimeToWipe(refillTo);
            Puts($"AlwaysOpen: TimeToWipe was {timeToWipe:F0}s, refilling wipeDuration to {refillTo:F0}s.");
        }
        catch (Exception ex)
        {
            PrintWarning($"AlwaysOpen enforcement failed: {ex.Message}");
        }
    }

    private void EnforceDisabled()
    {
        if (_manager is null || _manager.IsBusy()) return;

        try
        {
            if (_manager.IsOpen())
            {
                _manager.CloseDeepSea();
                return;
            }

            var pushTo = _config.Schedule.DisabledPushNextOpeningTo;
            ConVar.DeepSea.wipeCooldownMin = Mathf.RoundToInt(pushTo);
            ConVar.DeepSea.wipeCooldownMax = Mathf.RoundToInt(pushTo);
        }
        catch (Exception ex)
        {
            PrintWarning($"Disabled enforcement failed: {ex.Message}");
        }
    }

    private void StartEnforceTimer()
    {
        StopEnforceTimer();
        var interval = Mathf.Max(_config.GeneralControls.EnforceIntervalSeconds, 5f);
        ServerMgr.Instance.InvokeRandomized(EnforceTick, interval, interval, 1f);
    }

    private void StopEnforceTimer()
    {
        ServerMgr.Instance.CancelInvoke(EnforceTick);
    }

    private void EnforceTick()
    {
        if (_manager is null)
        {
            _manager = FindDeepSeaManager();
            if (_manager is null) return;
        }

        if (!_config.GeneralControls.ControlSchedule) return;

        switch (_config.Schedule.Mode)
        {
            case ScheduleMode.AlwaysOpen:
                EnforceAlwaysOpen();
                break;
            case ScheduleMode.Disabled:
                EnforceDisabled();
                break;
        }

        if (_config.DeepSeaOverrides.Enabled)
            ApplyConVarOverrides();
    }

    #endregion

    #region Respawn System

    private void StartRespawnTimer()
    {
        StopRespawnTimer();
        if (!_config.RespawnSystem.Enabled) return;
        var interval = Mathf.Max(_config.RespawnSystem.CheckIntervalMinutes, 1f) * 60f;
        ServerMgr.Instance.InvokeRandomized(RespawnTick, interval, interval, interval * 0.05f);
    }

    private void StopRespawnTimer()
    {
        ServerMgr.Instance.CancelInvoke(RespawnTick);
    }

    private void RespawnTick()
    {
        if (!_deepSeaOpen || _manager is null) return;

        StartTrackedCoroutine(RespawnCoroutine());
    }

    private Coroutine StartTrackedCoroutine(IEnumerator routine)
    {
        var c = ServerMgr.Instance.StartCoroutine(routine);
        _activeCoroutines.Add(c);
        return c;
    }

    private void StopAllTrackedCoroutines()
    {
        foreach (var c in _activeCoroutines)
            if (c != null) ServerMgr.Instance.StopCoroutine(c);
        _activeCoroutines.Clear();
    }

    private IEnumerator RespawnCoroutine()
    {
        if (_config.RespawnSystem.TriggerIslandSpawnGroups)
        {
            yield return TriggerIslandSpawnGroupsCoroutine();
        }

        if (_config.RespawnSystem.RespawnHackableCrates)
        {
            yield return RespawnHackableCratesCoroutine();
        }

        if (_config.RespawnSystem.RespawnRHIBs)
        {
            yield return RespawnRHIBsCoroutine();
        }
    }

    private IEnumerator TriggerIslandSpawnGroupsCoroutine()
    {
        if (DeepSeaManager.ServerIslands == null) yield break;

        var minDist = _config.RespawnSystem.MinDistanceFromPlayers;
        var minDistSqr = minDist * minDist;
        var processed = 0;

        foreach (var island in DeepSeaManager.ServerIslands)
        {
            if (island is null || island.IsDestroyed) continue;

            var pos = island.transform.position;
            var tooClose = false;
            foreach (var session in _activeSessions.Values)
            {
                var player = session.Player;
                if (player is null || !player.IsConnected) continue;
                if (!((player.transform.position - pos).sqrMagnitude < minDistSqr)) continue;
                tooClose = true;
                break;
            }

            if (tooClose) continue;

            if (island is IDeepSeaSpawner spawner)
            {
                try
                {
                    spawner.TriggerSpawnGroups();
                }
                catch (Exception ex)
                {
                    _instance?.PrintWarning($"Failed to trigger spawn groups on island: {ex.Message}");
                }
            }

            processed++;
            if (processed % 3 == 0)
                yield return null;
        }

        if (processed > 0)
            Puts($"Respawn system: Triggered spawn groups on {processed} islands.");
    }

    // ReSharper disable Unity.PerformanceAnalysis
    private IEnumerator RespawnHackableCratesCoroutine()
    {
        if (DeepSeaManager.ServerGhostShips == null) yield break;

        var activeCrates = 0;
        var cratesSpawned = 0;
        var maxCrates = _config.RespawnSystem.HackableCratesCount;

        foreach (var ship in DeepSeaManager.ServerGhostShips)
        {
            if (ship is null || ship.IsDestroyed) continue;

            if (HasChildHackableCrate(ship))
                activeCrates++;
        }

        if (activeCrates >= maxCrates) yield break;

        foreach (var ship in DeepSeaManager.ServerGhostShips)
        {
            if (ship is null || ship.IsDestroyed) continue;
            if (activeCrates + cratesSpawned >= maxCrates) break;

            if (HasChildHackableCrate(ship)) continue;

            var minDist = _config.RespawnSystem.MinDistanceFromPlayers;
            var minDistSqr = minDist * minDist;
            var tooClose = false;
            var shipPos = ship.transform.position;

            foreach (var session in _activeSessions.Values)
            {
                var player = session.Player;
                if (player is null || !player.IsConnected) continue;
                if (!((player.transform.position - shipPos).sqrMagnitude < minDistSqr)) continue;
                tooClose = true;
                break;
            }

            if (tooClose) continue;

            try
            {
                if (ship is { } ghostShip)
                {
                    ghostShip.SpawnHackableLockedCrate();
                    cratesSpawned++;
                }
            }
            catch (Exception ex)
            {
                _instance?.PrintWarning($"Failed to respawn hackable crate on ghost ship: {ex.Message}");
            }

            yield return null;
        }

        if (cratesSpawned > 0)
            Puts($"Respawn system: Spawned {cratesSpawned} hackable crates on ghost ships.");
    }

    private IEnumerator RespawnRHIBsCoroutine()
    {
        PruneDestroyedEntries(DeepSeaManager.ServerRHIBS);

        var alive = CountAlive(DeepSeaManager.ServerRHIBS);
        if (alive > 0) yield break;

        if (!ConVar.AI.scientist_spawners_enabled)
        {
            Puts("Respawn system: Skipping RHIB respawn — ai.scientist_spawners_enabled is false.");
            yield break;
        }

        var groupCount = Mathf.Max(_config.RespawnSystem.RHIBGroupCount, 1);
        var bounds = DeepSeaManager.DeepSeaBounds;
        var edgeMargin = ConVar.DeepSea.rhib_edgeMargin;
        var minDist = ConVar.DeepSea.rhib_minDist;
        var spawned = 0;

        var occupiedPositions = Pool.Get<List<Vector2>>();
        try
        {
            foreach (var island in DeepSeaManager.ServerIslands)
                if (island is not null && !island.IsDestroyed)
                    occupiedPositions.Add(new Vector2(island.transform.position.x, island.transform.position.z));

            foreach (var city in DeepSeaManager.ServerFloatingCities)
                if (city is not null && !city.IsDestroyed)
                    occupiedPositions.Add(new Vector2(city.transform.position.x, city.transform.position.z));

            foreach (var ship in DeepSeaManager.ServerGhostShips)
                if (ship is not null && !ship.IsDestroyed)
                    occupiedPositions.Add(new Vector2(ship.transform.position.x, ship.transform.position.z));

            var placedRhibPositions = Pool.Get<List<Vector2>>();
            try
            {
                for (var g = 0; g < groupCount; g++)
                {
                    var found = false;
                    for (var attempt = 0; attempt < 50; attempt++)
                    {
                        var candidate = new Vector2(
                            Random.Range(bounds.min.x + edgeMargin, bounds.max.x - edgeMargin),
                            Random.Range(bounds.min.z + edgeMargin, bounds.max.z - edgeMargin)
                        );

                        var tooClose = false;
                        foreach (var occ in occupiedPositions)
                        {
                            if (!((candidate - occ).sqrMagnitude < minDist * minDist)) continue;
                            tooClose = true;
                            break;
                        }

                        if (!tooClose)
                        {
                            foreach (var prev in placedRhibPositions)
                            {
                                if (!((candidate - prev).sqrMagnitude < minDist * minDist)) continue;
                                tooClose = true;
                                break;
                            }
                        }

                        if (tooClose) continue;

                        var dir = (bounds.center - new Vector3(candidate.x, 0f, candidate.y)).normalized;
                        var rot = Quaternion.LookRotation(dir);

                        BoatAI.SpawnBoatGroup(candidate, rot, registerWithDeepSea: true);
                        placedRhibPositions.Add(candidate);
                        spawned++;
                        found = true;

                        yield return null;
                        break;
                    }

                    if (!found)
                        PrintWarning($"Respawn system: Could not find valid position for RHIB group {g + 1}/{groupCount} after 50 attempts.");
                }
            }
            finally
            {
                Pool.FreeUnmanaged(ref placedRhibPositions);
            }
        }
        finally
        {
            Pool.FreeUnmanaged(ref occupiedPositions);
        }

        if (spawned > 0)
            Puts($"Respawn system: Spawned {spawned} RHIB boat groups (1 PT boat + 2 RHIBs each).");
    }

    #endregion

    #region Portal Approach Info Panel

    private void AttachPortalApproachZones()
    {
        DetachPortalApproachZones();
        if (!_config.PortalSettings.PortalApproachInfoEnabled) return;
        if (DeepSeaManager.ServerPortals == null) return;

        foreach (var portal in DeepSeaManager.ServerPortals)
        {
            if (portal is null || portal.IsDestroyed) continue;
            if (portal.PortalMode != DeepSeaPortal.PortalModeEnum.Entrance) continue;
            if (!portal.HasFlag(BaseEntity.Flags.Open)) continue;

            var zone = portal.gameObject.AddComponent<PortalApproachZone>();
            zone.Init(portal, _config.PortalSettings.PortalApproachRadius);
            _portalZones.Add(zone);
        }
    }

    private void DetachPortalApproachZones()
    {
        foreach (var zone in _portalZones)
        {
            if (zone is null) continue;
            zone.Cleanup();
            UnityEngine.Object.Destroy(zone);
        }
        _portalZones.Clear();
    }

    private void OnPlayerApproachPortal(BasePlayer player, DeepSeaPortal portal)
    {
        if (player is null || !player.IsConnected) return;

        var now = Time.realtimeSinceStartup;
        var cooldown = _config.PortalSettings.PortalInfoCooldownSeconds;

        if (_portalInfoShownAt.TryGetValue(player.userID, out var lastShown) && now - lastShown < cooldown)
            return;

        _portalInfoShownAt[player.userID] = now;
        ShowPortalInfo(player);
    }

    private void ShowPortalInfo(BasePlayer player)
    {
        string message;
        var feeInfo = string.Empty;
        var portalCfg = _config.PortalSettings;

        if (portalCfg.EntryFee > 0)
            feeInfo = string.Format(GetMsg("Portal.Info.Fee", player), portalCfg.EntryFee, portalCfg.EntryFeePlugin);

        try
        {
            if (_deepSeaOpen && _manager is not null)
            {
                var timeLeft = FormatTime(Mathf.Max(0f, _manager.TimeToWipe));
                message = string.Format(GetMsg("Portal.Info.Open", player), timeLeft, _playersInDeepSea.Count, feeInfo);
            }
            else if (_manager is not null)
            {
                var timeToOpen = FormatTime(Mathf.Max(0f, _manager.TimeToNextOpening));
                message = string.Format(GetMsg("Portal.Info.Closed", player), timeToOpen, feeInfo);
            }
            else
            {
                return;
            }
        }
        catch
        {
            return;
        }

        player.SendConsoleCommand("gametip.showtoast",
            (int)(_deepSeaOpen ? GameTip.Styles.Blue_Normal : GameTip.Styles.Red_Normal), message);
    }

    private class PortalApproachZone : FacepunchBehaviour
    {
        private DeepSeaPortal _portal;
        private GameObject _triggerObj;
        private readonly HashSet<ulong> _playersInZone = new();

        public void Init(DeepSeaPortal portal, float radius)
        {
            _portal = portal;

            _triggerObj = new GameObject("PortalApproachTrigger");
            _triggerObj.transform.SetParent(transform, false);
            _triggerObj.layer = 18;

            var trigger = _triggerObj.AddComponent<SphereCollider>();
            trigger.isTrigger = true;
            trigger.radius = radius;
            trigger.center = Vector3.zero;

            var rb = _triggerObj.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.useGravity = false;

            var fwd = _triggerObj.AddComponent<TriggerForwarder>();
            fwd.Owner = this;
        }

        public void OnPlayerEnter(BasePlayer player)
        {
            if (player is null || player.IsNpc || !player.IsConnected) return;
            if (!_playersInZone.Add(player.userID)) return;
            _instance?.OnPlayerApproachPortal(player, _portal);
        }

        public void OnPlayerLeave(BasePlayer player)
        {
            if (player is null) return;
            _playersInZone.Remove(player.userID);
        }

        public void Cleanup()
        {
            _playersInZone.Clear();
            if (_triggerObj is not null)
                Destroy(_triggerObj);
            _triggerObj = null;
        }

        private void OnDestroy() => Cleanup();
    }

    private class TriggerForwarder : FacepunchBehaviour
    {
        public PortalApproachZone Owner;

        private void OnTriggerEnter(Collider other)
        {
            if (Owner is null) return;
            var player = other.GetComponentInParent<BasePlayer>();
            if (player is not null)
                Owner.OnPlayerEnter(player);
        }

        private void OnTriggerExit(Collider other)
        {
            if (Owner is null) return;
            var player = other.GetComponentInParent<BasePlayer>();
            if (player is not null)
                Owner.OnPlayerLeave(player);
        }
    }

    #endregion

    #region Player Tracking

    private void AttachTrackingZone()
    {
        DetachTrackingZone();
        var go = new GameObject("DeepSeaTrackingZone")
        {
            transform =
            {
                position = DeepSeaBounds.center
            }
        };
        _trackingZone = go.AddComponent<DeepSeaTrackingZone>();
        _trackingZone.Init(DeepSeaBounds.size);
    }

    private void DetachTrackingZone()
    {
        if (_trackingZone is null) return;
        _trackingZone.Cleanup();
        UnityEngine.Object.Destroy(_trackingZone.gameObject);
        _trackingZone = null;
    }

    private class DeepSeaTrackingZone : FacepunchBehaviour
    {
        private GameObject _triggerObj;

        public void Init(Vector3 size)
        {
            _triggerObj = new GameObject("DeepSeaTrackingTrigger");
            _triggerObj.transform.SetParent(transform, false);
            _triggerObj.layer = 18;

            var box = _triggerObj.AddComponent<BoxCollider>();
            box.isTrigger = true;
            box.size = size;
            box.center = Vector3.zero;

            var rb = _triggerObj.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.useGravity = false;

            var fwd = _triggerObj.AddComponent<DeepSeaTriggerForwarder>();
            fwd.Owner = this;
        }

        public void OnPlayerEnter(BasePlayer player)
        {
            if (player is null || player.IsNpc || !player.IsConnected) return;
            _instance?.OnPlayerEnterDeepSea(player.userID);
        }

        public void OnPlayerLeave(BasePlayer player)
        {
            if (player is null || player.IsNpc) return;
            _instance?.OnPlayerLeaveDeepSea(player.userID);
        }

        public void Cleanup()
        {
            if (_triggerObj is not null)
                Destroy(_triggerObj);
            _triggerObj = null;
        }

        private void OnDestroy() => Cleanup();
    }

    private class DeepSeaTriggerForwarder : FacepunchBehaviour
    {
        public DeepSeaTrackingZone Owner;

        private void OnTriggerEnter(Collider other)
        {
            if (Owner is null) return;
            var player = other.GetComponentInParent<BasePlayer>();
            if (player is not null)
                Owner.OnPlayerEnter(player);
        }

        private void OnTriggerExit(Collider other)
        {
            if (Owner is null) return;
            var player = other.GetComponentInParent<BasePlayer>();
            if (player is not null)
                Owner.OnPlayerLeave(player);
        }
    }

    private void OnPlayerEnterDeepSea(ulong userId)
    {
        if (!_deepSeaOpen) return;
        if (!_playersInDeepSea.Add(userId)) return;

        var player = RelationshipManager.FindByID(userId);
        if (player is null) return;

        var session = Pool.Get<PlayerSession>();
        session.UserId = userId;
        session.DisplayName = player.displayName;
        session.EntryTime = Time.realtimeSinceStartup;
        session.Player = player;
        _activeSessions[userId] = session;

        if (_config.DeathRules.SnapshotInventoryOnEntry)
            SnapshotInventory(player);

        _portalCooldowns.Remove(userId);

        player.ChatMessage(string.Format(GetMsg("Tracking.Welcome", player), player.displayName));
        Notify(player, NcpSuccess, GetMsg("NCP.Welcome"));

        Interface.CallHook("OnDeepSeaPlayerEnter", userId);
    }

    private void OnPlayerLeaveDeepSea(ulong userId)
    {
        if (!_playersInDeepSea.Remove(userId)) return;
        _portalCooldowns[userId] = Time.realtimeSinceStartup;

        Interface.CallHook("OnDeepSeaPlayerExit", userId);

        if (!_activeSessions.TryGetValue(userId, out var session)) return;
        FinalizeSession(session);
        _activeSessions.Remove(userId);

        var player = session.Player;
        if (player is null || !player.IsConnected)
        {
            player = RelationshipManager.FindByID(userId);
        }
        if (player is null || !player.IsConnected)
        {
            var s = session; Pool.Free(ref s);
            return;
        }
        var duration = Time.realtimeSinceStartup - session.EntryTime;
        var timeStr = FormatTime(duration);
        var msg = string.Format(GetMsg("Tracking.Farewell", player), timeStr, session.NpcKills, session.ContainersLooted);
        player.ChatMessage(msg);
        Notify(player, NcpInfo, string.Format(GetMsg("NCP.Farewell"), timeStr, session.NpcKills, session.ContainersLooted));

        if (_config.Discord.Enabled && _config.Discord.AnnounceAchievements &&
            (session.NpcKills >= 5 || session.ContainersLooted >= 10))
        {
            var discordMsg = string.Format(GetMsg("Discord.Achievement"), session.DisplayName, session.NpcKills, session.ContainersLooted);
            SendDiscordMessage(discordMsg, "Deep Sea Achievement", 15844367);
        }

        var sess = session; Pool.Free(ref sess);
    }

    private void FinalizeSession(PlayerSession session)
    {
        if (!_data.PlayerStats.TryGetValue(session.UserId, out var stats))
        {
            stats = new PlayerLifetimeStats();
            _data.PlayerStats[session.UserId] = stats;
        }

        stats.DisplayName = session.DisplayName;
        stats.TotalVisits++;
        stats.TotalTimeSpent += Time.realtimeSinceStartup - session.EntryTime;
        stats.TotalNpcKills += session.NpcKills;
        stats.TotalContainersLooted += session.ContainersLooted;
        stats.TotalDeaths += session.Deaths;
        _dataChanged = true;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private int GetDeepSeaPlayerCount() => _playersInDeepSea.Count;

    #endregion

    #region Commands

    [ChatCommand("deepsea")]
    private void CmdDeepSea(BasePlayer player, string command, string[] args)
    {
        if (args == null || args.Length == 0)
        {
            ShowCommandHelp(player);
            return;
        }

        var sub = args[0];
        var subArgs = args.Length > 1 ? new string[args.Length - 1] : Array.Empty<string>();
        if (subArgs.Length > 0) Array.Copy(args, 1, subArgs, 0, subArgs.Length);

        if (string.Equals(sub, "status", StringComparison.OrdinalIgnoreCase))
            SubCmdStatus(player);
        else if (string.Equals(sub, "tp", StringComparison.OrdinalIgnoreCase))
            SubCmdTp(player, subArgs);
        else if (string.Equals(sub, "kick", StringComparison.OrdinalIgnoreCase))
            SubCmdKick(player, subArgs);
        else if (string.Equals(sub, "stats", StringComparison.OrdinalIgnoreCase))
            SubCmdStats(player, subArgs);
        else if (string.Equals(sub, "top", StringComparison.OrdinalIgnoreCase))
            SubCmdTop(player, subArgs);
        else if (string.Equals(sub, "resetstats", StringComparison.OrdinalIgnoreCase))
            SubCmdResetStats(player, subArgs);
        else if (string.Equals(sub, "forceopen", StringComparison.OrdinalIgnoreCase))
            SubCmdForceOpen(player);
        else if (string.Equals(sub, "forceclose", StringComparison.OrdinalIgnoreCase))
            SubCmdForceClose(player);
        else
            ShowCommandHelp(player);
    }

    private void ShowCommandHelp(BasePlayer player)
    {
        var sb = Pool.Get<StringBuilder>();
        try
        {
            sb.Clear();
            sb.AppendLine(GetMsg("Admin.Help.Header", player));

            if (permission.UserHasPermission(player.UserIDString, PermStats) ||
                permission.UserHasPermission(player.UserIDString, PermAdmin))
            {
                sb.AppendLine("<size=11><color=#DBE2E9>  <color=#f0ad4e>/deepsea stats [player]</color> - View Deep Sea statistics</color></size>");
                sb.AppendLine("<size=11><color=#DBE2E9>  <color=#f0ad4e>/deepsea top [kills|looted|time|visits|deaths|score]</color> - Leaderboard</color></size>");
            }

            if (permission.UserHasPermission(player.UserIDString, PermTeleport) ||
                permission.UserHasPermission(player.UserIDString, PermAdmin))
                sb.AppendLine("<size=11><color=#DBE2E9>  <color=#f0ad4e>/deepsea tp [island#]</color> - Teleport to/from the Deep Sea</color></size>");

            if (permission.UserHasPermission(player.UserIDString, PermAdmin))
            {
                sb.AppendLine("<size=11><color=#DBE2E9>  <color=#f0ad4e>/deepsea status</color> - Show Deep Sea status</color></size>");
                sb.AppendLine("<size=11><color=#DBE2E9>  <color=#f0ad4e>/deepsea kick player</color> - Eject player from Deep Sea</color></size>");
                sb.AppendLine("<size=11><color=#DBE2E9>  <color=#f0ad4e>/deepsea resetstats player|all</color> - Reset player stats</color></size>");
                sb.AppendLine("<size=11><color=#DBE2E9>  <color=#f0ad4e>/deepsea forceopen</color> - Force-open the Deep Sea</color></size>");
                sb.AppendLine("<size=11><color=#DBE2E9>  <color=#f0ad4e>/deepsea forceclose</color> - Force-close the Deep Sea</color></size>");
            }

            player.ChatMessage(sb.ToString());
        }
        finally
        {
            Pool.FreeUnmanaged(ref sb);
        }
    }

    private void SubCmdStatus(BasePlayer player)
    {
        if (!permission.UserHasPermission(player.UserIDString, PermAdmin))
        {
            player.ChatMessage(GetMsg("Admin.NoPermission", player));
            return;
        }

        if (_manager is null)
        {
            _manager = FindDeepSeaManager();
            if (_manager is null)
            {
                player.ChatMessage(GetMsg("Admin.NoManager", player));
                return;
            }
        }

        var sb = Pool.Get<StringBuilder>();
        try
        {
            sb.Clear();
            sb.AppendLine(GetMsg("Admin.Status.Header", player));

            var state = _manager.IsOpen() ? "Open"
                : _manager.IsBusy() ? "Busy (Transitioning)"
                : "Closed";

            sb.AppendFormat(GetMsg("Admin.Status.State", player), state).AppendLine();

            if (_config.GeneralControls.ControlSchedule)
                sb.AppendLine($"Schedule Mode: <color=#f0ad4e>{_config.Schedule.Mode}</color>");

            if (_deepSeaOpen)
                sb.AppendFormat(GetMsg("Admin.Status.TimeToWipe", player), FormatTime(_manager.TimeToWipe)).AppendLine();
            else
                sb.AppendFormat(GetMsg("Admin.Status.TimeToOpen", player), FormatTime(_manager.TimeToNextOpening)).AppendLine();

            sb.AppendFormat(GetMsg("Admin.Status.Players", player), GetDeepSeaPlayerCount()).AppendLine();

            var islands = CountAlive(DeepSeaManager.ServerIslands);
            var ghosts = CountAlive(DeepSeaManager.ServerGhostShips);
            var cities = CountAlive(DeepSeaManager.ServerFloatingCities);
            var rhibs = CountAlive(DeepSeaManager.ServerRHIBS);

            sb.AppendFormat(GetMsg("Admin.Status.Islands", player), islands, ghosts, cities, rhibs).AppendLine();
            sb.AppendFormat(GetMsg("Admin.Status.Entities", player), _spawnedEventEntities.Count).AppendLine();

            player.ChatMessage(sb.ToString());
        }
        finally
        {
            Pool.FreeUnmanaged(ref sb);
        }
    }

    private void SubCmdTp(BasePlayer player, string[] args)
    {
        if (!permission.UserHasPermission(player.UserIDString, PermAdmin) &&
            !permission.UserHasPermission(player.UserIDString, PermTeleport))
        {
            player.ChatMessage(GetMsg("Admin.NoPermission", player));
            return;
        }

        if (_manager is null)
        {
            _manager = FindDeepSeaManager();
            if (_manager is null)
            {
                player.ChatMessage(GetMsg("Admin.NoManager", player));
                return;
            }
        }

        if (args.Length > 0 && int.TryParse(args[0], out var islandIndex))
        {
            if (!_deepSeaOpen)
            {
                player.ChatMessage(GetMsg("Admin.Tp.NotOpen", player));
                return;
            }

            if (DeepSeaManager.ServerIslands == null || DeepSeaManager.ServerIslands.Count == 0)
            {
                player.ChatMessage(GetMsg("Admin.Tp.NoIslands", player));
                return;
            }

            var clampedIndex = Mathf.Clamp(islandIndex, 0, DeepSeaManager.ServerIslands.Count - 1);
            var pos = GetIslandPositionByIndex(clampedIndex);
            if (!pos.HasValue) return;
            TeleportWithLoading(player, pos.Value, true);
            player.ChatMessage(string.Format(GetMsg("Admin.Tp.Island", player), clampedIndex));
            return;
        }

        if (IsInDeepSea(player.transform.position))
        {
            var shorePos = FindNearestShorePosition();
            TeleportWithLoading(player, shorePos, false);
            player.ChatMessage(GetMsg("Admin.Tp.ToMain", player));
        }
        else
        {
            if (!_deepSeaOpen)
            {
                player.ChatMessage(GetMsg("Admin.Tp.NotOpen", player));
                return;
            }

            var nearest = FindNearestDeepSeaIsland(DeepSeaBounds.center);
            if (nearest.HasValue)
            {
                TeleportWithLoading(player, nearest.Value, true);
            }
            else
            {
                try { _manager.MoveToDeepSea(player); }
                catch { TeleportWithLoading(player, DeepSeaBounds.center + Vector3.up * 10f, true); }
            }
            player.ChatMessage(GetMsg("Admin.Tp.ToDeepSea", player));
        }
    }

    private void SubCmdKick(BasePlayer player, string[] args)
    {
        if (!permission.UserHasPermission(player.UserIDString, PermAdmin))
        {
            player.ChatMessage(GetMsg("Admin.NoPermission", player));
            return;
        }

        if (args.Length < 1)
        {
            player.ChatMessage(GetMsg("Admin.Kick.Usage", player));
            return;
        }

        var target = string.Join(" ", args);
        var found = FindPlayer(target);

        if (found is null)
        {
            player.ChatMessage(string.Format(GetMsg("Admin.Kick.NotFound", player), target));
            return;
        }

        if (!IsInDeepSea(found.transform.position))
        {
            player.ChatMessage(string.Format(GetMsg("Admin.Kick.NotInDeepSea", player), found.displayName));
            return;
        }

        var shorePos = FindNearestShorePosition();
        TeleportWithLoading(found, shorePos, false);

        found.ChatMessage(GetMsg("Admin.Kick.Notify", found));
        Notify(found, NcpWarning, GetMsg("Admin.Kick.Notify", found));
        player.ChatMessage(string.Format(GetMsg("Admin.Kick.Success", player), found.displayName));
    }

    private void SubCmdStats(BasePlayer player, string[] args)
    {
        if (!permission.UserHasPermission(player.UserIDString, PermStats) &&
            !permission.UserHasPermission(player.UserIDString, PermAdmin))
        {
            player.ChatMessage(GetMsg("Admin.NoPermission", player));
            return;
        }

        ulong targetId = player.userID;

        if (args.Length > 0 && permission.UserHasPermission(player.UserIDString, PermAdmin))
        {
            var found = FindPlayer(args[0]);
            if (found is not null) targetId = found.userID;
        }

        if (!_data.PlayerStats.TryGetValue(targetId, out var stats))
        {
            player.ChatMessage("No Deep Sea stats recorded for this player.");
            return;
        }

        var sb = Pool.Get<StringBuilder>();
        try
        {
            sb.Clear();
            sb.AppendLine(GetMsg("Tracking.Stats.Header", player));
            sb.AppendFormat(GetMsg("Tracking.Stats.Visits", player), stats.TotalVisits).AppendLine();
            sb.AppendFormat(GetMsg("Tracking.Stats.Time", player), FormatTime(stats.TotalTimeSpent)).AppendLine();
            sb.AppendFormat(GetMsg("Tracking.Stats.Kills", player), stats.TotalNpcKills).AppendLine();
            sb.AppendFormat(GetMsg("Tracking.Stats.Looted", player), stats.TotalContainersLooted).AppendLine();
            sb.AppendFormat(GetMsg("Tracking.Stats.Deaths", player), stats.TotalDeaths).AppendLine();
            player.ChatMessage(sb.ToString());
        }
        finally
        {
            Pool.FreeUnmanaged(ref sb);
        }
    }

    private void SubCmdTop(BasePlayer player, string[] args)
    {
        if (!permission.UserHasPermission(player.UserIDString, PermStats) &&
            !permission.UserHasPermission(player.UserIDString, PermAdmin))
        {
            player.ChatMessage(GetMsg("Admin.NoPermission", player));
            return;
        }

        if (_data.PlayerStats.Count == 0)
        {
            player.ChatMessage(GetMsg("Tracking.Top.Empty", player));
            return;
        }

        var sortBy = args.Length > 0 ? args[0] : "kills";

        var entries = Pool.Get<List<KeyValuePair<ulong, PlayerLifetimeStats>>>();
        try
        {
            foreach (var kvp in _data.PlayerStats)
                entries.Add(kvp);

            string metricLabel;
            if (string.Equals(sortBy, "kills", StringComparison.OrdinalIgnoreCase))
            {
                metricLabel = "NPC Kills";
                entries.Sort((a, b) => b.Value.TotalNpcKills.CompareTo(a.Value.TotalNpcKills));
            }
            else if (string.Equals(sortBy, "looted", StringComparison.OrdinalIgnoreCase))
            {
                metricLabel = "Containers Looted";
                entries.Sort((a, b) => b.Value.TotalContainersLooted.CompareTo(a.Value.TotalContainersLooted));
            }
            else if (string.Equals(sortBy, "time", StringComparison.OrdinalIgnoreCase))
            {
                metricLabel = "Time Spent";
                entries.Sort((a, b) => b.Value.TotalTimeSpent.CompareTo(a.Value.TotalTimeSpent));
            }
            else if (string.Equals(sortBy, "visits", StringComparison.OrdinalIgnoreCase))
            {
                metricLabel = "Visits";
                entries.Sort((a, b) => b.Value.TotalVisits.CompareTo(a.Value.TotalVisits));
            }
            else if (string.Equals(sortBy, "deaths", StringComparison.OrdinalIgnoreCase))
            {
                metricLabel = "Deaths";
                entries.Sort((a, b) => b.Value.TotalDeaths.CompareTo(a.Value.TotalDeaths));
            }
            else if (string.Equals(sortBy, "score", StringComparison.OrdinalIgnoreCase))
            {
                metricLabel = "Score";
                entries.Sort((a, b) => GetCompositeScore(b.Value).CompareTo(GetCompositeScore(a.Value)));
            }
            else
            {
                metricLabel = "NPC Kills";
                entries.Sort((a, b) => b.Value.TotalNpcKills.CompareTo(a.Value.TotalNpcKills));
            }

            var count = Mathf.Min(entries.Count, 10);
            var sb = Pool.Get<StringBuilder>();
            try
            {
                sb.Clear();
                sb.AppendFormat(GetMsg("Tracking.Top.Header", player), metricLabel).AppendLine();

                for (var i = 0; i < count; i++)
                {
                    var entry = entries[i];
                    var stats = entry.Value;
                    var displayName = string.IsNullOrEmpty(stats.DisplayName) ? entry.Key.ToString() : stats.DisplayName;

                    var valueStr = string.Equals(sortBy, "time", StringComparison.OrdinalIgnoreCase)
                        ? FormatTime(stats.TotalTimeSpent)
                        : string.Equals(sortBy, "score", StringComparison.OrdinalIgnoreCase)
                            ? GetCompositeScore(stats).ToString("N0")
                            : string.Equals(sortBy, "looted", StringComparison.OrdinalIgnoreCase)
                                ? stats.TotalContainersLooted.ToString()
                                : string.Equals(sortBy, "visits", StringComparison.OrdinalIgnoreCase)
                                    ? stats.TotalVisits.ToString()
                                    : string.Equals(sortBy, "deaths", StringComparison.OrdinalIgnoreCase)
                                        ? stats.TotalDeaths.ToString()
                                        : stats.TotalNpcKills.ToString();

                    sb.AppendFormat(GetMsg("Tracking.Top.Entry", player), i + 1, displayName, valueStr).AppendLine();
                }

                sb.AppendFormat(GetMsg("Tracking.Top.Footer", player), count);
                player.ChatMessage(sb.ToString());
            }
            finally
            {
                Pool.FreeUnmanaged(ref sb);
            }
        }
        finally
        {
            Pool.FreeUnmanaged(ref entries);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float GetCompositeScore(PlayerLifetimeStats stats)
        => stats.TotalNpcKills * 10f + stats.TotalContainersLooted * 5f + stats.TotalVisits * 2f + stats.TotalTimeSpent / 60f;

    private void SubCmdResetStats(BasePlayer player, string[] args)
    {
        if (!permission.UserHasPermission(player.UserIDString, PermAdmin))
        {
            player.ChatMessage(GetMsg("Admin.NoPermission", player));
            return;
        }

        if (args.Length < 1)
        {
            player.ChatMessage(GetMsg("Admin.ResetStats.Usage", player));
            return;
        }

        var target = args[0];

        if (string.Equals(target, "all", StringComparison.OrdinalIgnoreCase))
        {
            var count = _data.PlayerStats.Count;
            _data.PlayerStats.Clear();
            _dataChanged = true;
            player.ChatMessage(string.Format(GetMsg("Admin.ResetStats.All", player), count));
            return;
        }

        ulong targetId = 0;

        if (ulong.TryParse(target, out var parsed) && _data.PlayerStats.ContainsKey(parsed))
        {
            targetId = parsed;
        }
        else
        {
            var found = FindPlayer(target);
            if (found is not null)
                targetId = found.userID;
        }

        if (targetId == 0 || !_data.PlayerStats.ContainsKey(targetId))
        {
            player.ChatMessage(string.Format(GetMsg("Admin.ResetStats.NotFound", player), target));
            return;
        }

        var name = _data.PlayerStats[targetId].DisplayName;
        _data.PlayerStats.Remove(targetId);
        _dataChanged = true;
        player.ChatMessage(string.Format(GetMsg("Admin.ResetStats.Player", player), string.IsNullOrEmpty(name) ? targetId.ToString() : name));
    }

    private static void SubCmdForceOpen(BasePlayer player)
        => player.SendConsoleCommand("deepsea.forceopen");

    private static void SubCmdForceClose(BasePlayer player)
        => player.SendConsoleCommand("deepsea.forceclose");

    [ConsoleCommand("deepsea.forceopen")]
    private void CcmdForceOpen(ConsoleSystem.Arg arg)
    {
        var p = arg.Player();
        if (p is not null && !permission.UserHasPermission(p.UserIDString, PermAdmin))
        {
            arg.ReplyWith(GetMsg("Admin.NoPermission"));
            return;
        }

        if (_manager is null || _manager.IsDestroyed)
            _manager = FindDeepSeaManager();

        if (_manager is null || _manager.IsDestroyed)
        {
            if (!ConVar.DeepSea.enabled)
            {
                arg.ReplyWith("DeepSeaManager not found — ConVar DeepSea.enabled is false. " +
                              "The manager was destroyed. Enable the ConVar and restart the server.");
            }
            else
            {
                arg.ReplyWith(GetMsg("Admin.NoManager"));
            }
            return;
        }

        if (_manager.IsOpen())
        {
            arg.ReplyWith("Deep Sea is already open.");
            return;
        }

        if (_manager.IsBusy())
        {
            arg.ReplyWith("Deep Sea is currently busy (opening or closing). Please wait.");
            return;
        }

        _manager.OpenDeepSea();
        arg.ReplyWith(GetMsg("Admin.ForceOpen"));
    }

    [ConsoleCommand("deepsea.forceclose")]
    private void CcmdForceClose(ConsoleSystem.Arg arg)
    {
        var p = arg.Player();
        if (p is not null && !permission.UserHasPermission(p.UserIDString, PermAdmin))
        {
            arg.ReplyWith(GetMsg("Admin.NoPermission"));
            return;
        }

        if (_manager is null || _manager.IsDestroyed)
        {
            arg.ReplyWith(GetMsg("Admin.NoManager"));
            return;
        }

        if (!_manager.IsOpen() && !_manager.IsBusy())
        {
            arg.ReplyWith("Deep Sea is already closed.");
            return;
        }

        if (_manager.IsBusy())
        {
            arg.ReplyWith("Deep Sea is currently busy (opening or closing). Please wait.");
            return;
        }

        KillVanillaDeepSeaEntities();

        var origRadiation = ConVar.DeepSea.wipeRadiationPhaseDuration;
        var origEnd = ConVar.DeepSea.wipeEndPhaseDuration;

        ConVar.DeepSea.wipeRadiationPhaseDuration = 1;
        ConVar.DeepSea.wipeEndPhaseDuration = 1;

        _manager.CloseDeepSea();

        timer.Once(10f, () =>
        {
            ConVar.DeepSea.wipeRadiationPhaseDuration = origRadiation;
            ConVar.DeepSea.wipeEndPhaseDuration = origEnd;
        });

        arg.ReplyWith(GetMsg("Admin.ForceClose"));
    }

    [ConsoleCommand("deepsea.spawnboss")]
    private void CcmdSpawnBoss(ConsoleSystem.Arg arg)
    {
        var p = arg.Player();
        if (p is not null && !permission.UserHasPermission(p.UserIDString, PermAdmin))
        {
            arg.ReplyWith(GetMsg("Admin.NoPermission"));
            return;
        }

        if (!_deepSeaOpen)
        {
            arg.ReplyWith("Deep Sea is not open.");
            return;
        }

        SpawnBoss();
        arg.ReplyWith("Boss Bradley spawned in the Deep Sea.");
    }

    [ConsoleCommand("deepsea.showpath")]
    private void CcmdShowPath(ConsoleSystem.Arg arg)
    {
        var player = arg.Player();
        if (player is null)
        {
            arg.ReplyWith("This command must be run as a player.");
            return;
        }

        if (!permission.UserHasPermission(player.UserIDString, PermAdmin))
        {
            arg.ReplyWith(GetMsg("Admin.NoPermission"));
            return;
        }

        if (!_debugPathViewers.Add(player))
        {
            _debugPathViewers.Remove(player);
            arg.ReplyWith("Bradley path debug OFF.");

            if (_debugPathViewers.Count != 0) return;
            _debugPathTimer?.Destroy();
            _debugPathTimer = null;
            return;
        }

        arg.ReplyWith("Bradley path debug ON. Run again to toggle off.");

        _debugPathTimer ??= timer.Every(1f, DrawBradleyPathDebug);
    }

    [ConsoleCommand("deepsea.mapstart")]
    private void CcmdMapStart(ConsoleSystem.Arg arg)
    {
        var player = arg.Player();
        if (player is null)
        {
            arg.ReplyWith("This command must be run as a player.");
            return;
        }

        if (!permission.UserHasPermission(player.UserIDString, PermAdmin))
        {
            arg.ReplyWith(GetMsg("Admin.NoPermission"));
            return;
        }

        _mappingWaypoints[player.userID] = new List<Vector3>();
        arg.ReplyWith("Waypoint mapping started. Walk to patrol points and run 'deepsea.mappoint' at each one.\n" +
                       "Run 'deepsea.mapdone' when finished to get the code snippet.");
    }

    [ConsoleCommand("deepsea.mappoint")]
    private void CcmdMapPoint(ConsoleSystem.Arg arg)
    {
        var player = arg.Player();
        if (player is null)
        {
            arg.ReplyWith("This command must be run as a player.");
            return;
        }

        if (!permission.UserHasPermission(player.UserIDString, PermAdmin))
        {
            arg.ReplyWith(GetMsg("Admin.NoPermission"));
            return;
        }

        if (!_deepSeaOpen || DeepSeaManager.ServerIslands == null)
        {
            arg.ReplyWith("Deep Sea must be open with islands spawned.");
            return;
        }

        var playerPos = player.transform.position;
        DeepSeaIsland closestIsland = null;
        var closestDistSqr = float.MaxValue;

        foreach (var island in DeepSeaManager.ServerIslands)
        {
            if (island is null || island.IsDestroyed) continue;
            var distSqr = (island.transform.position - playerPos).sqrMagnitude;
            if (!(distSqr < closestDistSqr)) continue;
            closestDistSqr = distSqr;
            closestIsland = island;
        }

        if (closestIsland is null)
        {
            arg.ReplyWith("No islands found nearby.");
            return;
        }

        var localPos = closestIsland.transform.InverseTransformPoint(playerPos);
        localPos.y = 0f;

        if (!_mappingWaypoints.TryGetValue(player.userID, out var waypoints))
        {
            waypoints = new List<Vector3>();
            _mappingWaypoints[player.userID] = waypoints;
        }

        waypoints.Add(localPos);

        var islandType = closestIsland.Variant;
        var dist2D = Mathf.Sqrt(closestDistSqr);

        arg.ReplyWith($"Point #{waypoints.Count} recorded for {islandType} island (dist: {dist2D:F0}m)\n" +
                       $"  Local: new Vector3({localPos.x:F1}f, 0f, {localPos.z:F1}f)\n" +
                       $"  World: ({playerPos.x:F1}, {playerPos.y:F1}, {playerPos.z:F1})");

        player.SendConsoleCommand("ddraw.box", 10f, Color.green, playerPos, 1f);
        player.SendConsoleCommand("ddraw.text", 10f, Color.green, playerPos + Vector3.up * 2f, $"P{waypoints.Count}");
    }

    [ConsoleCommand("deepsea.mapdone")]
    private void CcmdMapDone(ConsoleSystem.Arg arg)
    {
        var player = arg.Player();
        if (player is null)
        {
            arg.ReplyWith("This command must be run as a player.");
            return;
        }

        if (!permission.UserHasPermission(player.UserIDString, PermAdmin))
        {
            arg.ReplyWith(GetMsg("Admin.NoPermission"));
            return;
        }

        if (!_mappingWaypoints.TryGetValue(player.userID, out var waypoints) || waypoints.Count == 0)
        {
            arg.ReplyWith("No waypoints recorded. Run 'deepsea.mapstart' then 'deepsea.mappoint' at each position.");
            return;
        }

        var playerPos = player.transform.position;
        var islandType = "Unknown";

        if (_deepSeaOpen && DeepSeaManager.ServerIslands != null)
        {
            DeepSeaIsland closestIsland = null;
            var closestDistSqr = float.MaxValue;

            foreach (var island in DeepSeaManager.ServerIslands)
            {
                if (island is null || island.IsDestroyed) continue;
                var distSqr = (island.transform.position - playerPos).sqrMagnitude;
                if (!(distSqr < closestDistSqr)) continue;
                closestDistSqr = distSqr;
                closestIsland = island;
            }

            if (closestIsland is not null)
                islandType = closestIsland.Variant.ToString();
        }

        var sb = Pool.Get<StringBuilder>();
        try
        {
            sb.Clear();
            sb.AppendLine($"// {waypoints.Count} waypoints for {islandType} island");
            sb.AppendLine($"[DeepSeaIsland.IslandType.{islandType}] = new[]");
            sb.AppendLine("{");
            for (var i = 0; i < waypoints.Count; i++)
            {
                var p = waypoints[i];
                var comma = i < waypoints.Count - 1 ? "," : "";
                sb.AppendLine($"    new Vector3({p.x:F1}f, 0f, {p.z:F1}f){comma}");
            }
            sb.AppendLine("}");

            var output = sb.ToString();
            arg.ReplyWith($"Mapping complete! Copy this into IslandPatrolRoutes:\n\n{output}");
            //Puts($"[Waypoint Mapping] {islandType} island - {waypoints.Count} points:\n{output}");
        }
        finally
        {
            Pool.FreeUnmanaged(ref sb);
        }

        _mappingWaypoints.Remove(player.userID);
    }

    [ConsoleCommand("deepsea.mapundo")]
    private void CcmdMapUndo(ConsoleSystem.Arg arg)
    {
        var player = arg.Player();
        if (player is null)
        {
            arg.ReplyWith("This command must be run as a player.");
            return;
        }

        if (!permission.UserHasPermission(player.UserIDString, PermAdmin))
        {
            arg.ReplyWith(GetMsg("Admin.NoPermission"));
            return;
        }

        if (!_mappingWaypoints.TryGetValue(player.userID, out var waypoints) || waypoints.Count == 0)
        {
            arg.ReplyWith("No waypoints to undo.");
            return;
        }

        var removed = waypoints[^1];
        waypoints.RemoveAt(waypoints.Count - 1);
        arg.ReplyWith($"Removed point #{waypoints.Count + 1} ({removed.x:F1}, 0, {removed.z:F1}). {waypoints.Count} points remaining.");
    }

    private void DrawBradleyPathDebug()
    {
        if (_debugPathViewers.Count == 0) return;

        BradleyAPC bradley = null;
        BradleyCollisionHandler handler = null;
        foreach (var entity in _spawnedEventEntities)
        {
            if (entity is not BradleyAPC apc || apc.IsDestroyed) continue;
            bradley = apc;
            handler = apc.GetComponent<BradleyCollisionHandler>();
            break;
        }

        if (bradley is null || handler is null) return;

        var waypoints = handler.Waypoints;
        if (waypoints == null || waypoints.Length == 0) return;

        const float dur = 1.2f;

        foreach (var viewer in _debugPathViewers)
        {
            if (viewer is null || !viewer.IsConnected) continue;

            var blocked = handler.BlockedWaypoints;

            for (var i = 0; i < waypoints.Length; i++)
            {
                var pos = waypoints[i];
                var next = waypoints[(i + 1) % waypoints.Length];
                var isBlocked = blocked.Contains(i);

                var wpColor = isBlocked ? new Color(0.8f, 0.2f, 0.2f) : Color.cyan;
                viewer.SendConsoleCommand("ddraw.box", dur, wpColor, pos, 1f);
                viewer.SendConsoleCommand("ddraw.text", dur, wpColor, pos + Vector3.up * 2f,
                    isBlocked ? $"W{i} [BLOCKED]" : $"W{i}");

                var linkColor = blocked.Contains((i + 1) % waypoints.Length) ? Color.grey : Color.green;
                viewer.SendConsoleCommand("ddraw.arrow", dur, linkColor, pos, next, 0.5f);
            }

            var currentIdx = handler.CurrentWaypointIndex;
            if (currentIdx >= 0 && currentIdx < waypoints.Length)
            {
                var wp = waypoints[currentIdx];
                viewer.SendConsoleCommand("ddraw.box", dur, Color.red, wp, 1.5f);
                viewer.SendConsoleCommand("ddraw.text", dur, Color.red, wp + Vector3.up * 3f, $"NEXT[{currentIdx}]");
            }

            if (handler.IsFollowingArc)
            {
                var arcWps = handler.ArcWaypoints;
                var arcIdx = handler.ArcIndex;
                if (arcWps != null)
                {
                    for (var i = 0; i < arcWps.Length; i++)
                    {
                        var arcColor = i == arcIdx ? Color.magenta : new Color(0.7f, 0.3f, 0.7f);
                        viewer.SendConsoleCommand("ddraw.sphere", dur, arcColor, arcWps[i], i == arcIdx ? 2f : 1.5f);
                        viewer.SendConsoleCommand("ddraw.text", dur, Color.magenta, arcWps[i] + Vector3.up * 2.5f, $"ARC{i}");

                        if (i < arcWps.Length - 1)
                            viewer.SendConsoleCommand("ddraw.arrow", dur, Color.magenta, arcWps[i], arcWps[i + 1], 0.3f);
                    }
                }
            }

            if (handler.IsDetouring)
            {
                var dp = handler.DetourPoint;
                viewer.SendConsoleCommand("ddraw.sphere", dur, Color.yellow, dp, 2f);
                viewer.SendConsoleCommand("ddraw.text", dur, Color.yellow, dp + Vector3.up * 3f, "DETOUR");
            }

            if (handler.IsBacktracking)
            {
                var backWp = waypoints[currentIdx];
                viewer.SendConsoleCommand("ddraw.sphere", dur, new Color(1f, 0.5f, 0f), backWp, 2.5f);
                viewer.SendConsoleCommand("ddraw.text", dur, new Color(1f, 0.5f, 0f), backWp + Vector3.up * 4f, "BACKTRACK");
            }

            var bradleyPos = bradley.transform.position;
            viewer.SendConsoleCommand("ddraw.box", dur, Color.white, bradleyPos + Vector3.up * 3f, 0.5f);

            var speed = bradley.myRigidBody != null ? bradley.myRigidBody.velocity.magnitude : 0f;
            var state = handler.IsFollowingArc ? " [ARC]"
                : handler.IsBacktracking ? " [BACKTRACK]"
                : handler.IsDetouring ? " [DETOUR]"
                : "";
            var stateText = $"WP: {currentIdx}/{waypoints.Length}{state}" +
                            $"\nBlocked: {blocked.Count}" +
                            $"\nThrottle: {bradley.throttle:F2}, Speed: {speed:F1}" +
                            $"\nDest: ({bradley.destination.x:F0},{bradley.destination.y:F0},{bradley.destination.z:F0})";
            viewer.SendConsoleCommand("ddraw.text", dur, Color.white, bradleyPos + Vector3.up * 5f, stateText);

            if (bradley.destination != Vector3.zero)
                viewer.SendConsoleCommand("ddraw.arrow", dur, Color.red, bradleyPos + Vector3.up * 2f, bradley.destination + Vector3.up * 1f, 0.4f);
        }
    }

    #endregion

    #region Loot Overrides

    private void ModifyDeepSeaLoot(LootContainer container)
    {
        if (container.inventory == null) return;

        var isHackable = container is HackableLockedCrate;

        if (isHackable && !_config.LootOverrides.OverrideHackableCrates) return;

        var dynamicMultiplier = 1f;
        var scaling = _config.LootOverrides.DynamicScaling;
        if (scaling is { Enabled: true })
        {
            var extraPlayers = Mathf.Max(0, GetDeepSeaPlayerCount() - scaling.BasePlayerThreshold);
            dynamicMultiplier = Mathf.Min(1f + extraPlayers * scaling.BonusPerExtraPlayer, scaling.MaxBonusMultiplier);
        }

        var effectiveStackMultiplier = _config.LootOverrides.StackMultiplier * dynamicMultiplier;

        if (effectiveStackMultiplier > 1f && !isHackable)
        {
            for (var i = 0; i < container.inventory.itemList.Count; i++)
            {
                var item = container.inventory.itemList[i];
                if (item == null) continue;

                var newAmount = Mathf.CeilToInt(item.amount * effectiveStackMultiplier);
                item.amount = Mathf.Min(newAmount, item.MaxStackable());
                item.MarkDirty();
            }
        }

        var bonusList = isHackable ? _config.LootOverrides.HackableCrateBonusItems : _config.LootOverrides.BonusItems;
        if (bonusList == null) return;

        for (var i = 0; i < bonusList.Count; i++)
        {
            var bonus = bonusList[i];
            var effectiveChance = bonus.Chance * dynamicMultiplier;
            if (Random.value > effectiveChance) continue;

            var def = GetCachedItemDef(bonus.Shortname);
            if (def is null) continue;

            var amount = dynamicMultiplier > 1f ? Mathf.CeilToInt(bonus.Amount * dynamicMultiplier) : bonus.Amount;
            var item = ItemManager.Create(def, amount, bonus.SkinId);
            if (item == null) continue;

            if (!item.MoveToContainer(container.inventory))
                item.Remove();
        }
    }

    #endregion

    #region Harmony (Portal Enhancements)

    [HarmonyPatch(typeof(DeepSeaManager), "CanTeleportToDeepSea")]
    [HarmonyPriority(Priority.High)]
    internal static class CanTeleportToDeepSeaPatch
    {
        [HarmonyPrefix]
        private static bool Prefix(DeepSeaManager __instance, BaseEntity entity, ref ValueTuple<bool, Translate.Phrase> __result)
        {
            if (_instance == null || entity is null) return true;
            if (!_instance._config.PortalSettings.EnablePortalFeatures) return true;

            var player = entity as BasePlayer;
            if (player is null)
            {
                if (entity is BaseVehicle vehicle)
                {
                    var driver = vehicle.GetDriver();
                    if (driver is not null) player = driver;
                }
            }

            if (player is null || !player.userID.IsSteamId()) return true;

            var isVIP = _instance.permission.UserHasPermission(player.UserIDString, PermVIP);

            if (_instance._config.PortalSettings.CooldownSeconds > 0)
            {
                var bypassCooldown = isVIP && _instance._config.PortalSettings.VIPBypassCooldown;

                if (!bypassCooldown && _instance._portalCooldowns.TryGetValue(player.userID, out var cooldownStart))
                {
                    var elapsed = Time.realtimeSinceStartup - cooldownStart;
                    var remaining = _instance._config.PortalSettings.CooldownSeconds - elapsed;

                    if (remaining > 0f)
                    {
                        player.ChatMessage(string.Format(_instance.GetMsg("Portal.Cooldown", player), Mathf.CeilToInt(remaining)));
                        __result = new ValueTuple<bool, Translate.Phrase>(false, CooldownPhrase);
                        return false;
                    }
                }
            }

            if (!(_instance._config.PortalSettings.EntryFee > 0)) return true;
            var canAfford = _instance.CanAffordEntryFee(player);

            if (canAfford != false) return true;
            var currency = _instance._config.PortalSettings.EntryFeePlugin;
            player.ChatMessage(string.Format(_instance.GetMsg("Portal.NoFunds", player), _instance._config.PortalSettings.EntryFee, currency));
            __result = new ValueTuple<bool, Translate.Phrase>(false, InsufficientFundsPhrase);
            return false;

        }
    }

    [HarmonyPatch(typeof(DeepSeaManager), "HasPaidFoodToll")]
    internal static class HasPaidFoodTollPatch
    {
        [HarmonyPrefix]
        private static bool Prefix(BasePlayer player, ref bool __result)
        {
            if (_instance == null || player is null) return true;
            if (!_instance._config.PortalSettings.EnablePortalFeatures) return true;
            if (!_instance._config.PortalSettings.VIPBypassFoodToll) return true;

            if (!_instance.permission.UserHasPermission(player.UserIDString, PermVIP))
                return true;

            __result = true;
            return false;
        }
    }

    [HarmonyPatch(typeof(DeepSeaManager), "IsAllowedInDeepSea")]
    internal static class IsAllowedInDeepSeaPatch
    {
        private static readonly Translate.Phrase DeniedPhrase = new("deepsea.plus.denied", "Not allowed in Deep Sea.");

        [HarmonyPrefix]
        private static bool Prefix(BaseEntity entity, bool fromMainLand, ref ValueTuple<bool, Translate.Phrase> __result)
        {
            if (_instance == null || entity is null) return true;
            if (!_instance._config.GeneralControls.ControlTravelRules) return true;

            var portal = _instance._config.PortalSettings;

            switch (entity)
            {
                case BasePlayer player when !player.userID.IsSteamId():
                    __result = new ValueTuple<bool, Translate.Phrase>(portal.AllowNPCPlayerTeleport, portal.AllowNPCPlayerTeleport ? null : DeniedPhrase);
                    LogTravelDecision(player.displayName, portal.AllowNPCPlayerTeleport, "NPC player");
                    return false;
                case BasePlayer player when portal.AllowNoclipPlayers && player.IsFlying:
                    __result = new ValueTuple<bool, Translate.Phrase>(true, null);
                    LogTravelDecision(player.displayName, true, "Noclip/flying player");
                    return false;
                case BasePlayer player when portal.AllowPlayersWithoutVehicle:
                    __result = new ValueTuple<bool, Translate.Phrase>(true, null);
                    LogTravelDecision(player.displayName, true, "On foot allowed");
                    return false;
                case BasePlayer:
                    return true;
                case BaseVehicle vehicle when portal.AllowAnyVehicle:
                {
                    if (!portal.AllowNPCPassengers)
                    {
                        var hasNpc = false;
                        foreach (var mountPoint in vehicle.mountPoints)
                        {
                            var mounted = mountPoint.mountable?.GetMounted();
                            if (mounted is null) continue;
                            if (mounted.userID.IsSteamId()) continue;
                            hasNpc = true;
                            break;
                        }

                        if (hasNpc)
                        {
                            __result = new ValueTuple<bool, Translate.Phrase>(false, DeniedPhrase);
                            LogTravelDecision(vehicle.ShortPrefabName, false, "NPC passengers blocked");
                            return false;
                        }
                    }

                    __result = new ValueTuple<bool, Translate.Phrase>(true, null);
                    LogTravelDecision(vehicle.ShortPrefabName, true, "Any vehicle allowed");
                    return false;
                }
                case BaseVehicle vehicle when portal.AllowedVehiclePrefabs.Count > 0:
                {
                    var prefab = vehicle.ShortPrefabName;
                    var allowed = _instance._allowedVehiclePrefabsSet is { Count: > 0 }
                                  && _instance._allowedVehiclePrefabsSet.Contains(prefab);

                    if (!allowed)
                    {
                        for (var i = 0; i < portal.AllowedVehiclePrefabs.Count; i++)
                        {
                            if (prefab.IndexOf(portal.AllowedVehiclePrefabs[i], StringComparison.OrdinalIgnoreCase) < 0)
                                continue;
                            allowed = true;
                            break;
                        }
                    }

                    if (!allowed)
                    {
                        __result = new ValueTuple<bool, Translate.Phrase>(false, DeniedPhrase);
                        LogTravelDecision(prefab, false, "Vehicle not in allowed list");
                        return false;
                    }

                    if (portal.RequireBoatTypeOnly && vehicle is not MotorRowboat && vehicle is not BaseBoat)
                    {
                        __result = new ValueTuple<bool, Translate.Phrase>(false, DeniedPhrase);
                        LogTravelDecision(prefab, false, "Not a boat type");
                        return false;
                    }

                    __result = new ValueTuple<bool, Translate.Phrase>(true, null);
                    LogTravelDecision(prefab, true, "Custom vehicle whitelist");
                    return false;
                }
                default:
                    return true;
            }
        }

        private static void LogTravelDecision(string entityName, bool allowed, string reason)
        {
            if (_instance == null || !_instance._config.PortalSettings.LogEntryExit) return;
            _instance.Puts($"[Travel] {entityName}: {(allowed ? "ALLOWED" : "DENIED")} - {reason}");
        }
    }

    [HarmonyPatch(typeof(DeepSeaManager), "CanTeleportToDeepSea")]
    [HarmonyPriority(Priority.Low)]
    internal static class RadiationPhasePatch
    {
        [HarmonyPostfix]
        private static void Postfix(DeepSeaManager __instance, BaseEntity entity, ref ValueTuple<bool, Translate.Phrase> __result)
        {
            if (_instance == null || entity is null) return;
            if (!_instance._config.GeneralControls.ControlTravelRules) return;
            if (!_instance._config.PortalSettings.AllowEntryDuringRadiationWarningPhase) return;
            if (__result.Item1) return;

            var phaseStr = __result.Item2?.english ?? "";
            if (phaseStr.IndexOf("radiation", StringComparison.OrdinalIgnoreCase) < 0
                && phaseStr.IndexOf("closing", StringComparison.OrdinalIgnoreCase) < 0)
                return;

            __result = new ValueTuple<bool, Translate.Phrase>(true, null);
        }
    }

    [HarmonyPatch(typeof(DeepSeaManager), "CanTeleportToDeepSea")]
    [HarmonyPriority(Priority.Last)]
    internal static class EntryFeeChargePatch
    {
        [HarmonyPostfix]
        private static void Postfix(BaseEntity entity, ref ValueTuple<bool, Translate.Phrase> __result)
        {
            if (_instance == null || !__result.Item1) return;
            if (!_instance._config.PortalSettings.EnablePortalFeatures) return;
            if (!(_instance._config.PortalSettings.EntryFee > 0)) return;

            var player = entity as BasePlayer;
            if (player is null && entity is BaseVehicle vehicle)
                player = vehicle.GetDriver();
            if (player is null || !player.userID.IsSteamId()) return;

            if (_instance._recentFeeCharges.TryGetValue(player.userID, out var lastCharge)
                && Time.realtimeSinceStartup - lastCharge < 30f)
                return;

            var canAfford = _instance.CanAffordEntryFee(player);
            if (canAfford != true) return;

            var fee = _instance._config.PortalSettings.EntryFee;
            var plugin = _instance._config.PortalSettings.EntryFeePlugin;
            var charged = EconomyManager.TryWithdraw(player, fee, plugin);

            if (charged)
            {
                _instance._recentFeeCharges[player.userID] = Time.realtimeSinceStartup;
                player.ChatMessage(string.Format(_instance.GetMsg("Portal.FeePaid", player), fee, plugin));
            }
            else
            {
                __result = new ValueTuple<bool, Translate.Phrase>(false, InsufficientFundsPhrase);
            }
        }
    }

    private static class EconomyManager
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public static bool IsReady(string plugin)
        {
            if (_instance == null) return false;
            if (string.Equals(plugin, "Economics", StringComparison.OrdinalIgnoreCase))
                return _instance.Economics is { IsLoaded: true };
            if (string.Equals(plugin, "ServerRewards", StringComparison.OrdinalIgnoreCase))
                return _instance.ServerRewards is { IsLoaded: true };
            return false;
        }

        public static bool? CheckBalance(BasePlayer player, double fee, string plugin)
        {
            if (!IsReady(plugin)) return null;

            if (string.Equals(plugin, "Economics", StringComparison.OrdinalIgnoreCase))
            {
                var balObj = _instance.Economics.Call("Balance", player.userID);
                return balObj is double balance ? balance >= fee : null;
            }

            if (!string.Equals(plugin, "ServerRewards", StringComparison.OrdinalIgnoreCase))
                return null;

            var srBalObj = _instance.ServerRewards.Call("CheckPoints", player.userID);
            return srBalObj is int points ? points >= (int)fee : null;
        }

        public static bool TryWithdraw(BasePlayer player, double fee, string plugin)
        {
            if (!IsReady(plugin)) return false;

            if (string.Equals(plugin, "Economics", StringComparison.OrdinalIgnoreCase))
                return _instance.Economics.Call("Withdraw", player.userID, fee) is true;

            if (string.Equals(plugin, "ServerRewards", StringComparison.OrdinalIgnoreCase))
                return _instance.ServerRewards.Call("TakePoints", player.userID, (int)fee) is true;

            return false;
        }
    }

    private bool? CanAffordEntryFee(BasePlayer player)
    {
        var fee = _config.PortalSettings.EntryFee;
        if (fee <= 0) return null;

        if (permission.UserHasPermission(player.UserIDString, PermVIP))
            return null;

        var plugin = _config.PortalSettings.EntryFeePlugin;

        if (EconomyManager.IsReady(plugin)) return EconomyManager.CheckBalance(player, fee, plugin);
        PrintWarning($"{plugin} plugin is not loaded - entry fee cannot be checked.");
        return null;

    }

    #endregion

    #region Harmony (NPC Death & Loot Tracking)

    [HarmonyPatch(typeof(BaseCombatEntity), nameof(BaseCombatEntity.Die))]
    private static class NpcDeathTrackingPatch
    {
        [HarmonyPrefix]
        private static void Prefix(BaseCombatEntity __instance, HitInfo info)
        {
            if (_instance is null || !_instance._deepSeaOpen) return;
            if (__instance is not BaseNpc and not NPCPlayer) return;
            if (info?.InitiatorPlayer is not { } attacker) return;
            if (!attacker.userID.IsSteamId()) return;
            if (!IsInDeepSea(__instance.transform.position)) return;

            if (_instance._activeSessions.TryGetValue(attacker.userID, out var session))
                session.NpcKills++;
        }
    }

    [HarmonyPatch(typeof(PlayerLoot), nameof(PlayerLoot.StartLootingEntity))]
    private static class LootEntityTrackingPatch
    {
        [HarmonyPostfix]
        private static void Postfix(PlayerLoot __instance, BaseEntity targetEntity, bool __result)
        {
            if (_instance is null || !_instance._deepSeaOpen || !__result) return;
            if (__instance.baseEntity is not { } player) return;
            if (targetEntity is not LootContainer container) return;
            if (!IsInDeepSea(container.transform.position)) return;

            if (_instance._activeSessions.TryGetValue(player.userID, out var session))
                session.ContainersLooted++;

            if (_instance._config.LootOverrides.Enabled && container.net != null &&
                _instance._enhancedContainers.Add(container.net.ID.Value))
                _instance.ModifyDeepSeaLoot(container);
        }
    }

    #endregion

    #region Harmony (Hooks)

    [HarmonyPatch(typeof(BasePlayer), nameof(BasePlayer.Die))]
    private static class PlayerDeathPatch
    {
        [HarmonyPostfix]
        private static void Postfix(BasePlayer __instance, HitInfo info)
        {
            if (_instance is null || !_instance._deepSeaOpen) return;
            if (!_instance._config.DeathRules.EnableDeathTracking) return;
            if (__instance is null || !__instance.userID.IsSteamId()) return;
            if (!IsInDeepSea(__instance.transform.position)) return;

            _instance._deathsInDeepSea.Add(__instance.userID);

            if (_instance._activeSessions.TryGetValue(__instance.userID, out var session))
            {
                session.Deaths++;
                session.HasDiedThisCycle = true;
            }

            if (!_instance._config.DeathRules.ShowDeathMessage) return;
            var player = __instance;
            _instance.timer.Once(0.5f, () =>
            {
                if (!player.IsConnected) return;
                player.ChatMessage(_instance.GetMsg("Death.Message", player));
                _instance.Notify(player, NcpError, _instance.GetMsg("NCP.Death"));
            });
        }
    }

    [HarmonyPatch(typeof(BasePlayer), nameof(BasePlayer.RespawnAt))]
    private static class PlayerRespawnedPatch
    {
        [HarmonyPostfix]
        private static void Postfix(BasePlayer __instance)
        {
            if (_instance is null) return;
            if (!_instance._config.DeathRules.EnableDeathTracking) return;
            if (__instance is null || !__instance.userID.IsSteamId()) return;
            if (!_instance._deathsInDeepSea.Remove(__instance.userID)) return;

            if (!_instance._config.DeathRules.RestoreInventoryOnRespawn ||
                !_instance._inventorySnapshots.TryGetValue(__instance.userID, out var snapshot)) return;

            var player = __instance;
            _instance.timer.Once(1f, () =>
            {
                if (!player.IsConnected) return;
                RestoreInventory(player, snapshot);
                _instance._inventorySnapshots.Remove(player.userID);
                player.ChatMessage(_instance.GetMsg("Death.Restored", player));
                _instance.Notify(player, NcpSuccess, _instance.GetMsg("NCP.InventoryRestored"));
            });
        }
    }

    [HarmonyPatch(typeof(HackableLockedCrate), nameof(HackableLockedCrate.RPC_Hack))]
    internal static class HackCratePatch
    {
        [HarmonyPostfix]
        private static void Postfix(HackableLockedCrate __instance, BaseEntity.RPCMessage msg)
        {
            if (_instance is null || !_instance._deepSeaOpen) return;
            if (!__instance.IsBeingHacked()) return;
            if (!IsInDeepSea(__instance.transform.position)) return;

            if (_instance._config.LootOverrides.HackableCrateHackTimeOverride > 0f)
                __instance.hackSeconds = _instance._config.LootOverrides.HackableCrateHackTimeOverride;

            if (!_instance._config.GeneralControls.ControlEvents || !_instance._config.Events.AnnounceGhostShipHack) return;
            _instance.BroadcastToDeepSeaPlayers(_instance.GetMsg("Events.CrateHacked"));
            _instance.NotifyDeepSeaPlayers(NcpWarning, _instance.GetMsg("NCP.CrateHacked"));
        }
    }

    [HarmonyPatch(typeof(HackableLockedCrate), nameof(HackableLockedCrate.ServerInit))]
    internal static class HackableCrateSpawnPatch
    {
        [HarmonyPostfix]
        private static void Postfix(HackableLockedCrate __instance)
        {
            if (_instance is null || !_instance._deepSeaOpen) return;
            if (!IsInDeepSea(__instance.transform.position)) return;
            if (_instance._config.LootOverrides.HackableCrateHackTimeOverride <= 0f) return;
            __instance.hackSeconds = _instance._config.LootOverrides.HackableCrateHackTimeOverride;
        }
    }

    [HarmonyPatch(typeof(Planner), "DoBuild", typeof(Construction.Target), typeof(Construction))]
    private static class EntityBuiltPatch
    {
        [HarmonyPostfix]
        private static void Postfix(Planner __instance, Construction component)
        {
            if (_instance is null || !_instance._deepSeaOpen) return;
            if (!_instance._config.GeneralControls.ControlBuilding) return;
            if (!_instance._config.BuildingControls.LimitFoundations) return;

            var player = __instance.GetOwnerPlayer();
            if (player is null || !player.userID.IsSteamId()) return;
            if (!IsInDeepSea(player.transform.position)) return;
            if (_instance.permission.UserHasPermission(player.UserIDString, PermBuildBypass)) return;

            if (component?.fullName is null ||
                component.fullName.IndexOf("foundation", StringComparison.OrdinalIgnoreCase) < 0)
                return;

            _instance.IncrementFoundationCount(player.userID);
            var count = _instance.GetFoundationCount(player.userID);

            if (!_instance._config.BuildingControls.ShowRemainingOnPlace) return;
            var remaining = Mathf.Max(0, _instance._config.BuildingControls.MaxFoundationsPerPlayer - count);
            var msg = string.Format(_instance.GetMsg("Building.Remaining", player), remaining);
            ShowBuildToast(player, msg);
        }
    }

    [HarmonyPatch(typeof(BaseNetworkable), nameof(BaseNetworkable.Kill))]
    private static class EntityKillPatch
    {
        [HarmonyPrefix]
        private static void Prefix(BaseNetworkable __instance)
        {
            if (_instance is null || !_instance._deepSeaOpen) return;
            if (__instance is not (LootContainer or BuildingBlock)) return;

            if (__instance is LootContainer && __instance.net != null)
                _instance._enhancedContainers.Remove(__instance.net.ID.Value);

            if (__instance is not BuildingBlock block) return;
            if (block.net == null || !block.OwnerID.IsSteamId()) return;
            if (!IsInDeepSea(block.transform.position)) return;

            var prefabName = block.ShortPrefabName;
            if (prefabName is null || prefabName.IndexOf("foundation", StringComparison.OrdinalIgnoreCase) < 0)
                return;

            _instance.DecrementFoundationCount(block.OwnerID);
        }
    }

    #endregion

    #region Events System

    private void ScheduleEvents()
    {
        if (_config.Events.TreasureHunt.Enabled)
            timer.Once(10f, SpawnTreasureStashes);

        if (!_config.Events.SupplyDrops.Enabled || _config.Events.SupplyDrops.IntervalMinutes <= 0) return;
        var interval = _config.Events.SupplyDrops.IntervalMinutes * 60f;
        ServerMgr.Instance.InvokeRandomized(CallSupplyDrop, interval, interval, interval * 0.05f);
    }

    private void StopEventTimers()
    {
        ServerMgr.Instance.CancelInvoke(CallSupplyDrop);
    }

    private void CleanupEventEntities()
    {
        for (var i = _spawnedEventEntities.Count - 1; i >= 0; i--)
        {
            var entity = _spawnedEventEntities[i];
            if (entity is null || entity.IsDestroyed) continue;

            if (entity is BradleyAPC)
            {
                var handler = entity.GetComponent<BradleyCollisionHandler>();
                if (handler is not null)
                    UnityEngine.Object.DestroyImmediate(handler);
            }

            entity.Kill();
        }
        _spawnedEventEntities.Clear();

        if (_debugPathTimer is not null)
        {
            _debugPathTimer.Destroy();
            _debugPathTimer = null;
        }
        _debugPathViewers.Clear();
    }

    private void KillVanillaDeepSeaEntities()
    {
        KillAndClear(DeepSeaManager.ServerRHIBS, "RHIBs");
        KillAndClear(DeepSeaManager.ServerIslands, "Islands");
        KillAndClear(DeepSeaManager.ServerGhostShips, "GhostShips");
        KillAndClear(DeepSeaManager.ServerFloatingCities, "FloatingCities");
    }

    private void KillAndClear<T>(ListHashSet<T> set, string label) where T : BaseNetworkable
    {
        if (set is null || set.Count == 0) return;

        var snapshot = Pool.Get<List<T>>();
        try
        {
            snapshot.AddRange(set);
            set.Clear();

            var killed = 0;
            for (var i = 0; i < snapshot.Count; i++)
            {
                var entry = snapshot[i];
                if (entry is null || entry.IsDestroyed) continue;
                try
                {
                    entry.Kill();
                    killed++;
                }
                catch (Exception ex)
                {
                    PrintWarning($"ForceClose: Failed to kill {label} entity: {ex.Message}");
                }
            }

            if (killed > 0)
                Puts($"ForceClose: Killed {killed} vanilla {label}.");
        }
        finally
        {
            Pool.FreeUnmanaged(ref snapshot);
        }
    }

    private static void PruneDestroyedEntries<T>(ListHashSet<T> set) where T : BaseNetworkable
    {
        if (set is null || set.Count == 0) return;

        var stale = Pool.Get<List<T>>();
        try
        {
            foreach (var entry in set)
            {
                if (entry is null || entry.IsDestroyed)
                    stale.Add(entry);
            }

            for (var i = 0; i < stale.Count; i++)
                set.Remove(stale[i]);
        }
        finally
        {
            Pool.FreeUnmanaged(ref stale);
        }
    }

    private static int CountAlive<T>(ListHashSet<T> set) where T : BaseNetworkable
    {
        if (set is null) return 0;

        var count = 0;
        foreach (var entry in set)
        {
            if (entry is not null && !entry.IsDestroyed)
                count++;
        }
        return count;
    }

    private void SpawnTreasureStashes()
    {
        if (!_deepSeaOpen) return;

        try
        {
            if (DeepSeaManager.ServerIslands == null || DeepSeaManager.ServerIslands.Count == 0)
            {
                PrintWarning("No islands available for treasure spawn.");
                return;
            }

            var islandPositions = Pool.Get<List<Vector3>>();
            try
            {
                foreach (var island in DeepSeaManager.ServerIslands)
                {
                    if (island is not null && !island.IsDestroyed)
                        islandPositions.Add(island.transform.position);
                }

                if (islandPositions.Count == 0) return;

                var count = Mathf.Min(_config.Events.TreasureHunt.Count, islandPositions.Count);
                var available = islandPositions.Count;

                for (var i = 0; i < count; i++)
                {
                    var idx = Random.Range(0, available);
                    var basePos = islandPositions[idx];
                    islandPositions[idx] = islandPositions[--available];
                    var offset = new Vector3(Random.Range(-30f, 30f), 0f, Random.Range(-30f, 30f));
                    var spawnPos = basePos + offset;

                    if (Physics.Raycast(spawnPos + Vector3.up * 50f, Vector3.down, out var hit, 100f, Layers.Solid))
                        spawnPos = hit.point;

                    var stash = GameManager.server.CreateEntity(SmallStashPrefab, spawnPos);
                    if (stash is null) continue;

                    stash.Spawn();
                    _spawnedEventEntities.Add(stash);

                    var storage = stash.GetComponent<StorageContainer>();
                    if (storage?.inventory == null) continue;
                    for (var j = 0; j < _config.Events.TreasureHunt.TreasureItems.Count; j++)
                    {
                        var entry = _config.Events.TreasureHunt.TreasureItems[j];
                        if (Random.value > entry.Chance) continue;

                        var def = GetCachedItemDef(entry.Shortname);
                        if (def is null) continue;

                        var item = ItemManager.Create(def, entry.Amount, entry.SkinId);
                        if (item != null && !item.MoveToContainer(storage.inventory))
                            item.Remove();
                    }

                    if (_config.Events.TreasureHunt.ShowMapMarkers)
                        SpawnMapMarker(spawnPos, _config.Events.TreasureHunt.MapMarkerRadius, new Color(1f, 0.8f, 0f, 0.5f), new Color(1f, 0.65f, 0f, 0.8f));
                }

                BroadcastToDeepSeaPlayers(GetMsg("Events.TreasureSpawned"));
                NotifyDeepSeaPlayers(NcpInfo, GetMsg("NCP.TreasureSpawned"));
                //Puts($"Spawned {count} treasure stashes in the Deep Sea.");
            }
            finally
            {
                Pool.FreeUnmanaged(ref islandPositions);
            }
        }
        catch (Exception ex)
        {
            PrintWarning($"Failed to spawn treasure stashes: {ex.Message}");
        }
    }

    private void SpawnBoss()
    {
        if (!_deepSeaOpen) return;

        try
        {
            var spawnPos = Vector3.zero;
            var islandCenter = Vector3.zero;
            DeepSeaIsland targetIsland = null;
            var largestScale = 0f;

            if (DeepSeaManager.ServerIslands != null)
            {
                foreach (var island in DeepSeaManager.ServerIslands)
                {
                    if (island is null || island.IsDestroyed) continue;
                    var scale = island.transform.localScale.sqrMagnitude;
                    if (!(scale > largestScale)) continue;
                    largestScale = scale;
                    targetIsland = island;
                    islandCenter = island.transform.position;
                    spawnPos = islandCenter + Vector3.up * 2f;
                }
            }

            if (spawnPos == Vector3.zero)
            {
                islandCenter = new Vector3(-5900f, 5f, 0f);
                spawnPos = islandCenter;
            }

            var patrolRadius = _config.Events.BossSpawn.PatrolRadius;
            var foundShore = false;
            for (var i = 0; i < 12; i++)
            {
                var angle = i * Mathf.PI * 2f / 12;
                if (!BradleyCollisionHandler.TryGetValidNodePosition(islandCenter, angle, patrolRadius, out var shorePos)) continue;
                spawnPos = shorePos;
                foundShore = true;
                break;
            }

            if (!foundShore)
                Puts("Warning: Could not find shore position for Bradley, using island center.");

            var bradley = GameManager.server.CreateEntity(BradleyPrefab, spawnPos);
            if (bradley is null) return;
            bradley.Spawn();
            _spawnedEventEntities.Add(bradley);

            if (bradley is BradleyAPC apc)
            {
                apc.stoppingDist = 10f;

                var waypoints = BradleyCollisionHandler.BuildBradleyWaypoints(apc, targetIsland, _config.Events.BossSpawn.PatrolRadius);
                var handler = apc.gameObject.AddComponent<BradleyCollisionHandler>();
                handler.Init(islandCenter, _config.Events.BossSpawn.PatrolRadius + 50f, waypoints);
            }

            if (_config.Events.BossSpawn.HealthMultiplier > 1f)
            {
                if (bradley is BaseCombatEntity combat)
                {
                    var newHealth = combat.MaxHealth() * _config.Events.BossSpawn.HealthMultiplier;
                    combat.InitializeHealth(newHealth, newHealth);
                }
            }

            if (_config.Events.BossSpawn.ShowMapMarker)
                SpawnMapMarker(islandCenter, _config.Events.BossSpawn.MapMarkerRadius, new Color(0.85f, 0.15f, 0.15f, 0.6f), new Color(0.9f, 0.1f, 0.1f, 0.9f));

            BroadcastToDeepSeaPlayers(GetMsg("Events.BossSpawning"));
            NotifyDeepSeaPlayers(NcpError, GetMsg("NCP.BossSpawning"));
            //Puts("Boss Bradley spawned in the Deep Sea.");
        }
        catch (Exception ex)
        {
            PrintWarning($"Failed to spawn boss: {ex.Message}");
        }
    }

    private sealed class BradleyCollisionHandler : FacepunchBehaviour
    {
        private const string BunkerCannonPrefab = "assets/prefabs/misc/deepseadwellings/bunkercannon.prefab";

        private Collider[] _bradleyColliders;
        private readonly HashSet<Collider> _ignored = new();

        private BradleyAPC _apc;
        private Vector3 _islandCenter;

        private float _lastDistToWaypoint = float.MaxValue;
        private float _stuckSince;
        private int _detourAttempts;
        private Vector3 _stuckOriginPos;

        private int _resumeAfterBacktrack;

        private const float EscapeDistanceSqr = 20f * 20f;

        private float _originalMoveForceMax;
        private bool _isBoosted;
        private const float BoostMultiplier = 2f;

        private const float StuckCheckInterval = 3f;
        private const float StuckTimeout = 8f;
        private const float ProgressThreshold = 1.5f;

        private static readonly float[] DetourEscalation = { 3f, 3f, 8f, 8f, 15f, 15f };

        private const float WaypointArrivalDist = 10f;
        private const float WaypointArrivalDistSqr = WaypointArrivalDist * WaypointArrivalDist;

        public Vector3[] Waypoints { get; private set; }
        public int CurrentWaypointIndex { get; private set; }
        public bool IsDetouring { get; private set; }
        public bool IsBacktracking { get; private set; }
        public bool IsFollowingArc { get; private set; }
        public Vector3 DetourPoint { get; private set; }
        public Vector3[] ArcWaypoints { get; private set; }
        public int ArcIndex { get; private set; }
        public HashSet<int> BlockedWaypoints { get; } = new();

        public void Init(Vector3 center, float searchRadius, Vector3[] waypoints)
        {
            _bradleyColliders = GetComponentsInChildren<Collider>();
            _apc = GetComponent<BradleyAPC>();
            _originalMoveForceMax = _apc.moveForceMax;
            Waypoints = waypoints;
            CurrentWaypointIndex = 0;
            _islandCenter = center;

            InstallMinimalPatrolPath();
            IgnoreNearbyBunkerCannons(center, searchRadius);
            InvokeRepeating(nameof(PatrolTick), 0.5f, 0.5f);
            InvokeRepeating(nameof(CheckStuck), 5f, StuckCheckInterval);
        }

        private void InstallMinimalPatrolPath()
        {
            var path = new RuntimePath();
            var nodes = new IAIPathNode[Waypoints.Length];

            for (var i = 0; i < Waypoints.Length; i++)
                nodes[i] = new RuntimePathNode(Waypoints[i]);

            path.Nodes = nodes;

            for (var i = 0; i < nodes.Length; i++)
            {
                var next = (i + 1) % nodes.Length;
                nodes[i].AddLink(nodes[next]);
                nodes[next].AddLink(nodes[i]);
            }

            var step = Mathf.Max(1, Waypoints.Length / 4);
            for (var i = 0; i < Waypoints.Length; i += step)
                path.AddInterestNode(new RuntimeInterestNode(Waypoints[i]));

            if (path.InterestNodes.Length < 2 && Waypoints.Length >= 2)
                path.AddInterestNode(new RuntimeInterestNode(Waypoints[Waypoints.Length - 1]));

            _apc.InstallPatrolPath(path);
        }

        private void PatrolTick()
        {
            if (_apc is null || _apc.IsDestroyed) return;
            if (Waypoints == null || Waypoints.Length == 0) return;

            var pos = transform.position;

            var legTarget = IsFollowingArc ? ArcWaypoints[ArcIndex] : Waypoints[CurrentWaypointIndex];

            var target = IsDetouring ? DetourPoint : legTarget;

            var dx = pos.x - target.x;
            var dz = pos.z - target.z;
            if (dx * dx + dz * dz <= WaypointArrivalDistSqr)
            {
                if (IsDetouring)
                {
                    IsDetouring = false;
                    target = legTarget;
                }
                else if (IsFollowingArc)
                {
                    ArcIndex++;
                    if (ArcIndex >= ArcWaypoints.Length)
                    {
                        IsFollowingArc = false;
                        ArcWaypoints = null;
                        CurrentWaypointIndex = _resumeAfterBacktrack;
                        target = Waypoints[CurrentWaypointIndex];
                    }
                    else
                    {
                        target = ArcWaypoints[ArcIndex];
                    }
                }
                else if (IsBacktracking)
                {
                    IsBacktracking = false;
                    if (ArcWaypoints is { Length: > 0 })
                    {
                        IsFollowingArc = true;
                        ArcIndex = 0;
                        target = ArcWaypoints[0];
                    }
                    else
                    {
                        CurrentWaypointIndex = _resumeAfterBacktrack;
                        target = Waypoints[CurrentWaypointIndex];
                    }
                }
                else
                {
                    CurrentWaypointIndex = FindNextNonBlockedWP(CurrentWaypointIndex);
                    target = Waypoints[CurrentWaypointIndex];
                }
            }
            _apc.SetDestination(target);
            _apc.finalDestination = target;
        }

        private void CheckStuck()
        {
            if (_apc is null || _apc.IsDestroyed) return;
            if (Waypoints == null || Waypoints.Length == 0) return;
            if (IsBacktracking) return;

            Vector3 target;
            if (IsFollowingArc)
                target = ArcWaypoints[ArcIndex];
            else if (IsDetouring)
                target = DetourPoint;
            else
                target = Waypoints[CurrentWaypointIndex];

            var distToWp = Vector3Ex.Distance2D(transform.position, target);

            if (distToWp < _lastDistToWaypoint - ProgressThreshold)
            {
                _stuckSince = 0f;

                if (_detourAttempts > 0 && _stuckOriginPos != Vector3.zero)
                {
                    var ddx = transform.position.x - _stuckOriginPos.x;
                    var ddz = transform.position.z - _stuckOriginPos.z;
                    if (ddx * ddx + ddz * ddz > EscapeDistanceSqr)
                    {
                        _detourAttempts = 0;
                        _stuckOriginPos = Vector3.zero;
                        IsDetouring = false;
                        RemoveDetourBoost();
                    }
                }
            }
            else
            {
                if (_stuckSince == 0f)
                    _stuckSince = UnityEngine.Time.time;
                else if (UnityEngine.Time.time - _stuckSince >= StuckTimeout)
                {
                    if (_detourAttempts == 0)
                        _stuckOriginPos = transform.position;

                    ApplyDetourBoost();
                    TryDetour();
                    _stuckSince = 0f;
                }
            }

            _lastDistToWaypoint = distToWp;
        }

        private void TryDetour()
        {
            while (true)
            {
                _detourAttempts++;

                if (_detourAttempts > DetourEscalation.Length)
                {
                    if (IsFollowingArc)
                    {
                        AbandonArc();
                    }
                    else
                    {
                        BacktrackAndSkip();
                    }

                    _detourAttempts = 0;
                    _stuckOriginPos = Vector3.zero;
                    RemoveDetourBoost();
                    return;
                }

                var offset = DetourEscalation[_detourAttempts - 1];
                var currentPos = transform.position;
                var targetWp = IsFollowingArc ? ArcWaypoints[ArcIndex] : Waypoints[CurrentWaypointIndex];

                var toTarget = targetWp - currentPos;
                toTarget.y = 0f;
                if (toTarget.sqrMagnitude < 4f)
                {
                    if (IsFollowingArc)
                        AbandonArc();
                    else
                        BacktrackAndSkip();
                    return;
                }

                var toTargetNorm = toTarget.normalized;

                var perp = Vector3.Cross(toTargetNorm, Vector3.up);
                var sign = (_detourAttempts % 2 == 1) ? 1f : -1f;

                Vector3 detourCandidate;
                if (offset <= 5f)
                {
                    detourCandidate = currentPos + perp * (offset * sign) + toTargetNorm * 5f;
                }
                else
                {
                    var midpoint = (currentPos + targetWp) * 0.5f;
                    detourCandidate = midpoint + perp * (offset * sign);
                }

                if (!TryValidateGroundPoint(detourCandidate, out var detourPoint)) continue;
                DetourPoint = detourPoint;
                IsDetouring = true;
                _apc.SetDestination(DetourPoint);
                _apc.finalDestination = DetourPoint;

                return;

            }
        }

        private void BacktrackAndSkip()
        {
            var problemIdx = CurrentWaypointIndex;
            BlockedWaypoints.Add(problemIdx);

            var safeIdx = problemIdx;
            for (var i = 1; i < Waypoints.Length; i++)
            {
                var candidate = (problemIdx - i + Waypoints.Length) % Waypoints.Length;
                if (BlockedWaypoints.Contains(candidate)) continue;
                safeIdx = candidate;
                break;
            }

            var resumeIdx = FindNextNonBlockedWP(problemIdx);

            ArcWaypoints = GenerateArcWaypoints(Waypoints[safeIdx], Waypoints[resumeIdx]);
            CurrentWaypointIndex = safeIdx;
            _resumeAfterBacktrack = resumeIdx;
            IsBacktracking = true;
            IsDetouring = false;
            IsFollowingArc = false;
            _lastDistToWaypoint = float.MaxValue;

            var target = Waypoints[safeIdx];
            _apc.SetDestination(target);
            _apc.finalDestination = target;

            var blockedList = Pool.Get<List<int>>();
            try
            {
                foreach (var b in BlockedWaypoints) blockedList.Add(b);
                blockedList.Sort();
                /*var blockedStr = string.Join(",", blockedList);
                Interface.Oxide.LogInfo($"[DeepSea] Bradley backtracking to WP {safeIdx} (blocked: [{blockedStr}]) - " +
                                        $"will arc {ArcWaypoints?.Length ?? 0} pts to WP {resumeIdx}");*/
            }
            finally
            {
                Pool.FreeUnmanaged(ref blockedList);
            }
        }

        private void AbandonArc()
        {
            IsFollowingArc = false;
            ArcWaypoints = null;
            CurrentWaypointIndex = _resumeAfterBacktrack;
            _lastDistToWaypoint = float.MaxValue;

            var target = Waypoints[CurrentWaypointIndex];
            _apc.SetDestination(target);
            _apc.finalDestination = target;

        }

        private int FindNextNonBlockedWP(int fromIdx)
        {
            for (var i = 1; i <= Waypoints.Length; i++)
            {
                var candidate = (fromIdx + i) % Waypoints.Length;
                if (!BlockedWaypoints.Contains(candidate))
                    return candidate;
            }
            return (fromIdx + 1) % Waypoints.Length;
        }

        private Vector3[] GenerateArcWaypoints(Vector3 from, Vector3 to)
        {
            var mid = (from + to) * 0.5f;

            var outward = mid - _islandCenter;
            outward.y = 0f;
            if (outward.sqrMagnitude < 1f) outward = Vector3.forward;
            outward = outward.normalized;

            const float arcOffset = 25f;
            var points = Pool.Get<List<Vector3>>();
            try
            {
                for (var i = 1; i <= 3; i++)
                {
                    var t = i / 4f;
                    var basePoint = Vector3.Lerp(from, to, t);
                    var parabola = 4f * t * (1f - t);
                    var offsetDist = arcOffset * parabola;

                    var candidate = basePoint + outward * offsetDist;
                    if (TryValidateGroundPoint(candidate, out var valid))
                    {
                        points.Add(valid);
                        continue;
                    }

                    candidate = basePoint - outward * (offsetDist * 0.5f);
                    if (TryValidateGroundPoint(candidate, out valid))
                        points.Add(valid);
                }

                return points.Count > 0 ? points.ToArray() : null;
            }
            finally
            {
                Pool.FreeUnmanaged(ref points);
            }
        }

        private static bool TryValidateGroundPoint(Vector3 candidate, out Vector3 result)
        {
            result = Vector3.zero;
            if (!Physics.Raycast(new Vector3(candidate.x, 500f, candidate.z), Vector3.down, out var hit, 600f, Layers.Solid))
                return false;
            if (hit.point.y <= WaterSystem.OceanLevel + 0.5f)
                return false;
            if (Vector3.Angle(hit.normal, Vector3.up) >= 45f)
                return false;
            result = new Vector3(hit.point.x, hit.point.y + 1f, hit.point.z);
            return true;
        }
        
        private void ApplyDetourBoost()
        {
            if (_isBoosted || _apc is null || _apc.IsDestroyed) return;
            _apc.moveForceMax = _originalMoveForceMax * BoostMultiplier;
            _isBoosted = true;
            InvokeRepeating(nameof(ForceThrottle), 0f, 0.1f);
        }

        private void RemoveDetourBoost()
        {
            if (!_isBoosted) return;
            if (_apc is not null && !_apc.IsDestroyed)
                _apc.moveForceMax = _originalMoveForceMax;
            _isBoosted = false;
            CancelInvoke(nameof(ForceThrottle));
        }

        private void ForceThrottle()
        {
            if (_apc is null || _apc.IsDestroyed) { RemoveDetourBoost(); return; }
            _apc.throttle = 1f;
        }

        private void IgnoreNearbyBunkerCannons(Vector3 center, float searchRadius)
        {
            var entities = Pool.Get<List<BaseEntity>>();
            try
            {
                Vis.Entities(center, searchRadius, entities);
                foreach (var entity in entities)
                {
                    if (entity is null || entity.IsDestroyed) continue;
                    if (entity.PrefabName != BunkerCannonPrefab) continue;
                    IgnoreEntityColliders(entity);
                }
            }
            finally
            {
                Pool.FreeUnmanaged(ref entities);
            }
        }

        private void IgnoreEntityColliders(BaseEntity entity)
        {
            if (_bradleyColliders == null) return;
            foreach (var otherCollider in entity.GetComponentsInChildren<Collider>())
            {
                if (otherCollider is null || _ignored.Contains(otherCollider)) continue;
                foreach (var bc in _bradleyColliders)
                {
                    if (bc is not null)
                        Physics.IgnoreCollision(bc, otherCollider, true);
                }
                _ignored.Add(otherCollider);
            }
        }

        private void OnCollisionEnter(Collision collision)
        {
            if (_bradleyColliders == null) return;
            var entity = collision.GetEntity();
            if (entity is null || entity.IsDestroyed) return;
            if (entity.PrefabName != BunkerCannonPrefab) return;
            IgnoreEntityColliders(entity);
        }

        public static bool TryGetValidNodePosition(Vector3 center, float angle, float radius, out Vector3 result)
        {
            const float minRadius = 15f;
            const float radiusStep = 5f;

            for (var r = radius; r >= minRadius; r -= radiusStep)
            {
                var candidate = center + new Vector3(Mathf.Cos(angle) * r, 0f, Mathf.Sin(angle) * r);

                if (!Physics.Raycast(new Vector3(candidate.x, 500f, candidate.z), Vector3.down, out var hit, 600f, Layers.Solid))
                    continue;

                if (!(hit.point.y > WaterSystem.OceanLevel + 0.5f)) continue;
                result = hit.point + Vector3.up * 1f;
                return true;
            }

            result = Vector3.zero;
            return false;
        }

        public static Vector3[] BuildBradleyWaypoints(BradleyAPC bradley, DeepSeaIsland island, float fallbackRadius)
        {
            if (island is not null && !island.IsDestroyed
                && IslandPatrolRoutes.TryGetValue(island.Variant, out var localPoints)
                && localPoints.Length >= 3)
            {
                var mapped = BuildMappedWaypoints(island, localPoints);
                if (mapped is { Length: >= 3 })
                    return mapped;
            }

            var center = island is not null && !island.IsDestroyed
                ? island.transform.position
                : bradley.transform.position;
            return BuildGenericCircularWaypoints(center, fallbackRadius, bradley.transform.position);
        }

        private static Vector3[] BuildMappedWaypoints(DeepSeaIsland island, Vector3[] localPoints)
        {
            var worldPoints = new Vector3[localPoints.Length];

            for (var i = 0; i < localPoints.Length; i++)
            {
                var worldPos = island.transform.TransformPoint(localPoints[i]);

                if (Physics.Raycast(new Vector3(worldPos.x, 500f, worldPos.z), Vector3.down, out var hit, 600f, Layers.Solid))
                    worldPos.y = hit.point.y + 1f;
                else
                    worldPos.y = TerrainMeta.HeightMap.GetHeight(worldPos) + 1f;

                worldPoints[i] = worldPos;
            }

            return worldPoints;
        }

        private static Vector3[] BuildGenericCircularWaypoints(Vector3 center, float radius, Vector3 bradleyPos)
        {
            const int numPoints = 12;

            var validPositions = new List<Vector3>(numPoints);

            for (var i = 0; i < numPoints; i++)
            {
                var angle = i * Mathf.PI * 2f / numPoints;
                if (TryGetValidNodePosition(center, angle, radius, out var pos))
                    validPositions.Add(pos);
            }

            if (validPositions.Count >= 3) return validPositions.ToArray();
            var spawnPos = bradleyPos + Vector3.up * 1f;
            return new[]
            {
                spawnPos + Vector3.forward * 10f,
                spawnPos - Vector3.forward * 10f
            };

        }

        private void OnDestroy()
        {
            RemoveDetourBoost();
            CancelInvoke();

            if (_apc is not null && !_apc.IsDestroyed)
            {
                _apc.patrolPath = null;
                _apc.currentPath?.Clear();
                _apc.currentPathIndex = -1;
            }

            Waypoints = null;
            ArcWaypoints = null;
            BlockedWaypoints.Clear();
            _ignored.Clear();
            _bradleyColliders = null;
            _apc = null;
        }
    }

    private void CallSupplyDrop()
    {
        if (!_deepSeaOpen) return;

        try
        {
            var targetPos = Vector3.zero;

            if (DeepSeaManager.ServerIslands != null && DeepSeaManager.ServerIslands.Count > 0)
            {
                var idx = Random.Range(0, DeepSeaManager.ServerIslands.Count);
                var i = 0;
                foreach (var island in DeepSeaManager.ServerIslands)
                {
                    if (i == idx)
                    {
                        targetPos = island.transform.position;
                        break;
                    }
                    i++;
                }
            }

            if (targetPos == Vector3.zero)
                targetPos = new Vector3(-5900f, 0f, Random.Range(-500f, 500f));

            var dropPos = targetPos + new Vector3(0f, 200f, 0f);
            var drop = GameManager.server.CreateEntity(SupplyDropPrefab, dropPos);
            if (drop is null) return;
            drop.Spawn();
            _spawnedEventEntities.Add(drop);

            if (_config.Events.SupplyDrops.ShowMapMarkers)
                SpawnMapMarker(targetPos, 0.06f, new Color(0.3f, 0.6f, 1f, 0.5f), new Color(0.2f, 0.5f, 0.9f, 0.8f));

            BroadcastToDeepSeaPlayers(GetMsg("Events.SupplyDrop"));
            NotifyDeepSeaPlayers(NcpInfo, GetMsg("NCP.SupplyDrop"));
        }
        catch (Exception ex)
        {
            PrintWarning($"Failed to call supply drop: {ex.Message}");
        }
    }

    #endregion

    #region Building Controls

    private object CanBuild(Planner planner, Construction prefab, Construction.Target target)
    {
        if (planner is null || !_deepSeaOpen) return null;
        if (!_config.GeneralControls.ControlBuilding) return null;

        var player = planner.GetOwnerPlayer();
        if (player is null || !player.userID.IsSteamId()) return null;
        if (!IsInDeepSea(player.transform.position)) return null;

        if (permission.UserHasPermission(player.UserIDString, PermBuildBypass))
            return null;

        if (!_config.BuildingControls.AllowBuildingInDeepSea)
        {
            if (!_config.BuildingControls.ShowMessageWhenDenied) return false;
            player.ChatMessage(GetMsg("Building.Denied", player));
            ShowBuildToast(player, GetMsg("Building.Toast.Denied"));
            return false;
        }

        if (!_config.BuildingControls.LimitFoundations) return null;

        var isFoundation = prefab?.fullName != null &&
                           prefab.fullName.IndexOf("foundation", StringComparison.OrdinalIgnoreCase) >= 0;
        if (!isFoundation) return null;

        var count = GetFoundationCount(player.userID);
        if (count < _config.BuildingControls.MaxFoundationsPerPlayer)
            return null;

        if (!_config.BuildingControls.ShowMessageWhenDenied) return false;
        var msg = string.Format(GetMsg("Building.LimitReached", player), _config.BuildingControls.MaxFoundationsPerPlayer);
        player.ChatMessage(msg);
        ShowBuildToast(player, msg);

        return false;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private int GetFoundationCount(ulong userId)
        => _foundationCounts.TryGetValue(userId, out var count) ? count : 0;

    private void IncrementFoundationCount(ulong ownerId)
    {
        _foundationCounts.TryGetValue(ownerId, out var count);
        _foundationCounts[ownerId] = count + 1;
    }

    private void DecrementFoundationCount(ulong ownerId)
    {
        if (!_foundationCounts.TryGetValue(ownerId, out var count)) return;
        if (count <= 1)
            _foundationCounts.Remove(ownerId);
        else
            _foundationCounts[ownerId] = count - 1;
    }

    private IEnumerator ScanExistingFoundationsCoroutine()
    {
        _foundationCounts.Clear();

        var count = 0;
        var processed = 0;
        foreach (var entity in BaseNetworkable.serverEntities)
        {
            processed++;
            if (processed % 500 == 0)
                yield return null;

            if (entity is not BuildingBlock block) continue;
            if (block.IsDestroyed || block.net == null) continue;
            if (!IsInDeepSea(block.transform.position)) continue;

            var prefabName = block.ShortPrefabName;
            if (prefabName is null || prefabName.IndexOf("foundation", StringComparison.OrdinalIgnoreCase) < 0)
                continue;
            if (!block.OwnerID.IsSteamId()) continue;

            IncrementFoundationCount(block.OwnerID);
            count++;
        }

        if (count > 0)
            Puts($"Foundation scan: Tracked {count} existing foundations across {_foundationCounts.Count} players.");
    }

    private static void ShowBuildToast(BasePlayer player, string message)
    {
        if (player is null || !player.IsConnected) return;
        player.SendConsoleCommand("gametip.showtoast", (int)GameTip.Styles.Blue_Normal, message);
    }

    #endregion

    #region Inventory Snapshot

    private void SnapshotInventory(BasePlayer player)
    {
        if (player?.inventory is null) return;

        var backpack = player.inventory.GetBackpackWithInventory();
        var items = new List<SnapshotItem>(38 + (backpack?.contents?.capacity ?? 0));
        SnapshotContainer(player.inventory.containerBelt, "belt", items);
        SnapshotContainer(player.inventory.containerMain, "main", items);
        SnapshotContainer(player.inventory.containerWear, "wear", items);

        _inventorySnapshots[player.userID] = items;
    }

    private static void SnapshotContainer(ItemContainer container, string containerName, List<SnapshotItem> list)
    {
        if (container == null) return;

        for (var i = 0; i < container.itemList.Count; i++)
        {
            var item = container.itemList[i];
            if (item == null) continue;
            list.Add(CreateItemSnapshot(item, containerName));
        }
    }

    private static SnapshotItem CreateItemSnapshot(Item item, string containerName)
    {
        var snap = new SnapshotItem
        {
            Shortname = item.info.shortname,
            Amount = item.amount,
            Condition = item.condition,
            MaxCondition = item.maxCondition,
            SkinId = item.skin,
            Position = item.position,
            Container = containerName,
            BlueprintTarget = item.blueprintTarget
        };

        if (item.contents == null || item.contents.itemList.Count <= 0) return snap;

        snap.Contents = new List<SnapshotItem>(item.contents.itemList.Count);
        for (var j = 0; j < item.contents.itemList.Count; j++)
        {
            var sub = item.contents.itemList[j];
            if (sub == null) continue;
            snap.Contents.Add(CreateItemSnapshot(sub, "contents"));
        }

        return snap;
    }

    private static void RestoreInventory(BasePlayer player, List<SnapshotItem> snapshot)
    {
        if (player?.inventory is null || snapshot == null) return;

        player.inventory.Strip();

        for (var i = 0; i < snapshot.Count; i++)
        {
            var snap = snapshot[i];

            var def = ItemManager.FindItemDefinition(snap.Shortname);
            if (def is null) continue;

            var item = ItemManager.Create(def, snap.Amount, snap.SkinId);
            if (item == null) continue;

            item.condition = snap.Condition;
            item.maxCondition = snap.MaxCondition;

            if (snap.BlueprintTarget != 0)
                item.blueprintTarget = snap.BlueprintTarget;

            RestoreItemContents(item, snap.Contents);

            var targetContainer = snap.Container switch
            {
                "belt" => player.inventory.containerBelt,
                "wear" => player.inventory.containerWear,
                _ => player.inventory.containerMain
            };

            if (item.MoveToContainer(targetContainer, snap.Position)) continue;
            if (!item.MoveToContainer(player.inventory.containerMain))
                item.Remove();
        }
    }

    private static void RestoreItemContents(Item parent, List<SnapshotItem> contents)
    {
        if (parent?.contents == null || contents == null) return;

        for (var j = 0; j < contents.Count; j++)
        {
            var subSnap = contents[j];
            var subDef = ItemManager.FindItemDefinition(subSnap.Shortname);
            if (subDef is null) continue;

            var subItem = ItemManager.Create(subDef, subSnap.Amount, subSnap.SkinId);
            if (subItem == null) continue;

            subItem.condition = subSnap.Condition;
            subItem.maxCondition = subSnap.MaxCondition;

            if (subSnap.BlueprintTarget != 0)
                subItem.blueprintTarget = subSnap.BlueprintTarget;

            subItem.MoveToContainer(parent.contents, subSnap.Position);

            RestoreItemContents(subItem, subSnap.Contents);
        }
    }

    #endregion

    #region Discord Webhook

    private void SendDiscordMessage(string content, string title, int color = 0)
    {
        if (!_config.Discord.Enabled) return;
        if (string.IsNullOrEmpty(_config.Discord.WebhookUrl)) return;

        if (color == 0) color = _config.Discord.EmbedColor;

        var sb = Pool.Get<StringBuilder>();
        try
        {
            sb.Clear();
            sb.Append("{\"embeds\":[{\"title\":\"");
            sb.Append(title.Replace("\"", "\\\""));
            sb.Append("\",\"description\":\"");
            sb.Append(content.Replace("\"", "\\\""));
            sb.Append("\",\"color\":");
            sb.Append(color);
            sb.Append(",\"timestamp\":\"");
            sb.Append(DateTime.UtcNow.ToString("o"));
            sb.Append("\",\"footer\":{\"text\":\"DeepSeaPlus v");
            sb.Append(Version);
            sb.Append("\"}}]}");

            var payload = sb.ToString();

            webrequest.Enqueue(
                _config.Discord.WebhookUrl,
                payload,
                (code, response) =>
                {
                    if (code is < 200 or >= 300)
                        PrintWarning($"Discord webhook returned HTTP {code}");
                },
                this,
                Oxide.Core.Libraries.RequestMethod.POST,
                DiscordHeaders
            );
        }
        finally
        {
            Pool.FreeUnmanaged(ref sb);
        }
    }

    #endregion

    #region Helpers

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool IsInDeepSea(Vector3 position) => DeepSeaBounds.Contains(position);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool HasChildHackableCrate(BaseEntity parent)
    {
        if (parent.children is null) return false;
        for (var i = 0; i < parent.children.Count; i++)
        {
            if (parent.children[i] is HackableLockedCrate { IsDestroyed: false })
                return true;
        }
        return false;
    }

    private static Vector3? FindNearestDeepSeaIsland(Vector3 from)
    {
        if (DeepSeaManager.ServerIslands == null || DeepSeaManager.ServerIslands.Count == 0)
            return null;

        Vector3? best = null;
        var bestDist = float.MaxValue;
        foreach (var island in DeepSeaManager.ServerIslands)
        {
            if (island is null || island.IsDestroyed) continue;
            var dist = (island.transform.position - from).sqrMagnitude;
            if (dist >= bestDist) continue;
            bestDist = dist;
            best = island.transform.position + Vector3.up * 5f;
        }
        return best;
    }

    private static Vector3? GetIslandPositionByIndex(int index)
    {
        if (DeepSeaManager.ServerIslands == null || DeepSeaManager.ServerIslands.Count == 0)
            return null;

        var idx = 0;
        foreach (var island in DeepSeaManager.ServerIslands)
        {
            if (idx == index)
                return island.transform.position + Vector3.up * 5f;
            idx++;
        }
        return null;
    }

    private static Vector3 FindNearestShorePosition()
    {
        if (DeepSeaManager.ServerPortals != null)
        {
            foreach (var portal in DeepSeaManager.ServerPortals)
            {
                if (portal is null || portal.IsDestroyed) continue;
                if (portal.PortalMode != DeepSeaPortal.PortalModeEnum.Entrance) continue;
                if (!portal.HasFlag(BaseEntity.Flags.Open)) continue;

                var portalPos = portal.transform.position;
                var toCenter = Vector3.zero - portalPos;
                toCenter.y = 0f;
                if (toCenter.sqrMagnitude > 1f)
                    toCenter.Normalize();
                else
                    toCenter = Vector3.forward;

                for (var i = 0; i < ShoreSearchOffsets.Length; i++)
                {
                    var candidate = portalPos + toCenter * ShoreSearchOffsets[i];
                    if (Physics.Raycast(new Vector3(candidate.x, 500f, candidate.z), Vector3.down, out var hit, 600f, Layers.Solid))
                    {
                        if (hit.point.y > WaterSystem.OceanLevel + 0.5f)
                            return hit.point + Vector3.up * 1f;
                    }
                    else
                    {
                        var h = TerrainMeta.HeightMap.GetHeight(candidate);
                        if (h > WaterSystem.OceanLevel + 0.5f)
                            return new Vector3(candidate.x, h + 1f, candidate.z);
                    }
                }
            }
        }

        var spawnPoint = SpawnHandler.GetSpawnPoint();
        if (spawnPoint != null)
            return spawnPoint.pos;

        var center = Vector3.zero;
        var toDeepSea = DeepSeaBounds.center - center;
        toDeepSea.y = 0f;
        toDeepSea.Normalize();

        var lastAboveWater = center;
        lastAboveWater.y = TerrainMeta.HeightMap.GetHeight(center) + 2f;

        for (var d = 50f; d < 2500f; d += 25f)
        {
            var testPos = center + toDeepSea * d;
            var height = TerrainMeta.HeightMap.GetHeight(testPos);

            if (height > WaterSystem.OceanLevel + 1f)
                lastAboveWater = new Vector3(testPos.x, height + 2f, testPos.z);
            else if (d > 100f)
                break;
        }

        if ((lastAboveWater - center).sqrMagnitude > 100f)
            return lastAboveWater;

        if (Physics.Raycast(new Vector3(0f, 500f, 0f), Vector3.down, out var centerHit, 600f, Layers.Solid))
            return centerHit.point + Vector3.up * 2f;

        var fallback = Vector3.zero;
        fallback.y = TerrainMeta.HeightMap.GetHeight(fallback) + 2f;
        return fallback;
    }

    private void TeleportWithLoading(BasePlayer player, Vector3 position, bool toDeepSea)
    {
        if (player is null || !player.IsConnected) return;

        if (player.isMounted)
            player.EnsureDismounted();
        if (player.HasParent())
            player.SetParent(null, true);

        player.SetPlayerFlag(BasePlayer.PlayerFlags.ReceivingSnapshot, true);
        player.ClientRPC(Player("StartLoading", player));
        _manager?.ClientRPC(Player("CLIENT_PlayerEnterOrLeaveDeepSea", player), toDeepSea);
        player.StartSleeping();
        player.Teleport(position);
        player.UpdateNetworkGroup();
        player.SendNetworkUpdateImmediate();
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static string FormatTime(float seconds)
    {
        if (seconds <= 0f) return "0s";

        var totalSeconds = Mathf.RoundToInt(seconds);
        var hours = totalSeconds / 3600;
        var minutes = (totalSeconds % 3600) / 60;
        var secs = totalSeconds % 60;

        if (hours > 0)
            return $"{hours}h {minutes:D2}m {secs:D2}s";
        return minutes > 0 ? $"{minutes}m {secs:D2}s" : $"{secs}s";
    }

    private static void BroadcastChat(string message)
    {
        for (var i = 0; i < BasePlayer.activePlayerList.Count; i++)
        {
            var player = BasePlayer.activePlayerList[i];
            if (player is null || !player.IsConnected) continue;
            player.ChatMessage(message);
        }
    }

    private static void BroadcastToast(string message, GameTip.Styles style)
    {
        var styleInt = (int)style;
        for (var i = 0; i < BasePlayer.activePlayerList.Count; i++)
        {
            var player = BasePlayer.activePlayerList[i];
            if (player is null || !player.IsConnected) continue;
            player.SendConsoleCommand("gametip.showtoast", styleInt, message);
        }
    }

    private void BroadcastToDeepSeaPlayers(string message)
    {
        foreach (var session in _activeSessions.Values)
        {
            var player = session.Player;
            if (player is not null && player.IsConnected)
                player.ChatMessage(message);
        }
    }

    private void BroadcastToastToDeepSeaPlayers(string message, GameTip.Styles style)
    {
        var styleInt = (int)style;
        foreach (var session in _activeSessions.Values)
        {
            var player = session.Player;
            if (player is null || !player.IsConnected) continue;
            player.SendConsoleCommand("gametip.showtoast", styleInt, message);
        }
    }

    private void Notify(BasePlayer player, int ncpType, string message)
    {
        if (!_config.Notifications.UseNCPNotifications) return;
        if (NCP is null || !NCP.IsLoaded) return;
        if (player is null || !player.IsConnected) return;
        NCP.Call("SendNotify", player, ncpType, message);
    }

    private void NotifyAll(int ncpType, string message)
    {
        if (!_config.Notifications.UseNCPNotifications) return;
        if (NCP is null || !NCP.IsLoaded) return;
        NCP.Call("SendNotifyAllPlayers", ncpType, message);
    }

    private void NotifyDeepSeaPlayers(int ncpType, string message)
    {
        if (!_config.Notifications.UseNCPNotifications) return;
        if (NCP is null || !NCP.IsLoaded) return;
        foreach (var session in _activeSessions.Values)
        {
            var player = session.Player;
            if (player is null || !player.IsConnected) continue;
            NCP.Call("SendNotify", player, ncpType, message);
        }
    }

    private void SpawnMapMarker(Vector3 position, float radius, Color color1, Color color2)
    {
        try
        {
            if (GameManager.server.CreateEntity(
                    "assets/prefabs/tools/map/genericradiusmarker.prefab", position) is not MapMarkerGenericRadius marker) return;

            marker.alpha = 0.6f;
            marker.color1 = color1;
            marker.color2 = color2;
            marker.radius = radius;
            marker.Spawn();
            marker.SendUpdate();
            _spawnedEventEntities.Add(marker);
        }
        catch (Exception ex)
        {
            PrintWarning($"Failed to spawn map marker: {ex.Message}");
        }
    }

    private static BasePlayer FindPlayer(string nameOrId)
    {
        if (ulong.TryParse(nameOrId, out var uid))
        {
            var found = RelationshipManager.FindByID(uid);
            if (found is not null) return found;
        }

        BasePlayer bestMatch = null;
        for (var i = 0; i < BasePlayer.activePlayerList.Count; i++)
        {
            var player = BasePlayer.activePlayerList[i];
            if (player is null) continue;
            if (string.Equals(player.displayName, nameOrId, StringComparison.OrdinalIgnoreCase))
                return player;
            if (player.displayName.IndexOf(nameOrId, StringComparison.OrdinalIgnoreCase) >= 0)
                bestMatch = player;
        }
        return bestMatch;
    }

    #endregion

    #region API Methods

    private bool IsPlayerInDeepSea(ulong userId) => _playersInDeepSea.Contains(userId);

    private bool IsDeepSeaOpen() => _deepSeaOpen;

    private int GetDeepSeaPlayerCountApi() => _playersInDeepSea.Count;

    private string[] GetDeepSeaPlayerIds()
    {
        var ids = new string[_playersInDeepSea.Count];
        var i = 0;
        foreach (var uid in _playersInDeepSea)
            ids[i++] = uid.ToString();
        return ids;
    }

    private Dictionary<string, object> GetPlayerDeepSeaStats(ulong userId)
    {
        if (!_data.PlayerStats.TryGetValue(userId, out var stats))
            return null;

        return new Dictionary<string, object>
        {
            ["DisplayName"] = stats.DisplayName,
            ["TotalVisits"] = stats.TotalVisits,
            ["TotalTimeSpent"] = stats.TotalTimeSpent,
            ["TotalNpcKills"] = stats.TotalNpcKills,
            ["TotalContainersLooted"] = stats.TotalContainersLooted,
            ["TotalDeaths"] = stats.TotalDeaths
        };
    }

    #endregion

    #region Data Persistence

    private void LoadData()
    {
        try
        {
            _data = ProtoStorage.Load<StoredData>(Name);
        }
        catch
        {
            _data = null;
        }

        _data ??= new StoredData();
    }

    private void SaveData()
    {
        if (_data == null) return;
        ProtoStorage.Save(_data, Name);
    }

    #endregion
} 