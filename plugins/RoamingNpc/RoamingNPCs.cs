// #define DefaultConfig
// #define DebugLog

using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text;
using Facepunch;
using Network;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using Oxide.Core;
using Oxide.Core.Plugins;
using Oxide.Core.Libraries;
using Oxide.Core.Libraries.Covalence;
using Oxide.Plugins.RoamingNPCex;
using Rust;
using Rust.Ai.Gen2;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Events;
using Random = UnityEngine.Random;

namespace Oxide.Plugins
{
    [Info("Roaming NPCs", "walkinrey & Max39ru", "0.5.62")]
    public partial class RoamingNPCs : CovalencePlugin
    {
        [PluginReference] private Plugin DeployableNature, Spawns, WarMode;

        public const bool RU = false;
        public const string AdminPermission = "roamingnpcs.admin";
        public const string PrefabPetBot = "assets/rust.ai/agents/npcplayer/pet/frankensteinpet.prefab";
        public const string PrefabPlayer = "assets/prefabs/player/player.prefab";
        public static RoamingNPCs instance;
        private Timer _timer;
        private Timer _bridgePatrolTimer;
        private Timer _bridgeDepositApproachTimer;
        /// <summary>MaxxInvaders bridge <c>deposit</c>: bot must be this close (m) before items move into storage.</summary>
        private const float BridgeDepositApproachCompleteDistance = 2f;
        /// <summary>ApplyBridgeTask: minimum brain <see cref="ControllerSetup.RadiusFindEntity"/> for bridge bots (collectibles + Vis scan).</summary>
        private const float BridgeTaskMinFindRadius = 72f;
        /// <summary>When a <see cref="DataBot.BridgeHomeCupboardNetId"/> is set, scan at least this far for resources while roaming from home.</summary>
        private const float BridgeHomeRoamMinFindRadius = 110f;
        /// <summary><see cref="ApplyBridgeTask"/> mixed: wider Vis/collectible scan for cloth, drops, corpses, barrels.</summary>
        private const float BridgeMixedTaskMinFindRadius = 130f;
        /// <summary>Protect idle-hold (MaxxInvaders): if anchor moves less than this between patrol moves, treat as stationary.</summary>
        private const float BridgeProtectIdleAnchorStationarySqr = 0.81f;

        public Configuration config;
        public DataBots Data;
        public List<string> NicknamesData;
        public Dictionary<ulong, CustomPet> listNpcPlayers = new();
        public Monuments monuments;
        public List<string> visibleAdmins = new();
        public List<string> visibleAdminsStash = new();

        /// <summary>Non-empty display name so the client does not fall back to showing the numeric bot userID as a nameplate.</summary>
        public const string HiddenNpcNameplate = "\u00A0";
        public static JsonSerializerSettings settingsSerializer = new JsonSerializerSettings
        {
            NullValueHandling = NullValueHandling.Ignore,
            ContractResolver = new CustomContractResolver()
        };

        public OnBotCreatedEvent OnBotCreated = new OnBotCreatedEvent();
        private readonly Dictionary<ulong, Timer> respawnTimers = new();

        /// <summary>PersonalNPC-style fake corpse per looter so the client accepts <c>RPC_OpenLootPanel</c> (live NPC as loot source does not).</summary>
        private readonly Dictionary<ulong, LootableCorpse> _roamingInventoryLootProxies = new();
        /// <summary>While a player has bridge NPC inventory open (corpse proxy), maps looter Steam id → live <see cref="CustomPet"/> net id.</summary>
        private readonly Dictionary<ulong, ulong> _bridgeLootPetNetByLooter = new();

        private readonly Dictionary<ulong, float> _roamingLootUseDebounce = new();

        /// <summary>After bridge medic <see cref="BasePlayer.RecoverFromWounded"/>: block residual fall hits + re-clear bleed/poison/radiation ticks (RustChaos revivechaos pattern).</summary>
        private readonly Dictionary<ulong, float> _bridgeMedicReviveStabilizeUntil = new();

        private const float BridgeMedicReviveStabilizeSeconds = 12f;

        #region Configuration
        public class Configuration
        {
            [JsonProperty(RU ? "Настройка ботов" : "Bots settings", Order = 10)]
            public Dictionary<string, BotSetup> bots = new();

            /// <summary>One-time migration: rocky-terrain controller hints on streamer_patrol / streamer_medic.</summary>
            [JsonProperty("RustMaxx streamer rocky bridge nav applied", Order = 5)]
            public bool StreamerRockyTerrainBridgeApplied { get; set; }

            /// <summary>One-time migration: streamer_medic Friendly → Defensive for anchor escort behavior.</summary>
            [JsonProperty("RustMaxx streamer medic escort personality applied", Order = 6)]
            public bool StreamerMedicEscortPersonalityApplied { get; set; }

            [JsonProperty(RU ? "Укажите для генератора ID ботов (от 8 - 15)" : "Specify the ID of the bot generator (8 - 15)")]
            private int digits = 9;

            public int GetDigits() => Mathf.Clamp(digits, 8, 15);
            public BotSetup GetSetup(string nameSetup)
            {
                if (string.IsNullOrEmpty(nameSetup)) return null;
                if (bots.TryGetValue(nameSetup, out BotSetup setup)) return setup;
                return null;
            }

            public static Configuration GetDefault()
            {
                return new()
                {
                    bots = new()
                    {
                        ["bob_resources_farmer"] = new(100000000, 300f, 50f)
                        {
                            Enable = true,
                            Name = "Bob",
                            Corpse = DeadCorpse.PlayerCorpse,
                            Personality = PersonalityBot.Friendly,
                            MaxHealth = 100f,
                            deathItemsBlacklist = new List<ItemSetup>()
                            {
                                new ItemSetup("knife.skinning", 0)  
                            },
                            Controller = new(0.1f, 0.5f)
                            {
                                RadiusFindEntity = 30f,
                                RateDamageWater = 1f,
                                AccuracyOfFire = 5,
                                ScaleDamageToNPC = 2f,
                                ScaleDamageToAnimal = 2f,
                                ScaleDamageToPlayers = 0.8f,
                                ScaleDamageFromNPC = 0.2f,
                                ScaleDamageFromAnimal = 0.2f,
                                ScaleDamageFromPlayers = 0.8f
                            },
                            ResearcherState = new SetupResearcher()
                            {
                                BlockListPrefabsMonuments = new List<string>()
                                {
                                    "assets/bundled/prefabs/autospawn/monument/lighthouse/lighthouse.prefab"
                                }
                            },
                            Wear = new()
                            {
                                CanLock = true,
                                items = new()
                                {
                                    new("hazmatsuit.lumberjack", 0),
                                }
                            },
                            MinerState = new()
                            {
                                CanMiningWood = true,
                                CanFuelUseFromChainsaw = false,
                                CanMiningOre = true,
                                CanMiningBarrel = false,
                                CanMiningRoadSign = false,
                                CanPickupCollectibleItems = true,
                                CanLootedContainer = false,
                                CanPickupDroppedItems = false,
                                CanLootedCorpse = false,
                                CanButcherCorpse = false,
                                PrefabsCorpseToButcher = new()
                                {
                                    "assets/rust.ai/agents/boar/boar.corpse.prefab",
                                    "polarbear.corpse",
                                    "bear.corpse",
                                    "stag.corpse",
                                    "wolf.corpse",
                                    "crocodile.corpse",
                                    "panther.corpse",
                                    "tiger.corpse",
                                    "chicken.corpse"
                                },
                                BlockListPrefabMining = new()
                                {
                                    "assets/bundled/prefabs/autospawn/resource/vine_swinging/vineswingingtree03.prefab",
                                    "assets/bundled/prefabs/autospawn/resource/vine_swinging/vineswingingtreeprefab.prefab",
                                    "assets/bundled/prefabs/autospawn/resource/vine_swinging/vineswingingtree02.prefab"
                                },
                            },
                            HunterState = new()
                            {
                                CanHunt = false,
                                PriorityMelee = true,
                                _radiusWeaponAttacked = 30f,
                                _radiusMeleeAttacked = 2f,
                            },
                            BattleState = new()
                            {
                                _radiusWeaponAttacked = 30f,
                                _radiusMeleeAttacked = 1f,
                            },
                            FullState = new()
                            {
                                Stash = new(true, true, 10, 3600f),
                                Box = new(true, true, 0, 5, 3600f),
                            },

                            ItemsMiningOre = new()
                            {
                                Items = new()
                                {
                                    new(false, false, new("jackhammer", 0)),
                                    new(false, false, new("lumberjack.pickaxe", 0)),
                                    new(false, false, new("diverpickaxe", 0)),
                                    new(true, true, new("pickaxe", 0)),
                                    new(false, false, new("stone.pickaxe", 0)),
                                    new(false, false, new("rock", 0)),
                                },
                            },
                            ItemsMiningTree = new()
                            {
                                Items = new()
                                {
                                    new(false, false, new("chainsaw", 0)),
                                    new(false, false, new("lumberjack.hatchet", 0)),
                                    new(false, false, new("frontier_hatchet", 0)),
                                    new(true, true, new("hatchet", 0)),
                                    new(false, false, new("stonehatchet", 0)),
                                    new(false, false, new("rock", 0)),
                                }

                            },
                            ItemsWeapon = new()
                            {
                                CanUseAmmo = false,
                                AmountAmmo = 128,
                                Items = new()
                                {
                                    new(true, true, new("bow.hunting", 0)),
                                    new(false, false, new("1965232394", 0)),
                                    new(false, false, new("salvaged.cleaver", 0)),
                                }

                            },
                            ItemsMedical = new()
                            {
                                Items = new()
                                {
                                    new(false, true, 5, new("syringe.medical", 0)),
                                    new(true, false, 1, new("bandage", 0)),
                                }

                            },
                            ItemsButcher = new()
                            {
                                Items = new()
                                {
                                    new(true, false, new("knife.skinning", 0)),
                                }

                            },

                            Phrases = new()
                            {
                                MinerPhrases = new()
                                {
                                    PhrasesPickupCollectable = new(30f,
                                        "uinston2/miner/pickup_collectable/1"
                                    ),
                                    PhrasesPickupItem = new(30f,
                                        "uinston2/miner/pickup_collectable/1"
                                    ),
                                    PhrasesLooting = new(30f,
                                        "uinston2/miner/looting/1"
                                    ),
                                    PhrasesBreaking = new(30f,
                                        "uinston2/miner/breaking/1"
                                    ),
                                    PhrasesMiningOre = new(30f,
                                        "uinston2/miner/mining_ore/1"
                                    ),
                                    PhrasesMiningTree = new(30f,
                                        "uinston2/miner/mining_tree/1"
                                    ),
                                    PhrasesLootingCorpse = new(30f,
                                        "uinston2/miner/looting/1"
                                    ),
                                    PhrasesButcherCorpse = new(30f,
                                        "uinston2/miner/butcher_corpse/1"
                                    ),
                                },
                                HunterPhrases = new()
                                {
                                    PhrasesStartAttack = new(30f,
                                        "uinston2/hunter/start_attack/1",
                                        "uinston2/hunter/start_attack/2"
                                    ),
                                },
                                AttackerPhrases = new()
                                {
                                    PhrasesStartAttack = new(30f,
                                        "uinston2/attacker/start_attack/1"
                                    ),
                                    PhrasesRunAway = new(30f,
                                        "uinston2/attacker/run_away/1",
                                        "uinston2/attacker/run_away/2",
                                        "uinston2/attacker/run_away/3"
                                    ),
                                    PhrasesNotVisibleTarget = new(30f,
                                        "uinston2/attacker/not_visible/1",
                                        "uinston2/attacker/not_visible/2",
                                        "uinston2/attacker/not_visible/3"
                                    ),
                                },
                                ResearcherPhrases = new()
                                {
                                    PhrasesBeforeMove = new(30f,
                                        "uinston2/researcher/before_move/1"
                                    ),
                                    PhrasesAfterMove = new(30f,
                                        "uinston2/researcher/after_move/1"
                                    ),
                                },
                                FullState = new(30f,
                                    "uinston2/full_state/1",
                                    "uinston2/full_state/2"
                                ),
                                MedicalState = new(30f,
                                    "uinston2/medical_state/1",
                                    "uinston2/medical_state/2",
                                    "uinston2/medical_state/3"
                                ),
                            }
                        },
                        ["john_looter"] = new(0, 300f, 50f)
                        {
                            Enable = true,
                            Name = "John",
                            Corpse = DeadCorpse.PlayerCorpse,
                            Personality = PersonalityBot.Defensive,
                            deathItemsBlacklist = new List<ItemSetup>()
                            {
                                new ItemSetup("rifle.ak.diver", 0),
                                new ItemSetup("knife.skinning", 0)  
                            },
                            MaxHealth = 120f,
                            Controller = new(0.1f, 0.5f)
                            {
                                RadiusFindEntity = 30f,
                                RateDamageWater = 1f,
                                AccuracyOfFire = 5,
                                ScaleDamageToNPC = 2f,
                                ScaleDamageToAnimal = 2f,
                                ScaleDamageToPlayers = 0.8f,
                                ScaleDamageFromNPC = 0.2f,
                                ScaleDamageFromAnimal = 0.2f,
                                ScaleDamageFromPlayers = 0.8f
                            },
                            ResearcherState = new SetupResearcher()
                            {
                                BlockListPrefabsMonuments = new List<string>()
                                {
                                    "assets/bundled/prefabs/autospawn/monument/lighthouse/lighthouse.prefab"   
                                }
                            },
                            Wear = new()
                            {
                                CanLock = true,
                                items = new()
                                {
                                    new("hazmatsuit.nomadsuit", 0),
                                }
                            },
                            MinerState = new()
                            {
                                CanMiningWood = false,
                                CanFuelUseFromChainsaw = false,
                                CanMiningOre = false,
                                CanMiningBarrel = true,
                                CanMiningRoadSign = true,
                                CanPickupCollectibleItems = true,
                                CanLootedContainer = true,
                                CanPickupDroppedItems = true,
                                CanLootedCorpse = true,
                                CanButcherCorpse = false,
                                PrefabsCorpseToButcher = new()
                                {
                                    "assets/rust.ai/agents/boar/boar.corpse.prefab",
                                    "polarbear.corpse",
                                    "bear.corpse",
                                    "stag.corpse",
                                    "wolf.corpse",
                                    "crocodile.corpse",
                                    "panther.corpse",
                                    "tiger.corpse",
                                    "chicken.corpse"
                                },
                                BlockListPrefabMining = new()
                                {
                                    "assets/bundled/prefabs/autospawn/resource/vine_swinging/vineswingingtree03.prefab",
                                    "assets/bundled/prefabs/autospawn/resource/vine_swinging/vineswingingtreeprefab.prefab",
                                    "assets/bundled/prefabs/autospawn/resource/vine_swinging/vineswingingtree02.prefab"
                                },
                            },
                            HunterState = new()
                            {
                                CanHunt = false,
                                PriorityMelee = true,
                                _radiusWeaponAttacked = 30f,
                                _radiusMeleeAttacked = 2f,
                            },
                            BattleState = new()
                            {
                                _radiusWeaponAttacked = 30f,
                                _radiusMeleeAttacked = 1f,
                            },
                            FullState = new()
                            {
                                Stash = new(true, true, 10, 3600f),
                                Box = new(true, true, 0, 5, 3600f),
                            },

                            ItemsMiningOre = new()
                            {
                                Items = new()
                                {
                                    new(false, false, new("jackhammer", 0)),
                                    new(false, false, new("lumberjack.pickaxe", 0)),
                                    new(false, false, new("diverpickaxe", 0)),
                                    new(true, true, new("pickaxe", 0)),
                                    new(false, false, new("stone.pickaxe", 0)),
                                    new(false, false, new("rock", 0)),
                                },
                            },
                            ItemsMiningTree = new()
                            {
                                Items = new()
                                {
                                    new(false, false, new("chainsaw", 0)),
                                    new(false, false, new("lumberjack.hatchet", 0)),
                                    new(false, false, new("frontier_hatchet", 0)),
                                    new(true, true, new("hatchet", 0)),
                                    new(false, false, new("stonehatchet", 0)),
                                    new(false, false, new("rock", 0)),
                                }

                            },
                            ItemsWeapon = new()
                            {
                                CanUseAmmo = true,
                                AmountAmmo = 300,
                                Items = new()
                                {
                                    new(false, true, new("rifle.ak.diver", 0)),
                                    new(true, true, new("bow.hunting", 0)),
                                    new(true, false, new("1965232394", 0)),
                                    new(true, false, new("salvaged.cleaver", 0)),
                                }

                            },
                            ItemsMedical = new()
                            {
                                Items = new()
                                {
                                    new(false, true, 5, new("syringe.medical", 0)),
                                    new(true, false, 1, new("bandage", 0)),
                                }

                            },
                            ItemsButcher = new()
                            {
                                Items = new()
                                {
                                    new(true, false, new("knife.skinning", 0)),
                                }

                            },

                            Phrases = new()
                            {
                                MinerPhrases = new()
                                {
                                    PhrasesPickupCollectable = new(30f,
                                        "uinston2/miner/pickup_collectable/1"
                                    ),
                                    PhrasesPickupItem = new(30f,
                                        "uinston2/miner/pickup_collectable/1"
                                    ),
                                    PhrasesLooting = new(30f,
                                        "uinston2/miner/looting/1"
                                    ),
                                    PhrasesBreaking = new(30f,
                                        "uinston2/miner/breaking/1"
                                    ),
                                    PhrasesMiningOre = new(30f,
                                        "uinston2/miner/mining_ore/1"
                                    ),
                                    PhrasesMiningTree = new(30f,
                                        "uinston2/miner/mining_tree/1"
                                    ),
                                    PhrasesLootingCorpse = new(30f,
                                        "uinston2/miner/looting/1"
                                    ),
                                    PhrasesButcherCorpse = new(30f,
                                        "uinston2/miner/butcher_corpse/1"
                                    ),
                                },
                                HunterPhrases = new()
                                {
                                    PhrasesStartAttack = new(30f,
                                        "uinston2/hunter/start_attack/1",
                                        "uinston2/hunter/start_attack/2"
                                    ),
                                },
                                AttackerPhrases = new()
                                {
                                    PhrasesStartAttack = new(30f,
                                        "uinston2/attacker/start_attack/1"
                                    ),
                                    PhrasesRunAway = new(30f,
                                        "uinston2/attacker/run_away/1",
                                        "uinston2/attacker/run_away/2",
                                        "uinston2/attacker/run_away/3"
                                    ),
                                    PhrasesNotVisibleTarget = new(30f,
                                        "uinston2/attacker/not_visible/1",
                                        "uinston2/attacker/not_visible/2",
                                        "uinston2/attacker/not_visible/3"
                                    ),
                                },
                                ResearcherPhrases = new()
                                {
                                    PhrasesBeforeMove = new(30f,
                                        "uinston2/researcher/before_move/1"
                                    ),
                                    PhrasesAfterMove = new(30f,
                                        "uinston2/researcher/after_move/1"
                                    ),
                                },
                                FullState = new(30f,
                                    "uinston2/full_state/1",
                                    "uinston2/full_state/2"
                                ),
                                MedicalState = new(30f,
                                    "uinston2/medical_state/1",
                                    "uinston2/medical_state/2",
                                    "uinston2/medical_state/3"
                                ),
                            }
                        },
                        ["alfred_hunter"] = new(0, 300f, 50f)
                        {
                            Enable = true,
                            Name = "Alfred",
                            Corpse = DeadCorpse.PlayerCorpse,
                            Personality = PersonalityBot.Defensive,
                            deathItemsBlacklist = new List<ItemSetup>()
                            {
                                new ItemSetup("shotgun.spas12", 0),
                                new ItemSetup("knife.skinning", 0)  
                            },
                            MaxHealth = 100f,
                            Controller = new(0.1f, 0.5f)
                            {
                                RadiusFindEntity = 30f,
                                RateDamageWater = 1f,
                                AccuracyOfFire = 5,
                                ScaleDamageToNPC = 2f,
                                ScaleDamageToAnimal = 2f,
                                ScaleDamageToPlayers = 0.8f,
                                ScaleDamageFromNPC = 0.2f,
                                ScaleDamageFromAnimal = 0.2f,
                                ScaleDamageFromPlayers = 0.8f
                            },
                            ResearcherState = new SetupResearcher()
                            {
                                BlockListPrefabsMonuments = new List<string>()
                                {
                                    "assets/bundled/prefabs/autospawn/monument/lighthouse/lighthouse.prefab"   
                                }
                            },
                            Wear = new()
                            {
                                CanLock = true,
                                items = new()
                                {
                                    new("hazmatsuit.frontier", 0),
                                }
                            },
                            MinerState = new()
                            {
                                CanMiningWood = false,
                                CanFuelUseFromChainsaw = false,
                                CanMiningOre = false,
                                CanMiningBarrel = false,
                                CanMiningRoadSign = false,
                                CanPickupCollectibleItems = false,
                                CanLootedContainer = false,
                                CanPickupDroppedItems = true,
                                CanLootedCorpse = false,
                                CanButcherCorpse = true,
                                PrefabsCorpseToButcher = new()
                                {
                                    "assets/rust.ai/agents/boar/boar.corpse.prefab",
                                    "polarbear.corpse",
                                    "bear.corpse",
                                    "stag.corpse",
                                    "wolf.corpse",
                                    "crocodile.corpse",
                                    "panther.corpse",
                                    "tiger.corpse",
                                    "chicken.corpse"
                                },
                                BlockListPrefabMining = new()
                                {
                                    "assets/bundled/prefabs/autospawn/resource/vine_swinging/vineswingingtree03.prefab",
                                    "assets/bundled/prefabs/autospawn/resource/vine_swinging/vineswingingtreeprefab.prefab",
                                    "assets/bundled/prefabs/autospawn/resource/vine_swinging/vineswingingtree02.prefab"
                                },
                            },
                            HunterState = new()
                            {
                                CanHunt = true,
                                PriorityMelee = false,
                                _radiusWeaponAttacked = 25f,
                                _radiusMeleeAttacked = 2f,
                            },
                            BattleState = new()
                            {
                                _radiusWeaponAttacked = 30f,
                                _radiusMeleeAttacked = 1f,
                            },
                            FullState = new()
                            {
                                Stash = new(true, true, 10, 3600f),
                                Box = new(true, true, 0, 5, 3600f),
                            },

                            ItemsMiningOre = new()
                            {
                                Items = new()
                                {
                                    new(false, false, new("jackhammer", 0)),
                                    new(false, false, new("lumberjack.pickaxe", 0)),
                                    new(false, false, new("diverpickaxe", 0)),
                                    new(true, true, new("pickaxe", 0)),
                                    new(false, false, new("stone.pickaxe", 0)),
                                    new(false, false, new("rock", 0)),
                                },
                            },
                            ItemsMiningTree = new()
                            {
                                Items = new()
                                {
                                    new(false, false, new("chainsaw", 0)),
                                    new(false, false, new("lumberjack.hatchet", 0)),
                                    new(false, false, new("frontier_hatchet", 0)),
                                    new(true, true, new("hatchet", 0)),
                                    new(false, false, new("stonehatchet", 0)),
                                    new(false, false, new("rock", 0)),
                                }

                            },
                            ItemsWeapon = new()
                            {
                                CanUseAmmo = false,
                                AmountAmmo = 300,
                                Items = new()
                                {
                                    new(false, true, new("shotgun.spas12", 0)),
                                    new(true, false, new("bow.hunting", 0)),
                                    new(true, false, new("1965232394", 0)),
                                    new(true, false, new("salvaged.cleaver", 0)),
                                }

                            },
                            ItemsMedical = new()
                            {
                                Items = new()
                                {
                                    new(false, true, 5, new("syringe.medical", 0)),
                                    new(true, false, 1, new("bandage", 0)),
                                }

                            },
                            ItemsButcher = new()
                            {
                                Items = new()
                                {
                                    new(true, false, new("knife.skinning", 0)),
                                }

                            },

                            Phrases = new()
                            {
                                MinerPhrases = new()
                                {
                                    PhrasesPickupCollectable = new(30f,
                                        "uinston2/miner/pickup_collectable/1"
                                    ),
                                    PhrasesPickupItem = new(30f,
                                        "uinston2/miner/pickup_collectable/1"
                                    ),
                                    PhrasesLooting = new(30f,
                                        "uinston2/miner/looting/1"
                                    ),
                                    PhrasesBreaking = new(30f,
                                        "uinston2/miner/breaking/1"
                                    ),
                                    PhrasesMiningOre = new(30f,
                                        "uinston2/miner/mining_ore/1"
                                    ),
                                    PhrasesMiningTree = new(30f,
                                        "uinston2/miner/mining_tree/1"
                                    ),
                                    PhrasesLootingCorpse = new(30f,
                                        "uinston2/miner/looting/1"
                                    ),
                                    PhrasesButcherCorpse = new(30f,
                                        "uinston2/miner/butcher_corpse/1"
                                    ),
                                },
                                HunterPhrases = new()
                                {
                                    PhrasesStartAttack = new(30f,
                                        "uinston2/hunter/start_attack/1",
                                        "uinston2/hunter/start_attack/2"
                                    ),
                                },
                                AttackerPhrases = new()
                                {
                                    PhrasesStartAttack = new(30f,
                                        "uinston2/attacker/start_attack/1"
                                    ),
                                    PhrasesRunAway = new(30f,
                                        "uinston2/attacker/run_away/1",
                                        "uinston2/attacker/run_away/2",
                                        "uinston2/attacker/run_away/3"
                                    ),
                                    PhrasesNotVisibleTarget = new(30f,
                                        "uinston2/attacker/not_visible/1",
                                        "uinston2/attacker/not_visible/2",
                                        "uinston2/attacker/not_visible/3"
                                    ),
                                },
                                ResearcherPhrases = new()
                                {
                                    PhrasesBeforeMove = new(30f,
                                        "uinston2/researcher/before_move/1"
                                    ),
                                    PhrasesAfterMove = new(30f,
                                        "uinston2/researcher/after_move/1"
                                    ),
                                },
                                FullState = new(30f,
                                    "uinston2/full_state/1",
                                    "uinston2/full_state/2"
                                ),
                                MedicalState = new(30f,
                                    "uinston2/medical_state/1",
                                    "uinston2/medical_state/2",
                                    "uinston2/medical_state/3"
                                ),
                            }
                        },
                        ["austin_fighter"] = new(0, 300f, 0f)
                        {
                            Enable = true,
                            Name = "Austin",
                            Corpse = DeadCorpse.PlayerCorpse,
                            Personality = PersonalityBot.Aggressive,
                            deathItemsBlacklist = new List<ItemSetup>()
                            {
                                new ItemSetup("krieg.shotgun", 0),
                                new ItemSetup("krieg.chainsword", 0),
                                new ItemSetup("knife.skinning", 0)  
                            },
                            MaxHealth = 120f,
                            Controller = new(0.1f, 0.5f)
                            {
                                RadiusFindEntity = 30f,
                                RateDamageWater = 0f,
                                AccuracyOfFire = 3,
                                ScaleDamageToNPC = 2f,
                                ScaleDamageToAnimal = 2f,
                                ScaleDamageToPlayers = 0.8f,
                                ScaleDamageFromNPC = 0.2f,
                                ScaleDamageFromAnimal = 0.2f,
                                ScaleDamageFromPlayers = 0.8f
                            },
                            ResearcherState = new SetupResearcher()
                            {
                                BlockListPrefabsMonuments = new List<string>()
                                {
                                    "assets/bundled/prefabs/autospawn/monument/lighthouse/lighthouse.prefab"   
                                }
                            },
                            Wear = new()
                            {
                                CanLock = true,
                                items = new()
                                {
                                    new("hazmat.krieg", 0),
                                }
                            },
                            MinerState = new()
                            {
                                CanMiningWood = false,
                                CanFuelUseFromChainsaw = false,
                                CanMiningOre = false,
                                CanMiningBarrel = true,
                                CanMiningRoadSign = false,
                                CanPickupCollectibleItems = false,
                                CanLootedContainer = true,
                                CanPickupDroppedItems = true,
                                CanLootedCorpse = true,
                                CanButcherCorpse = false,
                                PrefabsCorpseToButcher = new()
                                {
                                    "assets/rust.ai/agents/boar/boar.corpse.prefab",
                                    "polarbear.corpse",
                                    "bear.corpse",
                                    "stag.corpse",
                                    "wolf.corpse",
                                    "crocodile.corpse",
                                    "panther.corpse",
                                    "tiger.corpse",
                                    "chicken.corpse"
                                },
                                BlockListPrefabMining = new()
                                {
                                    "assets/bundled/prefabs/autospawn/resource/vine_swinging/vineswingingtree03.prefab",
                                    "assets/bundled/prefabs/autospawn/resource/vine_swinging/vineswingingtreeprefab.prefab",
                                    "assets/bundled/prefabs/autospawn/resource/vine_swinging/vineswingingtree02.prefab"
                                },
                            },
                            HunterState = new()
                            {
                                CanHunt = false,
                                PriorityMelee = false,
                                _radiusWeaponAttacked = 30f,
                                _radiusMeleeAttacked = 2f,
                            },
                            BattleState = new()
                            {
                                _radiusWeaponAttacked = 30f,
                                _radiusMeleeAttacked = 1f,
                            },
                            FullState = new()
                            {
                                Stash = new(true, true, 10, 3600f),
                                Box = new(true, true, 0, 5, 3600f),
                            },

                            ItemsMiningOre = new()
                            {
                                Items = new()
                                {
                                    new(false, false, new("jackhammer", 0)),
                                    new(false, false, new("lumberjack.pickaxe", 0)),
                                    new(false, false, new("diverpickaxe", 0)),
                                    new(true, true, new("pickaxe", 0)),
                                    new(false, false, new("stone.pickaxe", 0)),
                                    new(false, false, new("rock", 0)),
                                },
                            },
                            ItemsMiningTree = new()
                            {
                                Items = new()
                                {
                                    new(false, false, new("chainsaw", 0)),
                                    new(false, false, new("lumberjack.hatchet", 0)),
                                    new(false, false, new("frontier_hatchet", 0)),
                                    new(true, true, new("hatchet", 0)),
                                    new(false, false, new("stonehatchet", 0)),
                                    new(false, false, new("rock", 0)),
                                }

                            },
                            ItemsWeapon = new()
                            {
                                CanUseAmmo = false,
                                AmountAmmo = 300,
                                Items = new()
                                {
                                    new(false, true, new("krieg.shotgun", 0)),
                                    new(true, false, new("krieg.chainsword", 0)),
                                }

                            },
                            ItemsMedical = new()
                            {
                                Items = new()
                                {
                                    new(true, false, 5, new("syringe.medical", 0)),
                                }
                            },
                            ItemsButcher = new()
                            {
                                Items = new()
                                {
                                    new(true, false, new("knife.skinning", 0)),
                                }

                            },

                            Phrases = new()
                            {
                                MinerPhrases = new()
                                {
                                    PhrasesPickupCollectable = new(30f,
                                        "uinston2/miner/pickup_collectable/1"
                                    ),
                                    PhrasesPickupItem = new(30f,
                                        "uinston2/miner/pickup_collectable/1"
                                    ),
                                    PhrasesLooting = new(30f,
                                        "uinston2/miner/looting/1"
                                    ),
                                    PhrasesBreaking = new(30f,
                                        "uinston2/miner/breaking/1"
                                    ),
                                    PhrasesMiningOre = new(30f,
                                        "uinston2/miner/mining_ore/1"
                                    ),
                                    PhrasesMiningTree = new(30f,
                                        "uinston2/miner/mining_tree/1"
                                    ),
                                    PhrasesLootingCorpse = new(30f,
                                        "uinston2/miner/looting/1"
                                    ),
                                    PhrasesButcherCorpse = new(30f,
                                        "uinston2/miner/butcher_corpse/1"
                                    ),
                                },
                                HunterPhrases = new()
                                {
                                    PhrasesStartAttack = new(30f,
                                        "uinston2/hunter/start_attack/1",
                                        "uinston2/hunter/start_attack/2"
                                    ),
                                },
                                AttackerPhrases = new()
                                {
                                    PhrasesStartAttack = new(30f,
                                        "uinston2/attacker/start_attack/1"
                                    ),
                                    PhrasesRunAway = new(30f,
                                        "uinston2/attacker/run_away/1",
                                        "uinston2/attacker/run_away/2",
                                        "uinston2/attacker/run_away/3"
                                    ),
                                    PhrasesNotVisibleTarget = new(30f,
                                        "uinston2/attacker/not_visible/1",
                                        "uinston2/attacker/not_visible/2",
                                        "uinston2/attacker/not_visible/3"
                                    ),
                                },
                                ResearcherPhrases = new()
                                {
                                    PhrasesBeforeMove = new(30f,
                                        "uinston2/researcher/before_move/1"
                                    ),
                                    PhrasesAfterMove = new(30f,
                                        "uinston2/researcher/after_move/1"
                                    ),
                                },
                                FullState = new(30f,
                                    "uinston2/full_state/1",
                                    "uinston2/full_state/2"
                                ),
                                MedicalState = new(30f,
                                    "uinston2/medical_state/1",
                                    "uinston2/medical_state/2",
                                    "uinston2/medical_state/3"
                                ),
                            }
                        },


#if DebugLog && DefaultConfig
                        ["Test"] = new(100000004, 3f, 50f)
                        {
                            Enable = false,
                            Name = "Max39ru",
                            Corpse = DeadCorpse.Backpack,
                            Personality = PersonalityBot.Defensive,
                            CanRandomPointRespawn = true,
                            MaxHealth = 150f,
                            Controller = new(0.1f, 1f, 0f)
                            {
                                RadiusFindEntity = 30f,
                                RateDamageWater = 0f,
                                AccuracyOfFire = 5,
                                ScaleDamageToNPC = 3f,
                                ScaleDamageToAnimal = 2f,
                                ScaleDamageToPlayers = 1f,
                                ScaleDamageFromNPC = 0.1f,
                                ScaleDamageFromAnimal = 0.1f,
                                ScaleDamageFromPlayers = 0.05f
                            },
                            Wear = new()
                            {
                                CanLock = true,
                                items = new()
                                {
                                    new("hazmatsuit.lumberjack", 0),
                                }
                            },
                            MinerState = new()
                            {
                                CanMiningWood = false,
                                CanFuelUseFromChainsaw = false,
                                CanMiningOre = true,
                                CanMiningBarrel = true,
                                CanMiningRoadSign = false,
                                CanPickupCollectibleItems = true,
                                CanLootedContainer = true,
                                CanPickupDroppedItems = true,
                                CanLootedCorpse = true,
                                CanButcherCorpse = true,
                                PrefabsCorpseToButcher = new()
                                {
                                    "assets/rust.ai/agents/boar/boar.corpse.prefab",
                                    "polarbear.corpse",
                                    "bear.corpse",
                                    "stag.corpse",
                                    "wolf.corpse",
                                    "crocodile.corpse",
                                    "panther.corpse",
                                    "tiger.corpse",
                                    "chicken.corpse"
                                },
                                BlockListPrefabMining = new()
                                {
                                    "assets/bundled/prefabs/autospawn/resource/vine_swinging/vineswingingtree03.prefab",
                                    "assets/bundled/prefabs/autospawn/resource/vine_swinging/vineswingingtreeprefab.prefab",
                                    "assets/bundled/prefabs/autospawn/resource/vine_swinging/vineswingingtree02.prefab"
                                },
                            },
                            HunterState = new()
                            {
                                PriorityMelee = false,
                                RadiusWeaponAttacked = 30f,
                                RadiusMeleeAttacked = 2f,
                            },
                            BattleState = new()
                            {
                                RadiusWeaponAttacked = 30f,
                                RadiusMeleeAttacked = 1f,
                            },
                            FullState = new()
                            {
                                Stash = new(true, true, 10, 3600f),
                                Box = new(true, true, 0, 5, 3600f),
                            },

                            ItemsMiningOre = new()
                            {
                                Items = new()
                                {
                                    new(false, false, new("jackhammer", 0)),
                                    new(false, false, new("lumberjack.pickaxe", 0)),
                                    new(false, false, new("diverpickaxe", 0)),
                                    new(true, true, new("pickaxe", 0)),
                                    new(false, false, new("stone.pickaxe", 0)),
                                    new(false, true, new("rock", 0)),
                                },
                            },
                            ItemsMiningTree = new()
                            {
                                Items = new()
                                {
                                    new(false, false, new("chainsaw", 0)),
                                    new(false, false, new("lumberjack.hatchet", 0)),
                                    new(false, false, new("frontier_hatchet", 0)),
                                    new(true, true, new("hatchet", 0)),
                                    new(false, false, new("stonehatchet", 0)),
                                    new(false, true, new("rock", 0)),
                                }

                            },
                            ItemsWeapon = new()
                            {
                                CanUseAmmo = false,
                                AmountAmmo = 300,
                                Items = new()
                                {
                                    // new(false, true, new("shotgun.spas12", 0)),
                                    // new(true, false, new("bow.hunting", 0)),
                                    new(true, false, new("minicrossbow", 0)),
                                    // new(true, false, new("bow.compound", 0)),
                                    // new(true, false, new("1965232394", 0)),
                                    new(true, false, new("salvaged.cleaver", 0)),
                                }

                            },
                            ItemsMedical = new()
                            {
                                Items = new()
                                {
                                    new(false, true, 5, new("syringe.medical", 0)),
                                    new(true, false, 1, new("bandage", 0)),
                                }

                            },
                            ItemsButcher = new()
                            {
                                Items = new()
                                {
                                    new(true, false, new("knife.skinning", 0)),
                                }

                            },

                            Phrases = new()
                            {
                                MinerPhrases = new()
                                {
                                    PhrasesPickupCollectable = new(70f,
                                        "uinston2/miner/pickup_collectable/1"
                                    ),
                                    PhrasesPickupItem = new(70f,
                                        "uinston2/miner/pickup_collectable/1"
                                    ),
                                    PhrasesLooting = new(70f,
                                        "uinston2/miner/looting/1"
                                    ),
                                    PhrasesBreaking = new(70f,
                                        "uinston2/miner/breaking/1"
                                    ),
                                    PhrasesMiningOre = new(30f,
                                        "uinston2/miner/mining_ore/1"
                                    ),
                                    PhrasesMiningTree = new(70f,
                                        "uinston2/miner/mining_tree/1"
                                    ),
                                    PhrasesLootingCorpse = new(70f,
                                        "uinston2/miner/looting/1"
                                    ),
                                    PhrasesButcherCorpse = new(70f,
                                        "uinston2/miner/butcher_corpse/1"
                                    ),
                                },
                                HunterPhrases = new()
                                {
                                    PhrasesStartAttack = new(70f,
                                        "uinston2/hunter/start_attack/1",
                                        "uinston2/hunter/start_attack/2"
                                    ),
                                },
                                AttackerPhrases = new()
                                {
                                    PhrasesStartAttack = new(70f,
                                        "uinston2/attacker/start_attack/1"
                                    ),
                                    PhrasesRunAway = new(70f,
                                        "uinston2/attacker/run_away/1",
                                        "uinston2/attacker/run_away/2",
                                        "uinston2/attacker/run_away/3"
                                    ),
                                    PhrasesNotVisibleTarget = new(70f,
                                        "uinston2/attacker/not_visible/1",
                                        "uinston2/attacker/not_visible/2",
                                        "uinston2/attacker/not_visible/3"
                                    ),
                                },
                                ResearcherPhrases = new()
                                {
                                    PhrasesBeforeMove = new(70f,
                                        "uinston2/researcher/before_move/1"
                                    ),
                                    PhrasesAfterMove = new(70f,
                                        "uinston2/researcher/after_move/1"
                                    ),
                                },
                                FullState = new(70f,
                                    "uinston2/full_state/1",
                                    "uinston2/full_state/2"
                                ),
                                MedicalState = new(70f,
                                    "uinston2/medical_state/1",
                                    "uinston2/medical_state/2",
                                    "uinston2/medical_state/3"
                                ),
                            }
                        },
#endif
                    }
                };
            }

        }
        public class BotSetup
        {
            [JsonProperty(RU ? "Активировать бота?" : "Enable bot?")]
            public bool Enable = true;

            [JsonProperty(RU ? "Какое количество этих ботов может быть заспавнено?" : "How many of these bots can be spawned?")]
            public int Amount = 1;

            [JsonProperty(RU ? "Внешность бота (работает если кол-во ботов 1, используйте id в диапазоне указанного количества знаков для генератора ID или оставьте 0, для случайной внешности)" : "Bot appearance (used if bot's amount - 1, use the id in the range of the specified number of digits for the bot ID generator or leave 0 for random appearance)")]
            private ulong id = 0;

            [JsonProperty(RU ? "Имя бота (оставьте пустым для случайного выбора)" : "Bot name (leave empty for random)")]
            public string Name = "Dennis";

            [JsonProperty(RU ? "Использовать свои рандомные имена из дата файла? (/data/RoamingNPCs/RandomNicknames, или рандомные имена из Rust будут использованы)" : "Use random names from data file? (/data/RoamingNPCs/RandomNicknames, or Rust's random names will be used)")]
            public bool UseRandomNamesData = false;

            [JsonProperty(RU ? "Разрешить нахождение в состоянии ранения?" : "Allow wounded state?")]
            public bool allowWounded = true;

            [JsonProperty(RU ? "Таймер возрождения (мин. 3 сек)" : "Respawn timer (min 3 seconds)")]
            private float timerRespawn = 3f;

            [JsonProperty(RU ? "Включить периодическую реинициализацию бота? (может улучшить производительность)" : "Enable periodic bot reinitialization? (can improve performance)")]
            public bool EnablePeriodicRespawn = false;

            [JsonProperty(RU ? "Какой режим возрождения использовать? (RandomPoint, RoadPoint, SpawnPoint, SpawnsDatabase)" : "What respawn mode to use? (RandomPoint, RoadPoint, SpawnPoint, SpawnsDatabase)")]
            public SpawnMode spawnMode = 0;

            [JsonProperty(RU ? "Какие дороги использовать для спавна? (DefaultRoads, MainRoads, SideRoads, TrailRoads, Rails)" : "What roads use to spawn? (DefaultRoads, MainRoads, SideRoads, TrailRoads, Rails)")]
            public RoadSpawnMode roadSpawnMode = 0;

            [JsonProperty(RU ? "Название файла с точками спавна (для респавна через SpawnsDatabase)" : "Spawn points filename (for SpawnsDatabase respawn mode)")]
            public string spawnsDatabaseFileName = "";

            [JsonProperty(RU ? "Максимальное здоровье" : "Maximum health")]
            public float MaxHealth = 150f;

            [JsonProperty(RU ? "Что появляется на месте смерти (PlayerCorpse, NpcCorpse, Backpack)" : "What spawns on death (PlayerCorpse, NpcCorpse, Backpack)")]
            public DeadCorpse Corpse = new();

            [JsonProperty(RU ? "Оставлять одежду при смерти на NpcCorpse?" : "Keep clothes on NpcCorpse?")]
            public bool KeepClothesNPCCorpse = true;

            [JsonProperty(RU ? "Процент уничтожения предметов при смерти, если выбран Backpack. (0 - 100%)" : "How many items will be destroyed when Backpack is selected (0 - 100%)")]
            private float destroyPercent = 0f;

            [JsonProperty(RU ? "Список предметов которые не будут выпадать при смерти" : "List of items that won't drop on death")]
            public List<ItemSetup> deathItemsBlacklist = new List<ItemSetup>();

            [JsonProperty(RU ? "Характер бота - агрессивный, мирный или оборонительный? (Aggressive, Friendly, Defensive)" : "Bot behaviour - Aggressive, Friendly, Defensive")]
            public PersonalityBot Personality = PersonalityBot.Friendly;

            [JsonProperty(RU ? "Включить рандомный характер бота?" : "Enable random bot behaviour?")]
            public bool EnableRandomPersonality = false;

            [JsonProperty(RU ? "Настройка контроллера" : "Controller setup")]
            public ControllerSetup Controller = new();

            [JsonProperty(RU ? "Предметы одежды (при возрождении)" : "Wear items (on respawn)")]
            public WearSetup Wear = new();

            [JsonProperty(RU ? "Разрешить скидывать предметы на поясе при смерти?" : "Allow dropping items on belt when dead?")]
            public bool CanDropBeltInventory = false;

            [JsonProperty(RU
                ? "Разрешить игрокам открывать инвентарь живого бота (E), как у спящего — надевать/снимать предметы"
                : "Allow real players to open this bot's inventory while alive (use key), like a sleeping player — move items on/off")]
            public bool AllowPlayerLootInventoryWhileAlive = false;

            [JsonProperty(RU ? "Настройка сбора ресурсов" : "Resource collection")]
            public SetupMining MinerState = new();

            [JsonProperty(RU ? "Настройка боя с НПС и игроками" : "Fights with NPCs and players")]
            public SetupBattle BattleState = new();

            [JsonProperty(RU
                ? "MaxxInvaders: патруль вокруг стримера (отдельный шаблон, напр. streamer_patrol)"
                : "MaxxInvaders: patrol near streamer anchor (use dedicated bot key e.g. streamer_patrol)")]
            public SetupBridgePatrol BridgePatrol = new();

            [JsonProperty(RU
                ? "MaxxInvaders: поднимать и лечить якорного игрока (шаблон streamer_medic)"
                : "MaxxInvaders: revive & heal anchor player (streamer_medic bot key)")]
            public SetupBridgeMedic BridgeMedic = new();

            [JsonProperty(RU ? "Настройка охоты на животных" : "Animal hunting")]
            public SetupHunting HunterState = new();

            [JsonProperty(RU ? "Настройка переполнение инвентаря" : "Inventory overflow")]
            public SetupFullInventory FullState = new();

            [JsonProperty(RU ? "Настройка посещения рт" : "Monuments visit setup")]
            public SetupResearcher ResearcherState = new();

            [JsonProperty(RU ? "Лут при спавне" : "Loot on spawn")]
            public List<ItemSetup> ItemsOnSpawn = new();

            [JsonProperty(RU ? "Предметы для добычи руды" : "Items for ore mining")]
            public ItemsList<ItemBot> ItemsMiningOre = new();

            [JsonProperty(RU ? "Предметы для добычи дерева" : "Items for tree gathering")]
            public ItemsList<ItemBot> ItemsMiningTree = new();

            [JsonProperty(RU ? "Предметы для боя" : "Items for fights")]
            public ListWeapons ItemsWeapon = new();

            [JsonProperty(RU ? "Предметы для разделки животных" : "Items for harvesting animals")]
            public ItemsList<ItemBot> ItemsButcher = new();

            [JsonProperty(RU ? "Предметы для лечения" : "Items for healing")]
            public ItemsList<AmountItemBot> ItemsMedical = new();

            [JsonProperty(RU ? "Настройка голосовых фраз при различных действиях (вы можете скачать дефолтные фразы со страницы плагина)" : "Voice phrases for different actions (you can download default voice phraes from plugin page)")]
            public SetupPhrase Phrases = new();

            [JsonIgnore] public List<ItemBot> itemsGiveBot = new();
            // [JsonIgnore] public bool LockBelt => true;


            public BotSetup()
            {
            }

            public BotSetup(ulong id, float timerRespawn, float destroyPercent = 0)
            {
                this.id = id;
                this.timerRespawn = timerRespawn;
                this.destroyPercent = destroyPercent;
            }


            public void Init()
            {
                FullState.Init();
                ItemsWeapon.Init();
                ItemsMiningOre.SetGiveItemsToList(itemsGiveBot);
                ItemsMiningTree.SetGiveItemsToList(itemsGiveBot);
                ItemsWeapon.SetGiveItemsToList(itemsGiveBot);
                ItemsButcher.SetGiveItemsToList(itemsGiveBot);
                ItemsMedical.SetGiveItemsToList(itemsGiveBot);
            }

            public bool InDeathBlackList(Item item) => item != null && deathItemsBlacklist?.Exists(x => x.GetItemDefinition() == item.info && x.SkinID == item.skin) == true;
            public int GetAmount() => Mathf.Max(1, Amount);
            public float GetTimerRespawn() => Mathf.Max(3f, timerRespawn);
            public float GetPeriodicRespawnInterval() => 900f;
            public float GetPeriodicRespawnPlayerCheckRadius() => 100f;
            public float DestroyPercent() => Mathf.Clamp(destroyPercent, 0f, 100f) / 100f;
            public ulong GetId()
            {
                if (id == 0) return 0;
                int digits = instance.config.GetDigits();
                if (id.ToString().Length == digits) return id;
                return BotIdGenerator.CheckAndConvert(id.ToString(), digits);
            }

            public IEnumerable<(ItemDefinition, ulong, bool)> GetToolItems(CustomPet.SlotItemTools typeItem, bool revers = false)
            {
                List<ItemBot> items = typeItem switch
                {
                    CustomPet.SlotItemTools.Pickaxe => ItemsMiningOre.GetItemsList(),
                    CustomPet.SlotItemTools.Hatchet => ItemsMiningTree.GetItemsList(),
                    _ => null
                };
                if (items == null)
                {
                    switch (typeItem)
                    {
                        case CustomPet.SlotItemTools.Hummer: yield return (ItemManager.FindItemDefinition(200773292), 0, true); yield break;
                        case CustomPet.SlotItemTools.Planner: yield return (ItemManager.FindItemDefinition(1525520776), 0, true); yield break;
                        default: yield break;
                    }
                }
                for (int i = 0; i < items.Count; i++)
                {
                    int index = revers ? items.Count - i - 1 : i;
                    ItemBot item = items[index];
                    if (item.ItemConfig.GetItemDefinition() != null)
                    {
                        yield return (item.ItemConfig.GetItemDefinition(), item.ItemConfig.SkinID, item.CanCreate);
                    }
                }
            }
            public IEnumerable<(ItemDefinition, ulong, bool, AmmoTypes, ItemBot)> GetWeaponItems(CustomPet.SlotItemWeapons typeItem, bool revers = false)
            {
                bool checkAmmo = typeItem == CustomPet.SlotItemWeapons.Weapon;
                List<ItemBot> items = typeItem switch
                {
                    CustomPet.SlotItemWeapons.Weapon => ItemsWeapon.ItemsProjectile,
                    CustomPet.SlotItemWeapons.Melee => ItemsWeapon.ItemsMelee,
                    CustomPet.SlotItemWeapons.Knife => ItemsButcher.GetItemsList(),
                    _ => null
                };
                if (items == null) yield break;
                for (int i = 0; i < items.Count; i++)
                {
                    int index = revers ? items.Count - i - 1 : i;
                    ItemBot item = items[index];
                    if (item.ItemConfig.GetItemDefinition() != null)
                    {
                        yield return (item.ItemConfig.GetItemDefinition(), item.ItemConfig.SkinID, item.CanCreate, item.AmmoTypes, item);
                    }
                }
            }
            public IEnumerable<(ItemDefinition, ulong, bool, int)> GetMedicalItems(CustomPet.SlotItemUseItems typeItem, bool revers = false)
            {
                List<AmountItemBot> items = typeItem switch
                {
                    CustomPet.SlotItemUseItems.Medical => ItemsMedical.GetItemsList(),
                    _ => null
                };
                if (items == null) yield break;
                for (int i = 0; i < items.Count; i++)
                {
                    int index = revers ? items.Count - i - 1 : i;
                    ItemBot item = items[index];
                    if (item.ItemConfig.GetItemDefinition() != null)
                    {
                        yield return (item.ItemConfig.GetItemDefinition(), item.ItemConfig.SkinID, item.CanCreate, item.Amount);
                    }
                }
            }

            public bool ContainsItem(Item item)
            {
                if (ContainsItem(item, ItemsMiningOre.GetItemsList()) || ContainsItem(item, ItemsMiningTree.GetItemsList()) || ContainsItem(item, ItemsWeapon.GetItemsList()) || ContainsItem(item, ItemsButcher.GetItemsList()) || ContainsItem(item, ItemsMedical.GetItemsList())) return true;
                return false;
            }
            private bool ContainsItem<T>(Item item, List<T> items) where T : ItemBot
            {
                if (items == null || item == null) return false;
                foreach (var _item in items)
                {
                    if (_item.ItemConfig.GetItemDefinition() == null) continue;
                    if (Compare(item, _item)) return true;
                }
                return false;
            }
            private bool Compare(Item item, ItemBot itemSetup) => item != null && item.info.shortname == itemSetup.ItemConfig.GetItemDefinition()?.shortname && item.skin == itemSetup.ItemConfig.SkinID;

            [JsonConverter(typeof(StringEnumConverter))]
            public enum SpawnMode
            {
                RandomPoint, RoadPoint, SpawnPoint, SpawnsDatabase
            }

            [JsonConverter(typeof(StringEnumConverter))]
            public enum RoadSpawnMode
            {
                DefaultRoads, MainRoads, SideRoads, TrailRoads, Rails
            }
        }
        public class ControllerSetup
        {
            [JsonProperty(RU ? "Таймер обновления мозга (0.01 - 1)" : "Brain timer tick (0.01 - 1)", Order = 10)]
            private float timerTickBrain = 0.01f;

            [JsonProperty(RU ? "Таймер обновления управления (0.01 - 1)" : "Controls timer tick (0.01 - 1)", Order = 20)]
            private float timerTickController = 0.1f;

            [JsonProperty(RU ? "Радиус поиска объектов интересующих бота" : "Find entities radius", Order = 25)]
            public float RadiusFindEntity = 30f;

            [JsonProperty(RU ? "Использовать навигацию только по NavMesh?" : "Use only NavMesh navigation?", Order = 27)]
            public bool OnlyNavMeshUse = true;

            [JsonProperty(RU ? "Скорость передвижения (1 - 4)" : "Movement speed (1 - 4)", Order = 30)]
            private int speed = 4;

            [JsonProperty(RU ? "Скорость передвижения в воде (1 - 4)" : "Movement speed in water (1 - 4)", Order = 35)]
            private int speedWater = 2;

            [JsonProperty(RU ? "Таймер самоубийства, если бот не достиг цели маршрута(0 - отключает таймер)" : "Suicide timer if the bot does not reach the destination point (0 - disables the timer)", Order = 35)]
            private float timerSuicide = 600f;

            [JsonProperty(RU ? "Таймер попытки обойти, если бот не достиг цели маршрута" : "Timer attempt to avoid obstacle if the bot does not reach the target route", Order = 35)]
            private float timerObstacle = 3f;

            [JsonProperty(RU ? "Множитель урона от воды" : "Damage rate from water", Order = 40)]
            public float RateDamageWater = 0f;

            // [JsonProperty(RU ? "Разрешенная дистанция телепортации, если бот не достиг точки маршрута в пределах этой дистанции (-1 - разрешено на любой дистанции)" : "Allowed distance to teleport if the bot does not reach the destination point within this distance (-1 - allowed for any distance)", Order = 50)]
            // private float allowedDistanceToWarp = 0f;

            [JsonProperty(RU ? "Точность стрельбы (чем ниже, тем точнее)" : "Accuracy of fire (lower is better)", Order = 20)]
            public float AccuracyOfFire = 5f;

            [JsonProperty(RU ? "Множитель урона по целям НПС" : "Damage rate to NPC targets", Order = 55)]
            public float ScaleDamageToNPC = 1f;

            [JsonProperty(RU ? "Множитель урона по животным" : "Damage rate to animals", Order = 60)]
            public float ScaleDamageToAnimal = 1f;

            [JsonProperty(RU ? "Множитель урона по игрокам" : "Damage rate to players", Order = 65)]
            public float ScaleDamageToPlayers = 1f;

            [JsonProperty(RU ? "Множитель урона от НПС" : "Damage rate from NPCs", Order = 70)]
            public float ScaleDamageFromNPC = 0.5f;

            [JsonProperty(RU ? "Множитель урона от животных" : "Damage rate from animals", Order = 75)]
            public float ScaleDamageFromAnimal = 0.5f;

            [JsonProperty(RU ? "Множитель урона от игроков" : "Damage rate from players", Order = 80)]
            public float ScaleDamageFromPlayers = 0.5f;

            public float GetTimerSuicide() => Mathf.Max(0, timerSuicide);
            public float GetTimerObstacle() => Mathf.Max(0, timerObstacle);
            public int GetSpeed() => Mathf.Clamp(speed - 1, 0, 3);
            public int GetSpeedWater() => Mathf.Clamp(speedWater - 1, 0, 3);

            public float GetAccuracyOfFire() => Mathf.Clamp(AccuracyOfFire, 1f, 50f);

            /// <summary>
            /// MaxxInvaders protect/follow escort: fastest NavMesh tier and snappy control ticks so bots keep up with sprint/horse.
            /// </summary>
            public void SetEscortMovementSpeedMax()
            {
                speed = 4;
                speedWater = 4;
                if (timerTickController > 0.05f) timerTickController = 0.05f;
            }

            /// <summary>MaxxInvaders bridge / defense: cap aim spread multiplier (lower <see cref="AccuracyOfFire"/> = tighter groups).</summary>
            public void SetSharperShootingBridge()
            {
                AccuracyOfFire = Mathf.Min(AccuracyOfFire, 2.35f);
            }

            public float GetScaleDamageTo(BaseEntity target)
            {
                if (target == null) return 0f;
                if (target is global::HumanNPC) return ScaleDamageToNPC;
                if (target is BasePlayer) return ScaleDamageToPlayers;
                if (target is BaseAnimalNPC or BaseNPC2) return ScaleDamageToAnimal;
                return 1f;
            }
            public float GetScaleDamageFrom(BaseEntity target)
            {
                if (target == null) return 0f;
                if (target is global::HumanNPC) return ScaleDamageFromNPC;
                if (target is BasePlayer) return ScaleDamageFromPlayers;
                if (target is BaseAnimalNPC or BaseNPC2) return ScaleDamageFromAnimal;
                return 1f;
            }

            public ControllerSetup()
            {
            }

            public ControllerSetup(float timerTickBrain, float timerTickController)
            {
                this.timerTickBrain = timerTickBrain;
                this.timerTickController = timerTickController;
                // this.allowedDistanceToWarp = allowedDistanceToWarp;

            }

            public float GetTimerTickBrain() => Mathf.Clamp(timerTickBrain, 0.01f, 1f);
            public float GetTimerTickController() => Mathf.Clamp(timerTickController, 0.01f, 1f);

            /// <summary>Bridge bots: tighten scan intervals when template JSON used slower ticks (does not go below 0.01 brain minimum).</summary>
            public void BridgeBoostScanTimers()
            {
                timerTickBrain = Mathf.Min(timerTickBrain, 0.05f);
                timerTickController = Mathf.Min(timerTickController, 0.08f);
            }

            /// <summary>
            /// MaxxInvaders streamer bridge on boulder maps: strict NavMesh-only paths often trap NPCs on rock edges; relax
            /// mesh lock, shorten obstacle wait, widen entity scan; <see cref="SetEscortMovementSpeedMax"/> for snappy ticks.
            /// </summary>
            public void ApplyStreamerRockyTerrainBridgeHints()
            {
                OnlyNavMeshUse = false;
                timerObstacle = Mathf.Min(timerObstacle, 1.12f);
                if (RadiusFindEntity < 42f) RadiusFindEntity = 42f;
                SetEscortMovementSpeedMax();
            }

            // public bool AllowedDistanceToWarp(float distance) => allowedDistanceToWarp < 0 || distance <= allowedDistanceToWarp;
            public bool AllowedDistanceToWarp(float distance) => false;
        }
        public class WearSetup : ContainerSetup
        {
            [JsonProperty(RU ? "Разрешить надевать найденную одежду?" : "Allow bot to wear found clothes?", Order = order + 15)]
            public bool CanUseFoundWear = false;
        }
        public class ContainerSetup
        {
            [JsonIgnore] protected const int order = 0;

            [JsonProperty(RU ? "Блокировать контейнер?(true - после смерти лут не выпадает)" : "Lock container? (true - after death loot won't drop)", Order = order + 10)]
            public bool CanLock = false;

            [JsonProperty(RU ? "Список предметов" : "List of items", Order = order + 20)]
            public List<ItemSetup> items = new();
        }
        public class SetupFullInventory
        {
            [JsonProperty(RU ? "Настройка использования тайника (бот будет складывать предметы в тайник)" : "Stash setup (bot will put items in the stash)", Order = 0)]
            public StashSetup Stash = new(true, false, 10, 3600f);

            [JsonProperty(RU ? "Настройка использования ящика (бот будет складывать предметы в ящик)" : "Box setup (bot will put items in the box)", Order = 1)]
            public BoxSetup Box = new(true, true, 0, 10, 3600f);

            [JsonProperty(RU
                ? "MaxxInvaders: складывать лут в ящик/шкаф стримера (OwnerID = якорь), без создания нового ящика"
                : "MaxxInvaders: deposit loot to anchor player's storage (OwnerID match); does not spawn a disposable box")]
            public bool BridgeUseAnchorOwnedStorage = false;

            [JsonProperty(RU ? "Радиус поиска контейнера от позиции стримера (м)" : "Search radius from anchor for owned storage (m)")]
            public float BridgeAnchorStorageSearchRadius = 18f;

            public void Init()
            {
                if (Box.Enable && string.IsNullOrEmpty(Box.UsePrefab))
                {
                    if (string.IsNullOrEmpty(Box.UsePrefab)) Box.CanUsePrefab = false;
                    else Box.CanUsePrefab = GameManager.server.FindPrefab(Box.UsePrefab)?.GetComponent<BaseEntity>() is BaseEntity baseEntity && baseEntity is IItemContainerEntity && baseEntity is not StashContainer;
                }
            }
            public IItemContainerEntity CreateStash(Vector3 position)
            {
                BaseEntity containerEntity = GameManager.server.CreateEntity("assets/prefabs/deployable/small stash/small_stash_deployed.prefab", position, Quaternion.identity);
                if (containerEntity == null) return null;
                containerEntity.enableSaving = false;
                containerEntity.Spawn();
                if (containerEntity is IItemContainerEntity itemContainer) return itemContainer;
                containerEntity.Kill();
                return null;
            }
            public IItemContainerEntity CreateBox(Vector3 position)
            {
                string prefab = Box.CanUsePrefab ? Box.UsePrefab : Box.UseSmallBox ? "assets/prefabs/deployable/woodenbox/woodbox_deployed.prefab" : "assets/prefabs/deployable/large wood storage/box.wooden.large.prefab";
                BaseEntity containerEntity = GameManager.server.CreateEntity(prefab, position, Quaternion.identity);
                if (containerEntity == null) return null;
                containerEntity.skinID = Box.Skin;
                containerEntity.enableSaving = false;
                containerEntity.Spawn();
                if (containerEntity is IItemContainerEntity itemContainer) return itemContainer;
                containerEntity.Kill();
                return null;
            }

            public struct BoxSetup
            {
                [JsonProperty(RU ? "Включить эту настройку?" : "Enable?", Order = 0)]
                public bool Enable;

                [JsonProperty(RU ? "Использовать маленький ящик?" : "Use small box?", Order = 1)]
                public bool UseSmallBox;

                [JsonProperty(RU ? "Скин ящика" : "Box skin", Order = 2)]
                public ulong Skin;

                [JsonProperty(RU ? "Время жизни (0 - будет существовать до рестарта или пока не сгниет)" : "Life time (0 - will exist until restart or until it dies)", Order = 3)]
                public float TimerKill;

                [JsonProperty(RU ? "Максимальное количество для использования (0 - без лимитно)" : "Maximum amount to use (0 - without limit)", Order = 4)]
                public int MaxBox;

                [JsonProperty(RU ? "Использовать другой префаб контейнера, если не нужно оставьте пустым" : "Another container prefab (you can leave it empty)", Order = 5)]
                public string UsePrefab;

                [JsonIgnore] public bool CanUsePrefab;

                public BoxSetup(bool enable, bool useSmallBox, ulong skin, int maxBox, float timerKill, string usePrefab = "") : this()
                {
                    Enable = enable;
                    MaxBox = maxBox;
                    UseSmallBox = useSmallBox;
                    Skin = skin;
                    UsePrefab = usePrefab;
                    TimerKill = timerKill;
                }
            }
            public struct StashSetup
            {
                [JsonProperty(RU ? "Включить эту настройку?" : "Enable?", Order = 0)]
                public bool Enable;

                [JsonProperty(RU ? "Закапывать тайник?" : "Hide stash?", Order = 1)]
                public bool CanHideStash;

                [JsonProperty(RU ? "Время жизни (0 - будет существовать до рестарта)" : "Life time (0 - will exist until restart)", Order = 2)]
                public float TimerKill;

                [JsonProperty(RU ? "Максимальное количество для использования (0 - без лимитно)" : "Maximum amount to use (0 - without limit)", Order = 3)]
                public int MaxStash;

                public StashSetup(bool enable, bool canHideStash, int maxStash, float timerKill)
                {
                    Enable = enable;
                    CanHideStash = canHideStash;
                    MaxStash = maxStash;
                    TimerKill = timerKill;

                }

            }
        }
        public class SetupHunting : SetupBattle
        {
            [JsonProperty(RU ? "Разрешить охотиться? (true - будет атаковать животных, даже если они не нападают)" : "Allow to hunt? (true - will attack animals even if they are not attacking)", Order = 5)]
            public bool CanHunt = false;

            [JsonProperty(RU ? "Для охоты использование ручного оружие в приоритете?" : "Make melee weapons preferred for hunting?", Order = 10)]
            public bool PriorityMelee = true;

            [JsonProperty(RU ? "Список префабов животных для запрета охоты на них" : "List of prefabs of animals to block hunting them", Order = 50)]
            public List<string> BlockListPrefabHunting = new();

            public bool CanHunting(BaseCombatEntity animal)
            {
                if (!animal) return false;
                if (BlockListPrefabHunting.Contains(animal.PrefabName) || BlockListPrefabHunting.Contains(animal.ShortPrefabName)) return false;
                return true;
            }
        }
        public class SetupBattle
        {
            [JsonProperty(RU ? "Максимальная дистанция для атаки в дальнем бою (не меньше 5)" : "Maximum distance for attack from weapon (not less than 5)", Order = 20)]
            public float _radiusWeaponAttacked = 30f;

            [JsonProperty(RU ? "Максимальная дистанция для атаки в ближнем бою (не меньше 2)" : "Maximum distance for attack from melee (not less than 2)", Order = 30)]
            public float _radiusMeleeAttacked = 1f;

            [JsonProperty(RU ? "Через сколько секунд забыть цель если не удается ее достигнуть?" : "After how many seconds forget the target if bot couldn't reach it?")]
            public float _forgetTimer = 20f;

            [JsonProperty(RU ? "Шанс приседа во время боя для уворота" : "Chance of crouching during fight to dodge")]
            public float _duckChance = 50f;

            [JsonProperty(RU ? "Игнорировать ботов в транспорте? (TrafficDrivers, BikeDrivers, HeliPilots и другие)" : "Ignore bots in vehicles? (TrafficDrivers, BikeDrivers, HeliPilots and etc.)")]
            public bool _ignoreBotsInVehicles = true;

            [JsonProperty(RU ? "Игнорировать реальных игроков?" : "Ignore real players?")]
            public bool _ignoreRealPlayers = false;

            [JsonProperty(RU ? "(WarMode плагин) Игнорировать игрока если он в режиме PVE?" : "(WarMode plugin) Ignore player if they are in PVE mode?")]
            public bool _ignorePVEPlayer = false;

            [JsonProperty(RU ? "Игнорировать спящих игроков?" : "Ignore sleeping players?")]
            public bool _ignoreSleepingPlayers = false;

            [JsonProperty(RU ? "Игнорировать других ботов RNPC?" : "Ignore other RNPC bots?")]
            public bool _ignoreRNPC = false;

            [JsonProperty(RU ? "Игнорировать других NPC?" : "Ignore other NPCs?")]
            public bool _ignoreNPCs = false;

            [JsonProperty(RU
                ? "Игнорировать PersonalNPC (компаньоны игроков)? RoamingNPCs не будет целить их."
                : "Ignore PersonalNPC player bots? RoamingNPCs will not target them (optional PersonalNPC plugin hook).")]
            public bool _ignorePersonalNpcBots = true;

            [JsonProperty(RU
                ? "MaxxInvaders: защищать якорного игрока (стример)? Бот не атакует его и атакует того, кто его ранил (нужен Steam ID с моста)."
                : "MaxxInvaders: protect anchor streamer? Bot won't attack them and fights players who damage them (requires bridge anchor Steam ID).")]
            public bool _protectBridgeAnchorPlayer = false;

            [JsonProperty(RU
                ? "Секунд \"прицеливания\" перед выстрелом (меньше — быстрее реакция; 0.05–2.5)"
                : "Seconds of aim wind-up before firing (lower = snappier; clamped 0.05–2.5)", Order = 22)]
            public float _aimWindupSeconds = 0.28f;

            [JsonIgnore]
            public float AimWindupSeconds
            {
                get
                {
                    var v = _aimWindupSeconds <= 0.001f ? 0.28f : _aimWindupSeconds;
                    return Mathf.Clamp(v, 0.05f, 2.5f);
                }
            }

            [JsonIgnore] public float RadiusWeaponAttacked => Mathf.Max(5, _radiusWeaponAttacked);
            [JsonIgnore] public float RadiusMeleeAttacked => Mathf.Max(2, _radiusMeleeAttacked);
        }

        /// <summary>MaxxInvaders bridge: roam within a radius of the anchor player; use a dedicated <c>Bots</c> key (e.g. streamer_patrol).</summary>
        public class SetupBridgePatrol
        {
            [JsonProperty(RU ? "Патруль вокруг якоря (стримера)" : "Patrol around anchor streamer")]
            public bool Enable = false;

            [JsonProperty(RU ? "Радиус патруля от якоря (м)" : "Patrol radius from anchor (m)")]
            public float RadiusMeters = 24f;

            [JsonProperty(RU ? "Мин. секунд между сменами точки" : "Min seconds between patrol moves")]
            public float MinMoveIntervalSeconds = 5f;

            [JsonProperty(RU ? "Макс. секунд между сменами точки" : "Max seconds between patrol moves")]
            public float MaxMoveIntervalSeconds = 11f;

            [JsonProperty(RU
                ? "Радиус дальнего патруля от дома (шкаф) — только если задан MaxxInvaders home TC"
                : "Home TC roam radius (m) — used when bridge home cupboard is assigned; large = explore farther before deposit recall")]
            public float HomeRoamRadiusMeters = 160f;
        }

        /// <summary>MaxxInvaders bridge: bot runs to anchor and revives/heals using game APIs (requires <see cref="SetupBridgeMedic.Enable"/>).</summary>
        public class SetupBridgeMedic
        {
            [JsonProperty(RU ? "Включить медика для якорного игрока" : "Enable revive/heal support for anchor player")]
            public bool Enable = false;

            [JsonProperty(RU ? "Лечить если доля здоровья ниже (0–1)" : "Heal when anchor health fraction is below (0–1)")]
            public float HealBelowHealthFraction = 0.5f;

            [JsonProperty(RU ? "Поднимать при ранении / crawling" : "Revive when anchor is wounded or incapacitated")]
            public bool ReviveWhenWounded = true;

            [JsonProperty(RU ? "Дистанция действия (м)" : "Max distance to apply revive/heal (m)")]
            public float ActionDistanceMeters = 3.5f;

            [JsonProperty(RU ? "Пауза между обычными лечениями (с)" : "Cooldown between heal pulses (seconds)")]
            public float CooldownSeconds = 4f;
        }

        public class SetupMining
        {
            [JsonProperty(RU ? "Разрешить добывать дерево?" : "Allow to gather wood?", Order = 10)]
            public bool CanMiningWood = true;

            [JsonProperty(RU ? "Разрешить использовать топливо для бензопилы?" : "Allow to use fuel for chainsaw?", Order = 15)]
            public bool CanFuelUseFromChainsaw = true;

            /// <summary>Approximate multiplier for ore/stone hits (rounds to integers; 2 = two strike cycles per gather step).</summary>
            [JsonProperty(RU ? "Множитель ударов по руде/камню (2 ≈ двойная добыча за цикл)" : "Ore/stone gathering strike multiplier (2 ≈ ~2× yield rate)", Order = 16)]
            public float OreGatherYieldMultiplier = 1f;

            /// <summary>Multiplies delay between tree/chainsaw swings (&lt; 1 = faster).</summary>
            [JsonProperty(RU ? "Множитель задержки между ударами по дереву (0.5 = в 2 раза быстрее)" : "Tree chop delay multiplier (<1 = faster chainsaw swings)", Order = 17)]
            public float TreeMiningStrikeDelayMultiplier = 1f;

            [JsonProperty(RU ? "Разрешить добывать руду?" : "Allow to mine ore?", Order = 20)]
            public bool CanMiningOre = true;

            [JsonProperty(RU ? "Разрешить разбивать бочки?" : "Allow to loot barrels?", Order = 30)]
            public bool CanMiningBarrel = true;

            [JsonProperty(RU ? "Разрешить разбивать дорожные знаки?" : "Allow to loot road signs?", Order = 40)]
            public bool CanMiningRoadSign = true;

            [JsonProperty(RU ? "Разрешить собирать ресурсы?" : "Allow to pickup resources?", Order = 50)]
            public bool CanPickupCollectibleItems = true;

            [JsonProperty(RU ? "Разрешить подбирать предметы?" : "Allow to pickup dropped items?", Order = 60)]
            public bool CanPickupDroppedItems = true;

            [JsonProperty(RU ? "Разрешить обыскивать ящики?" : "Allow to loot containers?", Order = 70)]
            public bool CanLootedContainer = true;

            [JsonProperty(RU ? "Разрешить обыскивать трупы" : "Allow to loot corpses?", Order = 80)]
            public bool CanLootedCorpse = true;

            [JsonProperty(RU ? "Разрешить освежевать туши животных" : "Allow to harvest corpses?", Order = 90)]
            public bool CanButcherCorpse = true;

            [JsonProperty(RU ? "Список префабов трупов животных для освежевания" : "List of prefabs of corpses to harvest", Order = 95)]
            public List<string> PrefabsCorpseToButcher = new();

            [JsonProperty(RU ? "Список префабов запрещенных для добычи" : "List of prefabs blocked for mining", Order = 100)]
            public List<string> BlockListPrefabMining = new();

            public bool CanMining(BaseEntity entity)
            {
                if (entity == null || BlockListPrefabMining.Contains(entity.PrefabName) || BlockListPrefabMining.Contains(entity.ShortPrefabName)) return false;
                return entity switch
                {
                    TreeEntity => CanMiningWood,
                    CollectibleEntity => CanPickupCollectibleItems,
                    DroppedItem => CanPickupDroppedItems,
                    ResourceEntity resourceEntity => resourceEntity.ShortPrefabName == "wood-pile" ? CanMiningWood : CanMiningOre,
                    LootContainer lootContainer => lootContainer.ShortPrefabName.Contains("loot_barrel") || lootContainer.ShortPrefabName.Contains("loot-barrel") || lootContainer.ShortPrefabName.Contains("oil_barrel") || lootContainer is NaturalBeehive ? CanMiningBarrel : lootContainer.ShortPrefabName.Contains("roadsign") ? CanMiningRoadSign : CanLootedContainer,
                    BaseCorpse corpse => CanButcher(corpse) || CanLootedCorpse,
                    _ => false
                };
            }
            public bool CanLooted(BaseCorpse corpse)
            {
                return CanLootedCorpse && corpse != null && corpse is PlayerCorpse;
            }
            public bool CanButcher(BaseCorpse animal)
            {
                if (!animal || !CanButcherCorpse) return false;
                if (PrefabsCorpseToButcher.Contains(animal.PrefabName) || PrefabsCorpseToButcher.Contains(animal.ShortPrefabName)) return true;
                return false;
            }
        }
        public class SetupResearcher
        {
            [JsonProperty(RU ? "Количество случайных позиций для посещения на рт" : "Amount of random positions to visit on monument", Order = 10)]
            public int MaxPointPathFromMonuments = 5;

            [JsonProperty(RU ? "Таймер для самоубийства, если бот застрял в этом состоянии (0 - отключает таймер)" : "Suicide timer if the bot gets stuck in this state (0 - disables the timer)", Order = 15)]
            public float TimerSuicide = 120f;

            [JsonProperty(RU ? "Список префабов монументов запрещенных для визита" : "List of monument prefabs blocked for visiting", Order = 20)]
            public List<string> BlockListPrefabsMonuments = new();

            [JsonIgnore]
            public static readonly string[] BlockedMonuments =
            {
                "assets/bundled/prefabs/autospawn/monument/cave/",
                "assets/bundled/prefabs/autospawn/monument/fishing_village/",
                "assets/bundled/prefabs/autospawn/monument/lighthouse/",
                "assets/bundled/prefabs/autospawn/monument/medium/bandit_town.prefab",
                "assets/bundled/prefabs/autospawn/monument/medium/compound.prefab",
                "assets/bundled/prefabs/autospawn/monument/offshore/oilrig_1.prefab",
                "assets/bundled/prefabs/autospawn/monument/offshore/oilrig_2.prefab",
                "assets/bundled/prefabs/autospawn/monument/small/stables_a.prefab",
                "assets/bundled/prefabs/autospawn/monument/small/stables_b.prefab",
                "assets/bundled/prefabs/autospawn/monument/underwater_lab/underwater_lab_a.prefab",
                "assets/bundled/prefabs/autospawn/monument/underwater_lab/underwater_lab_b.prefab",
                "assets/bundled/prefabs/autospawn/monument/underwater_lab/underwater_lab_c.prefab",
                "assets/bundled/prefabs/autospawn/monument/underwater_lab/underwater_lab_d.prefab"
            };

            public bool CanVisit(MonumentInfo monument)
            {
                if (monument == null) return false;

                if (!string.IsNullOrEmpty(monument.name))
                {
                    foreach (var blocked in BlockedMonuments)
                    {
                        if(string.IsNullOrEmpty(blocked)) continue;
                        if (monument.name.Contains(blocked) || monument.displayPhrase?.english?.Contains(blocked) == true)
                            return false;
                    }
                }

                return (!string.IsNullOrEmpty(monument.name) && !BlockListPrefabsMonuments.Contains(monument.name)) || (!string.IsNullOrEmpty(monument.displayPhrase?.english) && !BlockListPrefabsMonuments.Contains(monument.displayPhrase.english));
            }

            public float GetTimerSuicide()
            {
                return Mathf.Max(0, TimerSuicide);
            }
        }
        public class ListWeapons : ItemsList<ItemBot>
        {
            [JsonIgnore] public List<ItemBot> ItemsProjectile = new();
            [JsonIgnore] public List<ItemBot> ItemsMelee = new();

            [JsonProperty(RU ? "Использовать патроны?" : "Use ammo?", Order = 10)]
            public bool CanUseAmmo = false;

            [JsonProperty(RU ? "Сколько выдавать боеприпасов оружию, если настроена выдача при возрождении" : "Amount of ammo to give for weapon if respawning is allowed", Order = 15)]
            public int AmountAmmo = 128;

            public int GetAmountAmmo() => Mathf.Max(0, AmountAmmo);

            public void Init()
            {
                foreach (var item in GetItemsList())
                {
                    if (item.ItemConfig.GetItemDefinition().GetComponent<ItemModEntity>() is ItemModEntity modEntity)
                    {
                        if (modEntity.entityPrefab.GetEntity() is BaseProjectile projectile)
                        {
                            if(!string.IsNullOrEmpty(item.ammoShortname)) projectile.primaryMagazine.ammoType = ItemManager.FindItemDefinition(item.ammoShortname);

                            item.AmmoTypes = projectile.primaryMagazine.definition.ammoTypes;
                            if (!ItemsProjectile.Contains(item)) ItemsProjectile.Add(item);
                        }
                        else if (modEntity.entityPrefab.GetEntity() is BaseMelee && !ItemsMelee.Contains(item)) ItemsMelee.Add(item);
                    }
                }
            }
        }
        public class ItemsList<T> where T : ItemBot
        {
            [JsonIgnore] private const int order = 0;

            [JsonProperty(RU ? "Список предметов (в порядке приоритета)" : "List of items (in priority order)", Order = order + 10)]
            public List<T> Items = new();

            [JsonProperty(RU ? "Включить рандомный порядок вместо приоритета?" : "Enable random order instead of priority?")]
            public bool EnableRandomOrder = false;

            public List<T> GetItemsList()
            {                   
                if(EnableRandomOrder)
                {
                    var randomizedItems = new List<T>(Items);
                    var count = randomizedItems.Count;

                    for (var i = 0; i < count; ++i) {
                        var r = Random.Range(i, count);
                        var tmp = randomizedItems[i];
                        randomizedItems[i] = randomizedItems[r];
                        randomizedItems[r] = tmp;
                    }

                    return randomizedItems;
                }

                return Items;
            }

            public void SetGiveItemsToList(List<ItemBot> itemsGiveBot)
            {
                foreach (var item in GetItemsList())
                {
                    if (item.CanGiveRespawn && !itemsGiveBot.Contains(item)) itemsGiveBot.Add(item);
                }
            }
        }
        public class AmountItemBot : ItemBot
        {
            [JsonProperty(RU ? "Количество предметов для выдачи при возрождении" : "Amount of items to give when respawning", Order = 40)]
            private int amount = 1;

            [JsonIgnore] public override int Amount => amount > 0 ? amount : 1;

            public AmountItemBot(bool canCreate, bool canGiveRespawn, int amount, ItemSetup itemConfig) : base(canCreate, canGiveRespawn, itemConfig)
            {
                this.amount = amount;
            }
        }
        public class ItemBot
        {
            [JsonProperty(RU ? "Разрешить создавать предмет, если его нет в инвентаре?" : "Allow to create item if it is not in inventory?", Order = 10)]
            public bool CanCreate = false;

            [JsonProperty(RU ? "Разрешить выдавать предмет при возрождении?" : "Allow to give item when respawning?", Order = 20)]
            public bool CanGiveRespawn = false;

            [JsonProperty(RU ? "Предмет" : "Item", Order = 30)]
            public ItemSetup ItemConfig;

            [JsonProperty(!RU ? "Ammo shortname for weapon (leave empty to keep default)" : "Шортнейм патронов для оружия (оставьте пустым для дефолтных)", Order = 40)]
            public string ammoShortname = "";

            [JsonIgnore] private ItemModEntity _modEntity;
            [JsonIgnore] private AmmoTypes ammoTypes = 0;
            [JsonIgnore]
            public ItemModEntity ModEntity
            {
                get
                {
                    if (_modEntity != null) return _modEntity;
                    if (ItemConfig.GetItemDefinition() == null) return null;
                    return _modEntity = ItemConfig.GetItemDefinition().GetComponent<ItemModEntity>();
                }
            }
            [JsonIgnore]
            public AmmoTypes AmmoTypes
            {
                get
                {
                    if (ammoTypes == 0) return (AmmoTypes)ammoTypes;
                    if (ItemConfig.GetItemDefinition() == null) return 0;
                    return ammoTypes = (ModEntity?.entityPrefab?.GetEntity() as BaseProjectile)?.primaryMagazine?.definition.ammoTypes ?? 0;
                }
                set => ammoTypes = value;
            }
            [JsonIgnore] public virtual int Amount => 1;

            public ItemBot()
            {
            }


            public ItemBot(bool canCreate, bool canGiveRespawn, ItemSetup itemConfig)
            {
                CanCreate = canCreate;
                CanGiveRespawn = canGiveRespawn;
                ItemConfig = itemConfig;
            }
            public override int GetHashCode()
            {
                return base.GetHashCode();
            }
            public override bool Equals(object obj)
            {
                if (obj is ItemBot other)
                {
                    return this == other;
                }
                return base.Equals(obj);
            }
            public Item CreateItem()
            {
                return ItemConfig.CreateItem(Amount);
            }

            public static bool operator ==(ItemBot left, ItemBot right)
            {
                if (left is null && right is null)
                    return false;

                if (left is null || right is null)
                    return false;
                if (left.CanGiveRespawn && right.CanGiveRespawn)
                    return left.ItemConfig.GetItemDefinition() == right.ItemConfig.GetItemDefinition() && left.ItemConfig.SkinID == right.ItemConfig.SkinID;

                // Иначе сравниваем по ссылке или другим критериям
                return ReferenceEquals(left, right);
            }
            public static bool operator !=(ItemBot left, ItemBot right)
            {
                return !(left == right);
            }

        }
        public struct ItemSetup
        {
            [JsonProperty(RU ? "ShortName или ID предмета" : "Item shortname or ID")]
            public string shortNameOrId;

            [JsonProperty(RU ? "Название предмета (оставьте пустым для стандартного)" : "Item name (leave empty for default)")]
            public string name;

            [JsonProperty(RU ? "Скин предмета" : "Item skin")]
            public ulong SkinID;

            [JsonProperty(RU ? "Включить шанс выпадения при смерти?" : "Enable chance of drop on death?")]
            public bool enableDropChance;

            [JsonProperty(RU ? "Шанс выпадения при смерти (0-100)" : "Chance of drop on death (0-100)")]
            public int dropChance;

            [JsonProperty(RU ? "Дополнения" : "Attachments")]
            public List<AttachmentItemSetup> attachments;

            public struct AttachmentItemSetup
            {
                [JsonProperty(RU ? "ShortName или ID предмета" : "Item shortname or ID")]
                public string shortNameOrId;

                [JsonProperty(RU ? "Скин предмета" : "Item skin")]
                public ulong SkinID;

                [JsonIgnore] private ItemDefinition _def;

                public AttachmentItemSetup(string shortNameOrId, ulong skin)
                {
                    this.shortNameOrId = shortNameOrId;
                    this.SkinID = skin;
                    _def = null;
                }

                public Item CreateItem(int amount, string name = "")
                {
                    if (string.IsNullOrEmpty(shortNameOrId)) return null;
                    if (amount < 1) amount = 1;
                    amount = amount == 0 ? 1 : Mathf.Abs(amount);
                    Item result = null;
                    if (int.TryParse(shortNameOrId, out int id)) result = ItemManager.CreateByItemID(id, amount, SkinID);
                    if (result == null) result = ItemManager.CreateByName(shortNameOrId, amount, SkinID);
                    if (result != null && !string.IsNullOrEmpty(name)) result.name = name;
                    if (result == null) Debug.LogWarning(RU ? "Не создан предмет[{0}]" : "Item [{0}] not created", shortNameOrId);
                    
                    return result;
                }
                public ItemDefinition GetItemDefinition()
                {
                    if (_def != null) return _def;
                    if (string.IsNullOrEmpty(shortNameOrId)) return null;
                    ItemDefinition result = null;
                    if (int.TryParse(shortNameOrId, out int id)) result = ItemManager.FindItemDefinition(id);
                    if (result == null) result = ItemManager.FindDefinitionByPartialName(shortNameOrId);
                    return _def = result;
                }
            }

            [JsonIgnore] private ItemDefinition _def;

            public ItemSetup(string shortNameOrId, ulong skin)
            {
                this.shortNameOrId = shortNameOrId;
                this.name = "";
                this.SkinID = skin;
                this.attachments = new List<AttachmentItemSetup>();
                this.dropChance = 100;
                _def = null;
                enableDropChance = false;
            }

            public Item CreateItem(int amount)
            {
                if (string.IsNullOrEmpty(shortNameOrId)) return null;
                amount = Mathf.Max(1, amount);
                Item result = null;
                ItemDefinition def = GetItemDefinition();
                if (def != null) result = ItemManager.Create(def, amount, SkinID);
                if (result != null && !string.IsNullOrEmpty(name)) result.name = name;
                
                if (result == null) Debug.LogWarning(RU ? "Не создан предмет[{0}]" : "Item [{0}] not created", shortNameOrId);
                else if(attachments != null)
                {
                    if(attachments?.Count != 0 && result.contents != null)
                    {
                        foreach(var attachment in attachments)
                        {
                            var attachmentItem = attachment.CreateItem(1);
                            if(attachmentItem != null) attachmentItem.MoveToContainer(result.contents);
                        }

                        var heldEntity = result.GetHeldEntity();

                        if(heldEntity != null)
                        {
                            if(heldEntity is BaseProjectile projectile)
                            {
                                projectile.SetLightsOn(true);
                            }
                        }
                    }
                }
                
                return result;
            }
            public ItemDefinition GetItemDefinition()
            {
                if (_def != null) return _def;
                if (string.IsNullOrEmpty(shortNameOrId)) return null;
                ItemDefinition result = null;
                if (int.TryParse(shortNameOrId, out int id)) result = ItemManager.FindItemDefinition(id);
                if (result == null) result = ItemManager.FindDefinitionByPartialName(shortNameOrId);
                return _def = result;
            }
        }
        public class SetupPhrase
        {
            [JsonProperty(RU ? "Использовать голосовые фразы?" : "Use voice phrases?")]
            public bool Enabled = false;

            [JsonProperty(RU ? "Фразы для состояния добытчика - Miner" : "Phrases for the Miner state")]
            public SetupPhraseMinerState MinerPhrases = new();

            [JsonProperty(RU ? "Фразы для состояния охотника - Hunter" : "Phrases for the Hunter state")]
            public SetupPhraseHunterState HunterPhrases = new();

            [JsonProperty(RU ? "Фразы для состояния боя с игроками и НПС" : "Phrases for the Fight state")]
            public SetupPhraseAttackerState AttackerPhrases = new();

            [JsonProperty(RU ? "Фразы для состояния исследователя - Researcher" : "Phrases for the Researcher state")]
            public SetupPhraseResearcherState ResearcherPhrases = new();

            [JsonProperty(RU ? "Фразы при создании контейнера с ресурсами" : "Phrases when creating a container with resources")]
            public Phrases FullState = new();

            [JsonProperty(RU ? "Фразы при лечении" : "Phrases when healing")]
            public Phrases MedicalState = new();


            public class SetupPhraseMinerState
            {
                [JsonProperty(RU ? "Фразы при подборе ресурсов" : "Phrases when picking up resources")]
                public Phrases PhrasesPickupCollectable;

                [JsonProperty(RU ? "Фразы при подборе предметов" : "Phrases when picking up items")]
                public Phrases PhrasesPickupItem;

                [JsonProperty(RU ? "Фразы при добыче деревьев" : "Phrases when gathering trees")]
                public Phrases PhrasesMiningTree;

                [JsonProperty(RU ? "Фразы при добыче руды" : "Phrases when mining ore")]
                public Phrases PhrasesMiningOre;

                [JsonProperty(RU ? "Фразы при обыскивании контейнеров" : "Phrases when looting containers")]
                public Phrases PhrasesLooting;

                [JsonProperty(RU ? "Фразы при разбивании контейнеров(бочки, знаки и тд.)" : "Phrases when breaking containers (barrels, signs and etc.)")]
                public Phrases PhrasesBreaking;

                [JsonProperty(RU ? "Фразы при обыскивании трупов" : "Phrases when looting corpses")]
                public Phrases PhrasesLootingCorpse;

                [JsonProperty(RU ? "Фразы при освежевании трупов" : "Phrases when harvesting corpses")]
                public Phrases PhrasesButcherCorpse;
            }
            public class SetupPhraseResearcherState
            {
                [JsonProperty(RU ? "Фразы перед началом движения к точке рт" : "Phrases before starting to move to the monument point")]
                public Phrases PhrasesBeforeMove;

                [JsonProperty(RU ? "Фразы при достижении позиции" : "Phrases when reaching the destination")]
                public Phrases PhrasesAfterMove;
            }
            public class SetupPhraseHunterState
            {
                [JsonProperty(RU ? "Фразы перед началом атаки" : "Phrases before starting to attack")]
                public Phrases PhrasesStartAttack;
            }
            public class SetupPhraseAttackerState
            {
                [JsonProperty(RU ? "Фразы перед началом атаки" : "Phrases before starting to attack")]
                public Phrases PhrasesStartAttack;

                [JsonProperty(RU ? "Фразы когда бот не видит цель атаки" : "Phrases when the bot does not see the target")]
                public Phrases PhrasesNotVisibleTarget;

                [JsonProperty(RU ? "Фразы когда бот убегает от атакующего" : "Phrases when the bot runs away from the attacker")]
                public Phrases PhrasesRunAway;
            }

            public struct Phrases
            {
                [JsonProperty(RU ? "Фразы" : "Phrases")]
                private string[] phrases;

                [JsonProperty(RU ? "Шанс использования фразы (% 0 - 100)" : "Chance of using phrases (% 0 - 100)")]
                private float chance;

                public Phrases(float chance, params string[] phrases)
                {
                    this.chance = chance;
                    this.phrases = phrases;
                }

                [JsonIgnore] public string Phrase => phrases == null || phrases.Length == 0 || Random.Range(0f, 100f) > chance ? "" : phrases[Random.Range(0, phrases.Length)];
            }
        }

        [JsonConverter(typeof(StringEnumConverter))]
        public enum DeadCorpse
        {
            PlayerCorpse, NpcCorpse, Backpack
        }
        [JsonConverter(typeof(StringEnumConverter))]
        public enum PersonalityBot
        {
            Aggressive, Friendly, Defensive,
        }
        protected override void LoadDefaultConfig() => config = Configuration.GetDefault();
        protected override void LoadConfig()
        {
            base.LoadConfig();
            bool configChanged = false;

            if (config == null)
            {
#if DefaultConfig
                LoadDefaultConfig();
#else
                try
                {
                    bool isLastRu = RU;
                    if (Interface.Oxide.DataFileSystem.ExistsDatafile($"{Name}/ReserveConfig/lastLangRU"))
                    {
                        isLastRu = Interface.Oxide.DataFileSystem.ReadObject<bool>($"{Name}/ReserveConfig/lastLangRU");
                    }
                    config = Config.ReadObject<Configuration>();
                    if (config == null || isLastRu != RU)
                    {
                        LoadDataConfig();
                    }
                    else
                    {
                        if (Interface.Oxide.DataFileSystem.ExistsDatafile($"{Name}/ReserveConfig/config"))
                        {
                            string reservedConfig = Interface.Oxide.DataFileSystem.ReadObject<string>($"{Name}/ReserveConfig/config");
                            string currentConfig = JsonConvert.SerializeObject(config, Formatting.Indented, settingsSerializer);
                            if (!string.IsNullOrEmpty(reservedConfig) && !string.IsNullOrEmpty(currentConfig) && reservedConfig != currentConfig)
                            {
                                configChanged = true;
                                Debug.LogWarning(RU ? "Обнаружены изменения в конфигурации" : "Configuration changes detected");
                            }
                        }
                    }

                }
                catch (Exception ex)
                {
                    Debug.LogError("{0}", ex?.Message);
                    LoadDataConfig();
                }
#endif
            }

            SaveConfig();
            LoadDataNicknames();

            // Reinitialize bots if config was changed
            if (configChanged)
            {
                LoadDataBots();
                Data.Clear();
                SaveDataBots();
            }
        }
        public void LoadDataConfig()
        {
            try
            {
                if (Interface.Oxide.DataFileSystem.ExistsDatafile($"{Name}/ReserveConfig/config"))
                {
                    config = JsonConvert.DeserializeObject<Configuration>(Interface.Oxide.DataFileSystem.ReadObject<string>($"{Name}/ReserveConfig/config"), settingsSerializer);
                    if (config != null)
                    {
                        Debug.LogWarning(RU ? "Данный конфигурации восстановлены из резервной копии" : "The configuration has been restored from the reserve copy");
                        return;
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogError("{0}", ex?.Message);
            }
            LoadDefaultConfig();
        }
        public void SaveDataConfig()
        {
            Interface.Oxide.DataFileSystem.WriteObject($"{Name}/ReserveConfig/config", JsonConvert.SerializeObject(config, Formatting.Indented, settingsSerializer));
            Interface.Oxide.DataFileSystem.WriteObject($"{Name}/ReserveConfig/lastLangRU", RU);
        }
        protected override void SaveConfig()
        {
            Config.WriteObject(config);
            SaveDataConfig();
        }
        #endregion

        #region Data
        public void LoadDataBots()
        {
            try
            {
                if (Interface.Oxide.DataFileSystem.ExistsDatafile($"{Name}/Bots"))
                {
                    Data = Interface.Oxide.DataFileSystem.ReadObject<DataBots>($"{Name}/Bots");
                }
                else
                {
                    Data = new();
                }
            }
            catch (Exception)
            {
                Debug.LogError(RU ? "Не удалось загрузить данные ботов" : "Failed to load bot data");
                Data = new();
            }
        }
        public void SaveDataBots() => Interface.Oxide.DataFileSystem.WriteObject($"{Name}/Bots", Data);
        public class DataBots : Dictionary<string, DataBot>
        {
            public DataBot GetData(CustomPet pet)
            {
                return null;
            }

            public void RemoveBot(ref DataBot data)
            {
                if (data == null) return;
                if (ContainsKey(data.NameSetup)) Remove(data.NameSetup);
                data = null;
            }

            public void AddBot(DataBot data)
            {
                if (data == null) return;
                if (ContainsKey(data.NameSetup)) Remove(data.NameSetup);
                Add(data.NameSetup, data);
            }
        }
        public class DataBot
        {
            [JsonIgnore] public BotSetup Setup;
            [JsonIgnore] public MemoryBot CustomMemory;
            [JsonIgnore] private bool isNewData = false;
            [JsonIgnore] public bool IsRespawnData = false;
            /// <summary>Set only for MaxxInvaders/TikFinity bridge spawns — skips OnRoamingNPCSpawn so other plugins cannot return false and block viewer NPCs.</summary>
            [JsonIgnore] public bool SpawnedFromMaxxInvadersBridge;
            /// <summary>Steam ID of the in-game anchor to protect when BattleState._protectBridgeAnchorPlayer is true (MaxxInvaders bridge).</summary>
            [JsonIgnore] public ulong BridgeProtectAnchorUserId;
            /// <summary>Player to pursue after they damaged the protected anchor.</summary>
            [JsonIgnore] public ulong BridgeRetaliationTargetUserId;
            /// <summary>Animal/NPC net id to pursue when it damaged the protected anchor (HunterState; <see cref="BridgeRetaliationExpireTime"/> shared with player retaliation).</summary>
            [JsonIgnore] public ulong BridgeRetaliationAnimalNetId;
            [JsonIgnore] public float BridgeRetaliationExpireTime;
            [JsonIgnore] public float BridgePatrolNextMoveAt;
            /// <summary>Throttle <see cref="RoamingNPCs.TrySnapBridgeNpcFeetToVisualGround"/> while idle.</summary>
            [JsonIgnore] public float BridgeGroundSnapNextAt;
            /// <summary>MaxxInvaders: optional <see cref="StorageContainer"/> net ID for <c>deposit</c> (OwnerID must match anchor).</summary>
            [JsonIgnore] public ulong BridgeDepositContainerNetId;
            /// <summary>MaxxInvaders: optional tool cupboard (<see cref="BuildingPrivlidge"/>) net ID — roam center + far patrol; return to deposit only when deposit is called.</summary>
            [JsonIgnore] public ulong BridgeHomeCupboardNetId;
            /// <summary>Walking to assigned/nearby storage before <c>DepositItemsToAnchorOwnedStorage</c> transfer.</summary>
            [JsonIgnore] public bool BridgeDepositApproachActive;
            [JsonIgnore] public ulong BridgeDepositApproachContainerNetId;
            /// <summary>MaxxInvaders: main full, no deposit space yet — idle near anchor box (or anchor) until a box frees up.</summary>
            [JsonIgnore] public bool BridgeDepositStandbyActive;
            [JsonIgnore] public float BridgeDepositStandbyNextMoveAt;
            [JsonIgnore] public float BridgeDepositStandbyNextSearchAt;
            /// <summary>Last <see cref="ApplyBridgeTask"/> keyword applied (runtime only; not saved).</summary>
            [JsonIgnore] public string BridgeLastAppliedTask;
            /// <summary>Prevents stacking resume timers after streamer-defense retaliation ends.</summary>
            [JsonIgnore] public bool BridgeResumeAfterDefenseScheduled;
            /// <summary>Tight escort: last sampled anchor position — when the streamer moves, we allow an immediate patrol repath.</summary>
            [JsonIgnore] public Vector3 BridgePatrolLastAnchorPos;
            /// <summary>Whether <see cref="BridgePatrolLastAnchorPos"/> has been set for this bot.</summary>
            [JsonIgnore] public bool BridgePatrolAnchorPosValid;
            /// <summary>Throttle forced repaths when the streamer moves (avoid NavMesh spam).</summary>
            [JsonIgnore] public float BridgePatrolAnchorChaseNextAt;
            /// <summary>Previous anchor sample for MaxxInvaders protect idle-hold (stay still near stationary streamer).</summary>
            [JsonIgnore] public Vector3 BridgeProtectAnchorIdlePrevSample;
            /// <summary>Whether <see cref="BridgeProtectAnchorIdlePrevSample"/> has been initialized for idle detection.</summary>
            [JsonIgnore] public bool BridgeProtectAnchorIdlePrevValid;
            /// <summary>Throttle <see cref="BridgeAnchorMedicState"/> heals (revive ignores cooldown).</summary>
            [JsonIgnore] public float BridgeMedicLastActionRealtime;
            [JsonIgnore] public bool IsInitMemory => CustomMemory != null && CustomMemory.IsInit;
            [JsonIgnore] public bool CanLockWear => Setup.Wear?.CanLock ?? false;
            [JsonIgnore] public bool CanDropBeltInventory => Setup?.CanDropBeltInventory ?? true;
            [JsonIgnore] public bool IgnoreBotsInVehicles => Setup?.BattleState?._ignoreBotsInVehicles ?? true;
            [JsonIgnore] public bool IgnoreSleepingPlayers => Setup?.BattleState?._ignoreSleepingPlayers ?? true;
            [JsonIgnore] public bool IgnorePVEPlayer => Setup?.BattleState?._ignorePVEPlayer ?? true;
            [JsonIgnore] public bool IgnoreRealPlayers => Setup?.BattleState?._ignoreRealPlayers ?? true;
            [JsonIgnore] public bool IgnoreRNPCs => Setup?.BattleState?._ignoreRNPC ?? true;
            [JsonIgnore] public bool IgnoreNPCs => Setup?.BattleState?._ignoreNPCs ?? true;
            [JsonIgnore] public bool IgnorePersonalNpcBots => Setup?.BattleState?._ignorePersonalNpcBots ?? true;
            [JsonIgnore] public List<ItemSetup> DeathItemsBlacklist => Setup?.deathItemsBlacklist ?? null;
            public Vector3 lastPosition;
            public string NameSetup;
            public string defaultNameSetup;
            public string DisplayName;
            public ulong userID;
            public float health;
            public float maxHealth;
            [JsonProperty("Memory")] private MemoryData memoryData;
            [JsonProperty("Inventory")] private DataInventory inventory;
            public MetabolismData metabolismData;

            public DataBot()
            {
            }

            public DataBot(string nameSetup, BotSetup Setup)
            {
                NameSetup = nameSetup;
                this.Setup = Setup;
                isNewData = true;
                memoryData = new();
                inventory = new();
                string baseName = nameSetup;
                int underscoreIndex = nameSetup.LastIndexOf('_');
                if (underscoreIndex > 0 && int.TryParse(nameSetup.Substring(underscoreIndex + 1), out _))
                {
                    baseName = nameSetup.Substring(0, underscoreIndex);
                }
                defaultNameSetup = baseName;
            }

            [JsonIgnore] public bool HasLastPosition => lastPosition != Vector3.zero;
            public void RestorePet(CustomPet customPet)
            {
                if (isNewData)
                {
                    RestoreCreate(customPet);
                }
                else if (IsRespawnData)
                {
                    RestoreRespawn(customPet);
                }
                else RestoreReload(customPet);
                customPet.OverrideMaxHealth(maxHealth);
                customPet.SetHealth(health);
                if(string.IsNullOrEmpty(defaultNameSetup))
                {
                    string baseName = NameSetup;
                    int underscoreIndex = NameSetup.LastIndexOf('_');
                    if (underscoreIndex > 0 && int.TryParse(NameSetup.Substring(underscoreIndex + 1), out _))
                    {
                        baseName = NameSetup.Substring(0, underscoreIndex);
                    }
                    defaultNameSetup = baseName;
                }
            }

            private void RestoreCreate(CustomPet customPet)
            {
                isNewData = false;
                health = maxHealth = Setup.MaxHealth;
                CustomMemory = new(memoryData);
                metabolismData = new(customPet);
                GiveItemsRespawn(customPet);
            }
            private void RestoreRespawn(CustomPet customPet)
            {
                IsRespawnData = false;
                health = maxHealth = Setup.MaxHealth;
                metabolismData.Respawn(customPet);

                inventory.Clear();
                GiveItemsRespawn(customPet);
            }
            private void RestoreReload(CustomPet customPet)
            {
                CustomMemory = new(memoryData);
                metabolismData.Restore(customPet);
                inventory.GetItems(customPet);
            }
            private void GiveItemsRespawn(CustomPet customPet)
            {
                if (Setup.Wear != null)
                {
                    foreach (var itemCfg in Setup.Wear.items)
                    {
                        if (itemCfg.CreateItem(1) is Item item && !item.MoveToContainer(customPet.inventory.containerWear))
                        {
                            item.Remove();
                        }
                    }
                }
                if(Setup.ItemsOnSpawn != null)
                {
                    foreach (var itemCfg in Setup.ItemsOnSpawn)
                    {
                        if (itemCfg.CreateItem(1) is Item item && !item.MoveToContainer(customPet.inventory.containerMain))
                        {
                            item.Remove();
                        }
                    }
                }
                if (Setup.itemsGiveBot != null)
                {
                    foreach (var _item in Setup.itemsGiveBot)
                    {
                        if (_item.CreateItem() is Item item)
                        {
                            if (!item.MoveToContainer(customPet.inventory.containerMain)) item.Remove();
                            else
                            {
                                if (item.GetHeldEntity() is BaseProjectile weapon && Setup?.ItemsWeapon?.CanUseAmmo == true && (Setup?.ItemsWeapon?.GetAmountAmmo() ?? 0) > 0 && weapon.primaryMagazine.ammoType != null)
                                {
                                    Item ammo = ItemManager.Create(weapon.primaryMagazine.ammoType, Setup.ItemsWeapon.GetAmountAmmo(), 0);
                                    if (ammo != null && !ammo.MoveToContainer(customPet.inventory.containerMain)) ammo.Remove();
                                }
                            }
                        }
                    }
                }
            }

            public Vector3 GetSpawnPosition(RoamingNPCs instance)
            {
                if (HasLastPosition)
                {
                    return lastPosition;
                }
                else if(Interface.CallHook("GetSleepingBagPosition", this) is Vector3 _pos) return _pos;
                else return (Setup.spawnMode) switch
                {
                    BotSetup.SpawnMode.RoadPoint => TryGetRandomRoadPoint(100, Setup.roadSpawnMode, out Vector3 pos) ? pos : ServerMgr.FindSpawnPoint(null).pos,
                    BotSetup.SpawnMode.RandomPoint => TryGetRandomMapPoint(100, out Vector3 pos) ? pos : ServerMgr.FindSpawnPoint(null).pos,
                    BotSetup.SpawnMode.SpawnsDatabase => instance.Spawns != null && !string.IsNullOrEmpty(Setup.spawnsDatabaseFileName) ? (instance.Spawns.CallHook("GetRandomSpawn", Setup.spawnsDatabaseFileName) is Vector3 point ? point : ServerMgr.FindSpawnPoint(null).pos) : ServerMgr.FindSpawnPoint(null).pos,
                    _ => ServerMgr.FindSpawnPoint(null).pos,
                };
            }

            public void Respawn(CustomPet customPet)
            {
                IsRespawnData = false;
                metabolismData.Respawn(customPet);
            }

            public void InitializeMemory()
            {
                CustomMemory.Init();
            }

            public void OnSaveServer(CustomPet customPet)
            {
                lastPosition = customPet.transform.position;
                health = customPet.Health();
                maxHealth = customPet.MaxHealth();
                metabolismData.OnSaveServer(customPet);
                inventory.AddItems(customPet);
            }
            public void SaveWearInventory(ItemContainer containerWear)
            {
                inventory.SaveWearInventory(containerWear);
            }
            public void SaveBeltInventory(ItemContainer containerBelt)
            {
                inventory.SaveBeltInventory(containerBelt);
            }
            public void OnDied()
            {
                lastPosition = Vector3.zero;
                health = maxHealth = Setup.MaxHealth;
            }
            public void ClearInventory()
            {
                inventory.Clear();
            }


            public class MemoryData
            {
            }
            public class MetabolismData
            {
                public float hydration;
                public float calories;

                public MetabolismData()
                {
                }


                public MetabolismData(CustomPet pet)
                {
                    hydration = pet.metabolism.hydration.value = pet.metabolism.hydration.max;
                    calories = pet.metabolism.calories.value = pet.metabolism.calories.max;
                }

                public void Restore(CustomPet pet)
                {
                    pet.metabolism.hydration.value = hydration;
                    pet.metabolism.calories.value = calories;
                }

                public void OnSaveServer(CustomPet pet)
                {
                    hydration = pet.metabolism.hydration.value;
                    calories = pet.metabolism.calories.value;
                }

                public void Respawn(CustomPet pet)
                {
                    hydration = pet.metabolism.hydration.value = pet.metabolism.hydration.max;
                    calories = pet.metabolism.calories.value = pet.metabolism.calories.max;
                }

            }
        }
        public class DataInventory
        {
            [JsonProperty("Main")] private List<ItemData> containerMain = new List<ItemData>();
            [JsonProperty("Wear")] private List<ItemData> containerWear = new List<ItemData>();
            [JsonProperty("Belt")] private List<ItemData> containerBelt = new List<ItemData>();

            public void AddItems(BasePlayer player)
            {
                if (!player || player.inventory == null) return;
                if (player.inventory.containerBelt != null) AddItems(player.inventory.containerBelt, containerBelt);
                if (player.inventory.containerMain != null) AddItems(player.inventory.containerMain, containerMain);
                if (player.inventory.containerWear != null) AddItems(player.inventory.containerWear, containerWear);
            }

            public void GetItems(BasePlayer player)
            {
                if (!player || player.inventory == null) return;
                if (player.inventory.containerBelt != null) GetItems(player, player.inventory.containerBelt, containerBelt);
                if (player.inventory.containerMain != null) GetItems(player, player.inventory.containerMain, containerMain);
                if (player.inventory.containerWear != null) GetItems(player, player.inventory.containerWear, containerWear);
            }
            public void Clear()
            {
                containerBelt?.Clear();
                containerMain?.Clear();
                containerWear?.Clear();
            }
            public void SaveWearInventory(ItemContainer containerWear)
            {
                if (containerWear != null) AddItems(containerWear, this.containerWear);
            }
            public void SaveBeltInventory(ItemContainer containerBelt)
            {
                if (containerBelt != null) AddItems(containerBelt, this.containerBelt);
            }
            private static void AddItems(ItemContainer container, List<ItemData> itemsData)
            {
                itemsData.Clear();

                if (container.itemList.Count == 0) return;

                foreach (var item in container.itemList)
                {
                    if (item != null) itemsData.Add(new ItemData(item));
                }

                itemsData.Sort((a, b) => a.position.CompareTo(b.position));
            }
            private static void GetItems(BasePlayer player, ItemContainer container, List<ItemData> itemsData)
            {
                container.Clear();
                if (itemsData.Count == 0) return;

                foreach (var itemData in itemsData)
                {
                    if (itemData != null)
                    {
                        Item item = CreateItem(itemData);
                        if (!item.MoveToContainer(container, itemData.position) && !item.MoveToContainer(container))
                        {
                            item.Drop(player.inventory.containerMain.dropPosition, player.inventory.containerMain.dropVelocity);
                        }
                    }
                }
            }
            public static Item CreateItem(ItemData itemData)
            {
                Item item = ItemManager.CreateByItemID(itemData.itemid, Mathf.Max(1, itemData.amount), itemData.skin);
                if (item == null)
                    return null;

                item.condition = itemData.condition;
                item.maxCondition = itemData.maxCondition;

                item.name = itemData.name;

                if (itemData.text != null)
                {
                    item.text = itemData.text;
                }

                item.flags |= itemData.flags;

                if (itemData.frequency > 0)
                {
                    ItemModRFListener rfListener = item.info.GetComponentInChildren<ItemModRFListener>();
                    if (rfListener)
                    {
                        PagerEntity pagerEntity = BaseNetworkable.serverEntities.Find(item.instanceData.subEntity) as PagerEntity;
                        if (pagerEntity)
                        {
                            pagerEntity.ChangeFrequency(itemData.frequency);
                            item.MarkDirty();
                        }
                    }
                }

                if (itemData.instanceData != null && itemData.instanceData.IsValid())
                    itemData.instanceData.Restore(item);

                FlameThrower flameThrower = item.GetHeldEntity() as FlameThrower;
                if (flameThrower)
                    flameThrower.ammo = itemData.ammo;

                if (itemData.contents != null && item.contents != null)
                {
                    foreach (ItemData contentData in itemData.contents)
                    {
                        Item childItem = CreateItem(contentData);
                        if (childItem == null)
                            continue;

                        if (!childItem.MoveToContainer(item.contents, contentData.position) && !childItem.MoveToContainer(item.contents))
                            item.Remove();

                        item.MarkDirty();
                    }

                    item.contents.MarkDirty();
                }

                BaseProjectile weapon = item.GetHeldEntity() as BaseProjectile;
                if (weapon)
                {
                    weapon.DelayedModsChanged();

                    if (!string.IsNullOrEmpty(itemData.ammotype))
                        weapon.primaryMagazine.ammoType = ItemManager.FindItemDefinition(itemData.ammotype);
                    weapon.primaryMagazine.contents = itemData.ammo;
                }
                
                return item;
            }

            public class ItemData
            {
                public int itemid;
                public ulong skin;
                public string name;
                public int amount;
                public float condition;
                public float maxCondition;
                public int ammo;
                public string ammotype;
                public int position;
                public int frequency;
                public InstanceData instanceData;
                public string text;
                public Item.Flag flags;
                public List<ItemData> contents;

                public ItemData()
                {
                }


                public ItemData(Item item)
                {
                    BaseEntity heldEntity = item.GetHeldEntity();
                    BaseProjectile baseProjectile = heldEntity as BaseProjectile;

                    itemid = item.info.itemid;
                    amount = item.amount;
                    name = item.name;
                    ammo = baseProjectile ? baseProjectile.primaryMagazine.contents : heldEntity is FlameThrower flameThrower ? flameThrower.ammo : 0;
                    ammotype = baseProjectile ? baseProjectile.primaryMagazine.ammoType.shortname : null;
                    position = item.position;
                    skin = item.skin;
                    condition = item.condition;
                    maxCondition = item.maxCondition;
                    frequency = ItemModAssociatedEntity<PagerEntity>.GetAssociatedEntity(item)?.GetFrequency() ?? -1;
                    instanceData = new InstanceData(item);
                    text = item.text;
                    flags = item.flags;
                    if (item.contents != null)
                    {
                        contents = new List<ItemData>();
                        AddItems(item.contents, contents);
                    }
                }


                public class InstanceData
                {
                    public int dataInt;
                    public int blueprintTarget;
                    public int blueprintAmount;

                    public InstanceData()
                    {
                    }

                    public InstanceData(Item item)
                    {
                        if (item.instanceData == null) return;

                        dataInt = item.instanceData.dataInt;
                        blueprintAmount = item.instanceData.blueprintAmount;
                        blueprintTarget = item.instanceData.blueprintTarget;
                    }

                    public void Restore(Item item)
                    {
                        if (item.instanceData == null) item.instanceData = new ProtoBuf.Item.InstanceData();

                        item.instanceData.ShouldPool = false;

                        item.instanceData.blueprintAmount = blueprintAmount;
                        item.instanceData.blueprintTarget = blueprintTarget;
                        item.instanceData.dataInt = dataInt;

                        item.MarkDirty();
                    }

                    public bool IsValid()
                    {
                        return dataInt != 0 || blueprintAmount != 0 || blueprintTarget != 0;
                    }
                }
            }
        }

        #endregion

        #region Nicknames Data

        public void LoadDataNicknames()
        {
            try
            {
                if (Interface.Oxide.DataFileSystem.ExistsDatafile($"{Name}/RandomNicknames"))
                {
                    NicknamesData = Interface.Oxide.DataFileSystem.ReadObject<List<string>>($"{Name}/RandomNicknames");
                }
                else
                {
                    NicknamesData = new() { "xX_NightRaider_Xx", "Pr0_Survivor", "AK47_God", "ToxicRaider99", "PvP_Machine", "Noob_Slayer69", "SK1LL_ISSUE", "BloodBath_PvP", "L33tRust3r", "Cr1mson_Raider", "G0dMode_Rust", "Fr4gs4Days", "MLG_Rustard", "YourBaseDead", "T0xicLegacy", "RustEdge_Pro", "PvPKing2024", "NightCrawler_PvP", "OneSh0tOneKill", "xX_R4ID3R_Xx", "DefinitelyNotCheating", "NakedOnBeach", "CantFindMyRock", "StoneSpearOnly", "JustAFarmer", "IPromiiseImFriendly", "PleaseNoRaid", "MyStoneLeg", "BlameTheLag", "StoneSpearsGang", "JustPassingThrough", "IFoundAGun", "NakedWithRock", "TouchGrass_Later", "YourNeighbor_Fr", "JustWantToFarm", "LootGoblin420", "SleepingInBox", "NotARaider_Trust", "FriendlyNaked", "VonKrauss", "Eldritch_Warden", "Sir_Wrecksalot", "Theodric", "Magistrate", "IronCrown", "GrimHarvest", "WarlordAsh", "StoneVeil", "NorthernMercenary", "OldBlood", "Warpath", "IronwoodRex", "DuskWarden", "SilverFang", "Ironpelt", "ColdHarbor", "GraniteFist", "Voidwalker", "CapnRust", "BreadLoafSimon", "FishWithLegs", "YourMomsFridge", "NoodleArms69", "DefinitelyATree", "SadCactus", "CryptoFarmer", "HelicopterJohn", "PotatoWithWings", "RealHuman_NotBot", "SleepyPancake", "TruckNutz_Official", "NoodleBoy99", "GarbageTruck_IRL", "WetSockEnergy", "FrankFromAccounting", "LiterallyJustPete", "OnionRings_PvP", "Schmedley", "BobTheRaider", "player29183712", "DefaultGuy", "gamr2007", "Newbie_lol", "first_rust_lol", "idk_rust", "iamjohn2009", "xDavexx", "LOL_ImNew", "Please_help", "player_1122", "RustBeginner", "ConfusedPlayer", "JustStarted99", "MyFirstRust", "WhereDoIGo", "CanIJoinUrTeam", "NeedFriends_pls", "FoundThisGame", "WhatIsRust" };
                    Interface.Oxide.DataFileSystem.WriteObject($"{Name}/RandomNicknames", NicknamesData);
                }
            }
            catch (Exception)
            {
                Debug.LogError(RU ? "Не удалось загрузить данные никнеймов" : "Failed to load nicknames data");
                NicknamesData = new();
            }
        }

        #endregion

        #region InitHooks
        private void Init()
        {
            instance = this;
            BotIdGenerator.InitPlugin();
            PluginEntityComponent.InitPlugin();
        }
        private void OnServerInitialized()
        {
            if (!permission.PermissionExists(AdminPermission, this)) permission.RegisterPermission(AdminPermission, this);
            CollectibleHelper.InitPlugin();
            monuments = new();
            EnsureStreamerPatrolTemplate();
            EnsureStreamerMedicTemplate();
            EnsureStreamerMinerTemplate();
            EnsureStreamerLumberjackTemplate();
            MigrateStreamerRockyTerrainBridgeHintsOnce();
            MigrateStreamerMedicEscortPersonalityOnce();
            foreach (var bot in config.bots)
            {
                bot.Value.Init();
            }
            if (_bridgePatrolTimer != null && !_bridgePatrolTimer.Destroyed) _bridgePatrolTimer.Destroy();
            // Bridge escort repaths often use sub‑second intervals — 1s tick caused stop‑go (Reset every tick while walking).
            _bridgePatrolTimer = timer.Every(0.45f, BridgePatrolTick);
            if (_bridgeDepositApproachTimer != null && !_bridgeDepositApproachTimer.Destroyed)
                _bridgeDepositApproachTimer.Destroy();
            _bridgeDepositApproachTimer = timer.Every(0.25f, BridgeDepositApproachTick);
            timer.Once(1f, () =>
            {
                InitializationBots(false);
            });
        }
        private void OnServerSave() => SaveBots();
        private void OnNewSave(string filename)
        {
            Data = new();
            SaveDataBots();
        }
        private void Unload()
        {
            if (_timer != null && !_timer.Destroyed) _timer.Destroy();
            if (_bridgePatrolTimer != null && !_bridgePatrolTimer.Destroyed) _bridgePatrolTimer.Destroy();
            if (_bridgeDepositApproachTimer != null && !_bridgeDepositApproachTimer.Destroyed)
                _bridgeDepositApproachTimer.Destroy();
            visibleAdmins.Clear();
            visibleAdminsStash.Clear();
            _bridgeLootPetNetByLooter.Clear();
            foreach (var kv in _roamingInventoryLootProxies)
            {
                try
                {
                    kv.Value?.Kill();
                }
                catch
                {
                    /* ignore */
                }
            }
            _roamingInventoryLootProxies.Clear();
            _roamingLootUseDebounce.Clear();
            _bridgeMedicReviveStabilizeUntil.Clear();
            SaveBots();
            KillBotsUnload();
            PluginEntityComponent.UnloadPlugin();
            BotIdGenerator.UnloadPlugin();
            CollectibleHelper.UnloadPlugin();
            instance.ClearAllPooledCollection(out string response, RU);
#if DebugLog
            Debug.Log(response);
#endif
            instance = null;
        }
        #endregion

        #region Hooks
        private void OnEntitySpawned(CollectibleEntity entity)
        {
            CollectibleHelper.OnEntitySpawned(entity);
        }
        private void OnEntityKill(CollectibleEntity entity)
        {
            CollectibleHelper.OnEntityKill(entity);
        }
        private object CanAcceptItem(ItemContainer container, Item item, int targetPos)
        {
            if(item == null) return null;

            if(item.parent != null)
            {
                var ownerPlayer = item.parent.GetOwnerPlayer();
                
                if(ownerPlayer != null)
                {                 
                    if(ownerPlayer is CustomPet pet)
                    {                        
                        if(item.parent.IsLocked()) return ItemContainer.CanAcceptResult.CannotAcceptRightNow;
                        if(pet.IsWounded() || pet.IsIncapacitated())
                        {
                            if(pet.Data?.Setup?.InDeathBlackList(item) == true)
                            {
                                return ItemContainer.CanAcceptResult.CannotAcceptRightNow;
                            }
                        }
                        
                    }   
                }
            }

            return null;
        }
        private object OnItemAction(Item item, string action, BasePlayer player)
        {
            if(item == null || player == null) return null;
            
            var owner = item.GetOwnerPlayer();
            if(owner == null) return null;

            if(owner is CustomPet pet)
            {
                if(pet.Data.Setup.InDeathBlackList(item)) return false;
            }

            return null;
        }

        /// <summary>
        /// True when a real player may treat this bot like a sleeper for inventory (wear/main/belt).
        /// Includes MaxxInvaders/NPCMaxx bridge spawns and patrol-around-anchor templates so JSON does not need a new key.
        /// </summary>
        private static bool ShouldAllowPlayerLootRoamingAlive(CustomPet pet, BasePlayer looter)
        {
            if (pet == null || looter == null || pet.IsDestroyed || !pet.IsAlive()) return false;
            var data = pet.Data;
            var setup = data?.Setup;
            if (setup == null) return false;
            if (data.SpawnedFromMaxxInvadersBridge) return true;
            if (setup.BridgePatrol?.Enable == true) return true;
            return setup.AllowPlayerLootInventoryWhileAlive;
        }

        /// <summary>
        /// Lets real players open a roaming bot's main/belt/wear while it is awake (vanilla only allows sleeping/wounded).
        /// The game client usually does not send loot RPC for awake NPCs, so <see cref="OnPlayerInput"/> also opens the panel server-side.
        /// </summary>
        private object CanLootPlayer(BasePlayer target, BasePlayer looter)
        {
            if (target == null || looter == null || target == looter) return null;
            if (!looter.userID.IsSteamId()) return null;
            if (target is not CustomPet pet) return null;
            if (!ShouldAllowPlayerLootRoamingAlive(pet, looter)) return null;
            return true;
        }

        /// <summary>PersonalNPC uses ~2m ray with default layers (not a narrow mask).</summary>
        private const float LootRoamingRayDistance = 2.5f;

        private const float LootRoamingMaxSeparation = 3.5f;

        private static bool TryGetCustomPetUnderPlayerRay(BasePlayer player, float maxDist, out CustomPet pet)
        {
            pet = null;
            if (player?.eyes == null) return false;
            if (!Physics.Raycast(player.eyes.HeadRay(), out RaycastHit hit, maxDist, Physics.DefaultRaycastLayers,
                    QueryTriggerInteraction.Ignore))
                return false;
            var ent = hit.GetEntity();
            for (var i = 0; i < 8 && ent != null; i++)
            {
                if (ent is CustomPet cp)
                {
                    pet = cp;
                    return true;
                }
                ent = ent.GetParentEntity();
            }
            return false;
        }

        /// <summary>
        /// Same approach as PersonalNPC <c>OpenInventory</c>: temporary <see cref="LootableCorpse"/> + <c>SendAsSnapshot</c>;
        /// <c>StartLootingEntity</c> on the live bot does not open the client UI reliably.
        /// </summary>
        private bool TryOpenRoamingPlayerInventory(BasePlayer looter, CustomPet target)
        {
            if (looter == null || target == null || !ShouldAllowPlayerLootRoamingAlive(target, looter)) return false;
            if (looter.inventory?.loot == null || target.inventory == null) return false;
            if (looter.Connection == null) return false;

            looter.EndLooting();

            if (_roamingInventoryLootProxies.TryGetValue(looter.userID, out var existing) && existing != null &&
                !existing.IsDestroyed)
                existing.Kill();
            _roamingInventoryLootProxies.Remove(looter.userID);

            looter.inventory.loot.Clear();

            var corpse =
                GameManager.server.CreateEntity("assets/prefabs/player/player_corpse.prefab", Vector3.zero) as
                    LootableCorpse;
            if (corpse == null) return false;

            corpse.CancelInvoke("RemoveCorpse");
            corpse.syncPosition = false;
            corpse.limitNetworking = true;
            corpse.enableSaving = false;
            corpse.playerName = target.GetResolvedDisplayName();
            corpse.playerSteamID = 0UL;
            corpse.Spawn();
            corpse.SetFlag(BaseEntity.Flags.Locked, true);

            if (corpse.TryGetComponent<Buoyancy>(out var buoyancy))
                UnityEngine.Object.Destroy(buoyancy);
            if (corpse.TryGetComponent<Rigidbody>(out var rigidbody))
                UnityEngine.Object.Destroy(rigidbody);

            corpse.SendAsSnapshot(looter.Connection);

            looter.inventory.loot.Clear();
            looter.inventory.loot.PositionChecks = false;
            corpse.containers = new ItemContainer[0];

            if (!looter.inventory.loot.StartLootingEntity(corpse, false))
            {
                corpse.Kill();
                return false;
            }

            looter.inventory.loot.AddContainer(target.inventory.containerMain);
            looter.inventory.loot.AddContainer(target.inventory.containerWear);
            looter.inventory.loot.AddContainer(target.inventory.containerBelt);

            looter.inventory.loot.SendImmediate();
            looter.inventory.loot.MarkDirty();

            _roamingInventoryLootProxies[looter.userID] = corpse;
            _bridgeLootPetNetByLooter[looter.userID] = target.net.ID.Value;

            timer.Once(0.25f, () =>
            {
                if (looter == null || !looter.IsConnected) return;
                looter.ClientRPC(RpcTarget.Player("RPC_OpenLootPanel", looter), "player_corpse");
            });

            return true;
        }

        /// <summary>
        /// Awake NPCs do not get a client loot prompt; opening on Use (E) when looking at an allowed bot (PersonalNPC-style ray).
        /// </summary>
        private void OnPlayerInput(BasePlayer player, InputState input)
        {
            if (player == null || !player.userID.IsSteamId()) return;
            if (player.IsSleeping() || player.IsDead() || player.IsWounded()) return;
            if (!input.WasJustPressed(BUTTON.USE)) return;
            if (_roamingLootUseDebounce.TryGetValue(player.userID, out var last) &&
                UnityEngine.Time.realtimeSinceStartup < last + 0.12f)
                return;
            if (!TryGetCustomPetUnderPlayerRay(player, LootRoamingRayDistance, out var pet)) return;
            if (!ShouldAllowPlayerLootRoamingAlive(pet, player)) return;
            if (Vector3.Distance(player.transform.position, pet.transform.position) > LootRoamingMaxSeparation) return;

            _roamingLootUseDebounce[player.userID] = UnityEngine.Time.realtimeSinceStartup;
            TryOpenRoamingPlayerInventory(player, pet);
        }

        private void OnPlayerDisconnected(BasePlayer player, string reason)
        {
            if (player == null) return;
            if (_roamingInventoryLootProxies.TryGetValue(player.userID, out var c) && c != null && !c.IsDestroyed)
                c.Kill();
            _roamingInventoryLootProxies.Remove(player.userID);
            _bridgeLootPetNetByLooter.Remove(player.userID);
            _roamingLootUseDebounce.Remove(player.userID);
            _bridgeMedicReviveStabilizeUntil.Remove(player.userID);
        }

        [ChatCommand("lootnpc")]
        private void LootNpcChatCommand(BasePlayer player, string command, string[] args)
        {
            if (player == null) return;
            CustomPet nearest = null;
            var best = LootRoamingMaxSeparation + 1.5f;
            foreach (var kv in listNpcPlayers)
            {
                var pet = kv.Value;
                if (pet == null || pet.IsDestroyed || !ShouldAllowPlayerLootRoamingAlive(pet, player)) continue;
                var d = Vector3.Distance(player.transform.position, pet.transform.position);
                if (d < best)
                {
                    best = d;
                    nearest = pet;
                }
            }
            if (nearest == null)
            {
                player.ChatMessage(RU
                    ? "Рядом нет бота, чей инвентарь можно открыть."
                    : "No roaming bot with loot access nearby (within ~5m).");
                return;
            }
            if (!TryOpenRoamingPlayerInventory(player, nearest))
                player.ChatMessage(RU
                    ? "Не удалось открыть инвентарь бота."
                    : "Could not open bot inventory (blocked or too far).");
        }
        private object OnPlayerDeath(BasePlayer player, HitInfo info)
        {
            if(player == null) return null;

            if(player is CustomPet customPet && info?.damageTypes?.GetMajorityDamageType() != DamageType.Suicide)
            {
                if(player.IsWounded() || player.IsIncapacitated() || customPet.TimesWounded >= 1 || !customPet.Data.Setup.allowWounded) return null;

                if(customPet.Data.CanLockWear) player.inventory.containerWear.SetLocked(true);
                if(!customPet.Data.CanDropBeltInventory) player.inventory.containerBelt.SetLocked(true);

                player.UpdateActiveItem(default);
                player.BecomeWounded(info);
                customPet.TimesWounded++;

                return false;
            }

            return null;
        }
        private void OnPlayerRecovered(BasePlayer player)
        {
            if(player == null) return;

            if(player is CustomPet customPet)
            {
                player.inventory.containerWear.SetLocked(false);
                player.inventory.containerBelt.SetLocked(false);
            }
        }
        private object OnEntityTakeDamage(BaseCombatEntity target, HitInfo info)
        {
            if (target is BasePlayer bp && bp.userID.IsSteamId() && !bp.IsNpc &&
                _bridgeMedicReviveStabilizeUntil.TryGetValue(bp.userID, out var protUntil) &&
                UnityEngine.Time.realtimeSinceStartup <= protUntil)
            {
                try
                {
                    if (info?.damageTypes != null && info.damageTypes.Get(DamageType.Fall) > 0f)
                        return true;
                }
                catch
                {
                    /* ignored */
                }
            }

            if (target && info?.InitiatorPlayer is CustomPet customPet && !(target is BaseCorpse))
            {
                if (customPet != target)
                {
                    info.damageTypes.ScaleAll(customPet?.Data.Setup?.Controller?.GetScaleDamageTo(target) ?? 1f);
#if DebugLog
                    if (target is BaseAnimalNPC or BaseNPC2 or BasePlayer) Debug.Log<RoamingNPCs>(RU ? $"{customPet.displayName} атакует {target.GetType().Name}[{target.ShortPrefabName}]" : $"{customPet.displayName} attacks {target.GetType().Name}[{target.ShortPrefabName}]");
#endif
                }
                else info.damageTypes.ScaleAll(0);
            }

            TryAssignBridgeProtectorRetaliation(target, info);
            TryAssignBridgeSelfDefenseAgainstAnimal(target, info);
            return null;
        }

        /// <summary>Bleed/poison/radiation ticks can kill the same tick as metabolize — repeat stabilize while window active.</summary>
        private void OnPlayerMetabolize(PlayerMetabolism metabolism, BaseCombatEntity ownerEntity, float delta)
        {
            if (metabolism == null || ownerEntity is not BasePlayer bp || bp.IsNpc || !bp.userID.IsSteamId())
                return;
            if (!_bridgeMedicReviveStabilizeUntil.TryGetValue(bp.userID, out var until)) return;
            if (UnityEngine.Time.realtimeSinceStartup > until)
            {
                _bridgeMedicReviveStabilizeUntil.Remove(bp.userID);
                return;
            }

            BridgeMedicHarmfulMetabolismReflectiveReset(metabolism);
            try
            {
                bp.Heal(99999f);
            }
            catch
            {
                /* ignored */
            }
        }

        /// <summary>MaxxInvaders bridge bot damaged by an animal — retaliate (same HunterState path as streamer defense).</summary>
        private void TryAssignBridgeSelfDefenseAgainstAnimal(BaseCombatEntity target, HitInfo info)
        {
            if (target is not CustomPet pet || pet == null || pet.IsDestroyed || pet.Data?.Setup == null) return;
            if (!pet.Data.SpawnedFromMaxxInvadersBridge) return;
            if (info?.Initiator == null) return;

            var attacker = ResolveAnimalAttackerFromInitiator(info.Initiator);
            if (attacker == null || attacker == pet || !attacker.IsAlive() || attacker.net == null) return;

            pet.Data.BridgeRetaliationAnimalNetId = attacker.net.ID.Value;
            pet.Data.BridgeRetaliationTargetUserId = 0UL;
            pet.Data.BridgeRetaliationExpireTime = UnityEngine.Time.realtimeSinceStartup + 120f;
            pet.CustomBrain?.OnNpcTarget(attacker);
        }

        private static BaseCombatEntity ResolveAnimalAttackerFromInitiator(BaseEntity initiator)
        {
            for (var i = 0; i < 12 && initiator != null; i++)
            {
                if (initiator is BaseAnimalNPC an && an.IsAlive()) return an;
                if (initiator is BaseNPC2 n2 && n2.IsAnimal && n2.IsAlive()) return n2;
                initiator = initiator.GetParentEntity();
            }

            return null;
        }

        /// <summary>When a MaxxInvaders anchor (streamer) takes damage from a player or animal, bodyguard bots retaliate.</summary>
        private void TryAssignBridgeProtectorRetaliation(BaseCombatEntity target, HitInfo info)
        {
            if (target is not BasePlayer victim || !victim.userID.IsSteamId() || victim.IsNpc)
                return;
            if (listNpcPlayers == null || listNpcPlayers.Count == 0)
                return;

            // Real player damaged the streamer
            if (info?.InitiatorPlayer is BasePlayer attacker && attacker != null && attacker != victim &&
                attacker.userID.IsSteamId() && !attacker.IsNpc)
            {
                foreach (var pet in listNpcPlayers.Values)
                {
                    if (pet == null || pet.IsDestroyed || pet.Data?.Setup == null)
                        continue;
                    var bp = pet.Data.Setup.BridgePatrol;
                    if (!pet.Data.Setup.BattleState._protectBridgeAnchorPlayer && !(bp?.Enable ?? false))
                        continue;
                    if (pet.Data.BridgeProtectAnchorUserId == 0UL ||
                        pet.Data.BridgeProtectAnchorUserId != victim.userID)
                        continue;

                    pet.Data.BridgeRetaliationTargetUserId = attacker.userID;
                    pet.Data.BridgeRetaliationAnimalNetId = 0UL;
                    pet.Data.BridgeRetaliationExpireTime = UnityEngine.Time.realtimeSinceStartup + 120f;
                }

                return;
            }

            // Animal (or animal NPC) damaged the streamer — Initiator is the entity, not InitiatorPlayer
            BaseCombatEntity animalAttacker = null;
            if (info?.Initiator is BaseCombatEntity ce && ce != null && !ce.IsDestroyed && ce != victim)
            {
                if (ce is BaseAnimalNPC or BaseNPC2)
                    animalAttacker = ce;
            }

            if (animalAttacker == null || animalAttacker.net == null) return;
            var animalNet = animalAttacker.net.ID.Value;
            foreach (var pet in listNpcPlayers.Values)
            {
                if (pet == null || pet.IsDestroyed || pet.Data?.Setup == null)
                    continue;
                var bp = pet.Data.Setup.BridgePatrol;
                if (!pet.Data.Setup.BattleState._protectBridgeAnchorPlayer && !(bp?.Enable ?? false))
                    continue;
                if (pet.Data.BridgeProtectAnchorUserId == 0UL ||
                    pet.Data.BridgeProtectAnchorUserId != victim.userID)
                    continue;

                pet.Data.BridgeRetaliationAnimalNetId = animalNet;
                pet.Data.BridgeRetaliationTargetUserId = 0UL;
                pet.Data.BridgeRetaliationExpireTime = UnityEngine.Time.realtimeSinceStartup + 120f;
            }
        }

        /// <summary>Creates <c>streamer_patrol</c> bot template once (clone of alfred_hunter) if missing from config.</summary>
        private void EnsureStreamerPatrolTemplate()
        {
            if (config?.bots == null) return;
            const string streamerKey = "streamer_patrol";
            if (config.bots.ContainsKey(streamerKey)) return;
            if (!config.bots.TryGetValue("alfred_hunter", out var src) || src == null) return;
            try
            {
                var json = JsonConvert.SerializeObject(src, settingsSerializer);
                var clone = JsonConvert.DeserializeObject<BotSetup>(json, settingsSerializer);
                if (clone == null) return;
                clone.Name = "Patrol";
                clone.BridgePatrol = new SetupBridgePatrol
                {
                    Enable = true,
                    RadiusMeters = 24f,
                    MinMoveIntervalSeconds = 0.35f,
                    MaxMoveIntervalSeconds = 0.9f,
                };
                clone.BattleState ??= new SetupBattle();
                clone.BattleState._protectBridgeAnchorPlayer = true;
                clone.FullState.BridgeUseAnchorOwnedStorage = true;
                clone.FullState.BridgeAnchorStorageSearchRadius = 18f;
                clone.AllowPlayerLootInventoryWhileAlive = true;
                clone.Controller ??= new ControllerSetup();
                clone.Controller.ApplyStreamerRockyTerrainBridgeHints();
                config.bots[streamerKey] = clone;
                SaveConfig();
                PrintWarning(
                    "[RoamingNPCs] Added default bot template 'streamer_patrol' (clone of alfred_hunter). Set MaxxInvaders ViewerRoamingTemplateKey to streamer_patrol for viewer spawns.");
            }
            catch (Exception ex)
            {
                PrintWarning($"[RoamingNPCs] Could not add streamer_patrol template: {ex.Message}");
            }
        }

        /// <summary>Creates <c>streamer_medic</c> once — patrol + revive/heal anchor + revolver/scrubs/syringes/medkits.</summary>
        private void EnsureStreamerMedicTemplate()
        {
            if (config?.bots == null) return;
            const string medicKey = "streamer_medic";
            if (config.bots.ContainsKey(medicKey)) return;
            if (!config.bots.TryGetValue("streamer_patrol", out var src) || src == null)
            {
                if (!config.bots.TryGetValue("alfred_hunter", out src) || src == null) return;
            }

            try
            {
                var json = JsonConvert.SerializeObject(src, settingsSerializer);
                var clone = JsonConvert.DeserializeObject<BotSetup>(json, settingsSerializer);
                if (clone == null) return;

                clone.Name = "Doc";
                clone.Personality = PersonalityBot.Defensive;
                clone.HunterState.CanHunt = false;

                clone.BridgeMedic = new SetupBridgeMedic
                {
                    Enable = true,
                    HealBelowHealthFraction = 0.5f,
                    ReviveWhenWounded = true,
                    ActionDistanceMeters = 3.5f,
                    CooldownSeconds = 4f,
                };

                clone.BattleState ??= new SetupBattle();
                clone.BattleState._protectBridgeAnchorPlayer = true;

                clone.BridgePatrol ??= new SetupBridgePatrol();
                clone.BridgePatrol.Enable = true;
                clone.BridgePatrol.RadiusMeters = Mathf.Max(clone.BridgePatrol.RadiusMeters, 22f);

                clone.FullState ??= new SetupFullInventory();
                clone.FullState.BridgeUseAnchorOwnedStorage = true;
                clone.FullState.BridgeAnchorStorageSearchRadius = 18f;
                clone.AllowPlayerLootInventoryWhileAlive = true;

                clone.Wear.items = new List<ItemSetup> { new ItemSetup("halloween.surgeonsuit", 0) };

                clone.ItemsWeapon.CanUseAmmo = true;
                clone.ItemsWeapon.AmountAmmo = 128;
                clone.ItemsWeapon.Items = new List<ItemBot>
                {
                    new ItemBot(false, true, new ItemSetup("pistol.revolver", 0)) { ammoShortname = "ammo.pistol" },
                };

                clone.ItemsMedical.Items = new List<AmountItemBot>
                {
                    new AmountItemBot(false, true, 40, new ItemSetup("syringe.medical", 0)),
                    new AmountItemBot(false, true, 2, new ItemSetup("largemedkit", 0)),
                };

                clone.Controller ??= new ControllerSetup();
                clone.Controller.ApplyStreamerRockyTerrainBridgeHints();
                clone.Init();
                config.bots[medicKey] = clone;
                SaveConfig();
                PrintWarning(
                    "[RoamingNPCs] Added default bot template 'streamer_medic' (field medic — revives/heals anchor). Use MaxxInvaders ViewerRoamingTemplateKey or ?template=streamer_medic.");
            }
            catch (Exception ex)
            {
                PrintWarning($"[RoamingNPCs] Could not add streamer_medic template: {ex.Message}");
            }
        }

        /// <summary>Creates <c>streamer_miner</c> once — MaxxInvaders ore/stone farmer: Kick hazmat, backpack, revolver, ~2× ore strike rate.</summary>
        private void EnsureStreamerMinerTemplate()
        {
            if (config?.bots == null) return;
            const string minerKey = "streamer_miner";
            if (config.bots.ContainsKey(minerKey)) return;
            if (!config.bots.TryGetValue("streamer_patrol", out var src) || src == null)
            {
                if (!config.bots.TryGetValue("alfred_hunter", out src) || src == null) return;
            }

            try
            {
                var json = JsonConvert.SerializeObject(src, settingsSerializer);
                var clone = JsonConvert.DeserializeObject<BotSetup>(json, settingsSerializer);
                if (clone == null) return;

                clone.Name = "Miner";
                clone.Personality = PersonalityBot.Friendly;
                clone.HunterState.CanHunt = false;

                clone.MinerState ??= new SetupMining();
                clone.MinerState.CanMiningWood = false;
                clone.MinerState.CanMiningOre = true;
                clone.MinerState.CanMiningBarrel = false;
                clone.MinerState.CanMiningRoadSign = false;
                clone.MinerState.CanPickupCollectibleItems = true;
                clone.MinerState.CanPickupDroppedItems = false;
                clone.MinerState.CanLootedContainer = false;
                clone.MinerState.CanLootedCorpse = false;
                clone.MinerState.CanButcherCorpse = false;
                clone.MinerState.CanFuelUseFromChainsaw = false;
                clone.MinerState.OreGatherYieldMultiplier = 2f;
                clone.MinerState.TreeMiningStrikeDelayMultiplier = 1f;

                clone.Wear.items = new List<ItemSetup>
                {
                    new ItemSetup("hazmatsuit.kick", 0),
                    new ItemSetup("largebackpack", 0),
                };

                // ItemBot(canCreate, canGiveRespawn, ...): CanGiveRespawn puts items in bag on spawn.
                // Jackhammer: both flags true so it spawns and can be recreated; pickaxe remains backup.
                clone.ItemsMiningOre.Items = new List<ItemBot>
                {
                    new ItemBot(true, true, new ItemSetup("jackhammer", 0)),
                    new ItemBot(false, false, new ItemSetup("pickaxe", 0)),
                    new ItemBot(true, true, new ItemSetup("pickaxe", 0)),
                };

                clone.ItemsMiningTree.Items = new List<ItemBot>();

                // Patrol/hunter clones often carry a hunting knife — Knife and Pickaxe share belt slot index 0.
                clone.ItemsButcher.Items = new List<ItemBot>();

                clone.ItemsWeapon.CanUseAmmo = true;
                clone.ItemsWeapon.AmountAmmo = 128;
                clone.ItemsWeapon.Items = new List<ItemBot>
                {
                    new ItemBot(false, true, new ItemSetup("pistol.revolver", 0)) { ammoShortname = "ammo.pistol" },
                };

                clone.Controller ??= new ControllerSetup();
                clone.Controller.ApplyStreamerRockyTerrainBridgeHints();
                clone.Init();
                config.bots[minerKey] = clone;
                SaveConfig();
                PrintWarning(
                    "[RoamingNPCs] Added default bot template 'streamer_miner' (Kick hazmat + backpack + revolver; ~2× ore gathering). Use ?template=streamer_miner.");
            }
            catch (Exception ex)
            {
                PrintWarning($"[RoamingNPCs] Could not add streamer_miner template: {ex.Message}");
            }
        }

        /// <summary>Creates <c>streamer_lumberjack</c> once — Lumberjack hazmat, chainsaw + fuel, ~2× chop speed vs default.</summary>
        private void EnsureStreamerLumberjackTemplate()
        {
            if (config?.bots == null) return;
            const string ljKey = "streamer_lumberjack";
            if (config.bots.ContainsKey(ljKey)) return;
            if (!config.bots.TryGetValue("streamer_patrol", out var src) || src == null)
            {
                if (!config.bots.TryGetValue("alfred_hunter", out src) || src == null) return;
            }

            try
            {
                var json = JsonConvert.SerializeObject(src, settingsSerializer);
                var clone = JsonConvert.DeserializeObject<BotSetup>(json, settingsSerializer);
                if (clone == null) return;

                clone.Name = "Jack";
                clone.Personality = PersonalityBot.Friendly;
                clone.HunterState.CanHunt = false;

                clone.MinerState ??= new SetupMining();
                clone.MinerState.CanMiningWood = true;
                clone.MinerState.CanMiningOre = false;
                clone.MinerState.CanMiningBarrel = false;
                clone.MinerState.CanMiningRoadSign = false;
                clone.MinerState.CanPickupCollectibleItems = true;
                clone.MinerState.CanPickupDroppedItems = false;
                clone.MinerState.CanLootedContainer = false;
                clone.MinerState.CanLootedCorpse = false;
                clone.MinerState.CanButcherCorpse = false;
                clone.MinerState.CanFuelUseFromChainsaw = true;
                clone.MinerState.OreGatherYieldMultiplier = 1f;
                clone.MinerState.TreeMiningStrikeDelayMultiplier = 0.5f;

                clone.Wear.items = new List<ItemSetup> { new ItemSetup("hazmatsuit.lumberjack", 0) };

                clone.ItemsMiningOre.Items = new List<ItemBot>();

                clone.ItemsMiningTree.Items = new List<ItemBot>
                {
                    new ItemBot(false, false, new ItemSetup("chainsaw", 0)),
                    new ItemBot(true, true, new ItemSetup("chainsaw", 0)),
                    new ItemBot(false, false, new ItemSetup("hatchet", 0)),
                };

                clone.ItemsWeapon.CanUseAmmo = false;
                clone.ItemsWeapon.AmountAmmo = 0;
                clone.ItemsWeapon.Items = new List<ItemBot>();

                clone.ItemsOnSpawn = new List<ItemSetup>();
                for (var i = 0; i < 80; i++)
                    clone.ItemsOnSpawn.Add(new ItemSetup("lowgradefuel", 0));

                clone.Controller ??= new ControllerSetup();
                clone.Controller.ApplyStreamerRockyTerrainBridgeHints();
                clone.Init();
                config.bots[ljKey] = clone;
                SaveConfig();
                PrintWarning(
                    "[RoamingNPCs] Added default bot template 'streamer_lumberjack' (Lumberjack hazmat + chainsaw; ~2× wood chop speed). Use ?template=streamer_lumberjack.");
            }
            catch (Exception ex)
            {
                PrintWarning($"[RoamingNPCs] Could not add streamer_lumberjack template: {ex.Message}");
            }
        }

        /// <summary>Existing servers: upgrade streamer bridge templates once for rocky terrain navigation.</summary>
        private void MigrateStreamerRockyTerrainBridgeHintsOnce()
        {
            if (config?.bots == null) return;
            if (config.StreamerRockyTerrainBridgeApplied) return;
            foreach (var key in new[] { "streamer_patrol", "streamer_medic", "streamer_miner", "streamer_lumberjack" })
            {
                if (!config.bots.TryGetValue(key, out var bot) || bot?.Controller == null) continue;
                bot.Controller.ApplyStreamerRockyTerrainBridgeHints();
            }

            config.StreamerRockyTerrainBridgeApplied = true;
            SaveConfig();
            PrintWarning(
                    "[RoamingNPCs] Applied rocky-terrain navigation hints to streamer bridge templates Controller (NavMesh relaxed, obstacle timer faster). Toggle \"Use only NavMesh\" back on in JSON if undesired.");
        }

        /// <summary>Existing servers: streamer_medic used Friendly — anchor escort could stall; Defensive matches bridge escort.</summary>
        private void MigrateStreamerMedicEscortPersonalityOnce()
        {
            if (config?.bots == null) return;
            if (config.StreamerMedicEscortPersonalityApplied) return;
            if (!config.bots.TryGetValue("streamer_medic", out var medic) || medic == null)
            {
                config.StreamerMedicEscortPersonalityApplied = true;
                SaveConfig();
                return;
            }

            var changed = false;
            if (medic.Personality == PersonalityBot.Friendly && medic.BridgeMedic != null && medic.BridgeMedic.Enable)
            {
                medic.Personality = PersonalityBot.Defensive;
                changed = true;
            }

            config.StreamerMedicEscortPersonalityApplied = true;
            SaveConfig();
            if (changed)
                PrintWarning(
                    "[RoamingNPCs] streamer_medic: Friendly → Defensive when bridge medic is enabled (better anchor follow / escort). Revert in RoamingNPCs.json if you relied on Friendly.");
        }

        /// <summary>
        /// NavMesh hull can sit above roads/asphalt (even a few cm). Raycast + terrain height + NavMesh.SamplePosition to pull feet down.
        /// </summary>
        private static void TrySnapBridgeNpcFeetToVisualGround(CustomPet pet)
        {
            if (pet?.MoveController?.Navigator == null || pet.IsDestroyed) return;
            try
            {
                var navigator = pet.MoveController.Navigator;
                var agent = navigator.Agent;
                if (agent == null || !agent.isOnNavMesh) return;

                var pos = pet.transform.position;
                var mask = LayerMask.GetMask("Terrain", "World", "Default", "Construction", "Deployed");
                float terY = TerrainMeta.HeightMap.GetHeight(pos);
                float groundY = terY;
                if (Physics.Raycast(pos + Vector3.up * 26f, Vector3.down, out var hit, 96f, mask,
                        QueryTriggerInteraction.Ignore))
                    groundY = Mathf.Max(terY, hit.point.y);

                var excess = pos.y - groundY;
                if (excess <= 0.004f || excess > 5.5f) return;

                bool Applied(Vector3 snapped)
                {
                    if (snapped.y >= pos.y - 0.002f) return false;
                    if (snapped.y < groundY - 0.55f) return false;
                    pet.transform.position = snapped;
                    navigator.Warp(snapped);
                    UnityEngine.Physics.SyncTransforms();
                    return true;
                }

                foreach (var lift in new[] { 0.1f, 0.28f, 0.55f, 1.1f })
                {
                    var probe = new Vector3(pos.x, groundY + lift, pos.z);
                    for (var rad = 5f; rad <= 14f; rad += 3f)
                    {
                        if (navigator.GetNearestNavmeshPosition(probe, out var snapped, rad) && Applied(snapped))
                            return;
                    }
                }

                var samplePt = new Vector3(pos.x, groundY + 1.25f, pos.z);
                if (NavMesh.SamplePosition(samplePt, out var nmHit, 16f, NavMesh.AllAreas) &&
                    Applied(nmHit.position))
                    return;
            }
            catch
            {
                /* ignored */
            }
        }

        /// <summary>
        /// <see cref="MoveController.SetDestinationFast"/> calls Reset() — re-issuing every patrol tick interrupts walking (stop‑go).
        /// </summary>
        private static bool ShouldSkipBridgeEscortRepath(CustomPet pet)
        {
            var agent = pet?.MoveController?.Navigator?.Agent;
            if (agent == null || !agent.isOnNavMesh) return false;
            if (agent.pathPending) return false;
            if (!agent.hasPath) return false;
            var rem = agent.remainingDistance;
            if (float.IsInfinity(rem) || float.IsNaN(rem)) return false;
            if (rem <= 2.1f) return false;
            return agent.velocity.sqrMagnitude > 0.018f;
        }

        /// <summary>
        /// Mirrors RustChaos <c>TryTopUpGodModeMetabolism</c>: bleed/poison/radiation/wetness/temperature ticks often survive <see cref="BasePlayer.RecoverFromWounded"/> and kill seconds later.
        /// </summary>
        private static void BridgeMedicHarmfulMetabolismReflectiveReset(PlayerMetabolism metabolism)
        {
            if (metabolism == null) return;
            try
            {
                foreach (var prop in metabolism.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
                {
                    object obj = prop.GetValue(metabolism, null);
                    if (obj == null) continue;
                    PropertyInfo valueProp =
                        obj.GetType().GetProperty("value", BindingFlags.Public | BindingFlags.Instance);
                    PropertyInfo minProp =
                        obj.GetType().GetProperty("min", BindingFlags.Public | BindingFlags.Instance);
                    PropertyInfo maxProp =
                        obj.GetType().GetProperty("max", BindingFlags.Public | BindingFlags.Instance);
                    if (valueProp == null || valueProp.PropertyType != typeof(float)) continue;

                    string n = prop.Name.ToLowerInvariant();
                    if (!(n.Contains("bleed") || n.Contains("poison") || n.Contains("radiation") ||
                          n.Contains("calorie") || n.Contains("hydration") || n.Contains("wetness") ||
                          n.Contains("temperature") || n.Contains("cold") || n.Contains("heat")))
                        continue;

                    float next = 0f;
                    if (n.Contains("calorie") || n.Contains("hydration"))
                    {
                        if (maxProp != null && maxProp.PropertyType == typeof(float))
                            next = (float)maxProp.GetValue(obj, null);
                    }
                    else if (minProp != null && minProp.PropertyType == typeof(float))
                        next = (float)minProp.GetValue(obj, null);

                    valueProp.SetValue(obj, next, null);
                }
            }
            catch
            {
                /* ignored */
            }

            try
            {
                metabolism.SendChangesToClient();
            }
            catch
            {
                /* ignored */
            }
        }

        private void BridgeMedicRegisterReviveStabilizeWindow(BasePlayer anchor)
        {
            if (anchor == null || !anchor.userID.IsSteamId()) return;
            var uid = anchor.userID;
            _bridgeMedicReviveStabilizeUntil[uid] =
                UnityEngine.Time.realtimeSinceStartup + BridgeMedicReviveStabilizeSeconds;

            NextTick(() =>
            {
                var p = BasePlayer.FindByID(uid);
                if (p == null || !p.IsValid()) return;
                TryResyncRevivedAnchorPosition(p);
            });
            timer.Once(0.12f, () =>
            {
                var p = BasePlayer.FindByID(uid);
                if (p == null || !p.IsValid()) return;
                TryResyncRevivedAnchorPosition(p);
            });
        }

        /// <summary>Clears stale fall / velocity state after wounded recovery (RustChaos-style).</summary>
        private static void TryResyncRevivedAnchorPosition(BasePlayer anchor)
        {
            if (anchor == null || !anchor.IsValid()) return;
            try
            {
                var p = anchor.transform.position;
                anchor.Teleport(p);
            }
            catch
            {
                /* ignored */
            }
        }

        private bool TryGetBridgeAssignedDepositContainer(CustomPet pet, out IItemContainerEntity container)
        {
            container = null;
            var data = pet?.Data;
            if (data == null || data.BridgeDepositContainerNetId == 0UL) return false;
            var ent = BaseNetworkable.serverEntities.Find(new NetworkableId(data.BridgeDepositContainerNetId)) as BaseEntity;
            if (ent == null || ent.IsDestroyed || ent is not StorageContainer sc) return false;
            if (sc.inventory == null || sc.inventory.IsFull()) return false;
            if (data.BridgeProtectAnchorUserId != 0UL && ent.OwnerID != data.BridgeProtectAnchorUserId) return false;
            container = sc;
            return true;
        }

        /// <summary>Assigned box first (MaxxInvaders <c>box</c> command), else nearest anchor-owned storage.</summary>
        private bool TryFindAnchorOwnedStorageForBridge(CustomPet pet, out IItemContainerEntity container)
        {
            container = null;
            var data = pet?.Data;
            var fs = data?.Setup?.FullState;
            if (fs == null || !fs.BridgeUseAnchorOwnedStorage) return false;
            if (!data.SpawnedFromMaxxInvadersBridge || data.BridgeProtectAnchorUserId == 0UL) return false;

            if (TryGetBridgeAssignedDepositContainer(pet, out container)) return true;

            var anchor = BasePlayer.FindByID(data.BridgeProtectAnchorUserId);
            if (anchor == null || !anchor.IsAlive()) return false;

            var radius = Mathf.Clamp(fs.BridgeAnchorStorageSearchRadius, 4f, 80f);
            var ownerId = data.BridgeProtectAnchorUserId;

            var list = Pool.Get<List<BaseEntity>>();
            Vis.Entities(anchor.transform.position, radius, list,
                LayerMask.GetMask("Deployed", "Construction", "Default", "World"),
                QueryTriggerInteraction.Ignore);

            StorageContainer best = null;
            var bestDist = float.MaxValue;
            foreach (var ent in list)
            {
                if (ent == null || ent.IsDestroyed) continue;
                if (ent.OwnerID != ownerId) continue;
                if (ent is not StorageContainer sc) continue;
                if (sc.inventory == null || sc.inventory.IsFull()) continue;
                var d = Vector3.Distance(pet.transform.position, ent.transform.position);
                if (d < bestDist)
                {
                    best = sc;
                    bestDist = d;
                }
            }

            Pool.FreeUnmanaged(ref list);
            if (best == null) return false;
            container = best;
            return true;
        }

        private void BridgePatrolTick()
        {
            if (listNpcPlayers == null || listNpcPlayers.Count == 0) return;
            foreach (var pet in listNpcPlayers.Values)
                TrySyncProtectEscortCrouchWithAnchor(pet);
            foreach (var pet in listNpcPlayers.Values)
                TryBridgePatrolMoveForPet(pet);
        }

        /// <summary>
        /// When the streamer (anchor) is crouched during protect/follow/guard escort, mirror stance on bridge NPCs.
        /// Runs on the bridge patrol timer so it still applies while combat logic suppresses patrol moves.
        /// </summary>
        private void TrySyncProtectEscortCrouchWithAnchor(CustomPet pet)
        {
            var setup = pet?.Data?.Setup;
            if (setup?.BridgePatrol == null || !setup.BridgePatrol.Enable) return;
            if (pet?.Data == null || !pet.Data.SpawnedFromMaxxInvadersBridge) return;
            if (pet.Data.BridgeProtectAnchorUserId == 0UL) return;
            if (pet.Data.BridgeDepositApproachActive) return;
            if (pet.Data.BridgeDepositStandbyActive) return;

            var anchor = BasePlayer.FindByID(pet.Data.BridgeProtectAnchorUserId);
            if (anchor == null || !anchor.IsAlive()) return;

            var taskLow = (pet.Data.BridgeLastAppliedTask ?? "").Trim().ToLowerInvariant();
            var medicEscort = setup.BridgeMedic != null && setup.BridgeMedic.Enable;
            var anchorChaseEscort = setup.BattleState != null && setup.BattleState._protectBridgeAnchorPlayer &&
                                    (taskLow == "protect" || taskLow == "follow" || taskLow == "guard" || medicEscort ||
                                     (string.IsNullOrEmpty(taskLow) && setup.BridgePatrol.RadiusMeters <= 14f));
            if (!anchorChaseEscort) return;

            try
            {
                var wantDuck = anchor.IsDucked();
                if (pet.Ducked != wantDuck)
                    pet.Ducked = wantDuck;
            }
            catch
            {
                /* ignored */
            }
        }

        private void TryBridgePatrolMoveForPet(CustomPet pet)
        {
            var setup = pet?.Data?.Setup;
            if (setup?.BridgePatrol == null || !setup.BridgePatrol.Enable) return;
            if (pet.Data == null || !pet.Data.SpawnedFromMaxxInvadersBridge) return;
            if (pet.Data.BridgeProtectAnchorUserId == 0UL) return;
            if (pet.Data.BridgeDepositApproachActive) return;
            if (pet.Data.BridgeDepositStandbyActive) return;
            if (IsBotInCombat(pet)) return;
            if (ShouldSkipBridgePatrolForTaskBrainState(pet)) return;
            if (pet.MoveController?.Navigator == null) return;

            var idleAgent = pet.MoveController.Navigator.Agent;
            if (idleAgent != null && idleAgent.isOnNavMesh && idleAgent.velocity.sqrMagnitude < 0.025f &&
                UnityEngine.Time.realtimeSinceStartup >= pet.Data.BridgeGroundSnapNextAt)
            {
                pet.Data.BridgeGroundSnapNextAt = UnityEngine.Time.realtimeSinceStartup + 0.62f;
                TrySnapBridgeNpcFeetToVisualGround(pet);
            }

            if (UnityEngine.Time.realtimeSinceStartup < pet.Data.BridgePatrolNextMoveAt) return;

            Vector3 homePos = default;
            var useHomeCupboard = pet.Data.BridgeHomeCupboardNetId != 0UL &&
                                  TryGetBridgeHomeCupboardPosition(pet, out homePos);

            Vector3 anchorPos;
            float radius;
            float minI;
            float maxI;
            float minFrac = 0.22f;
            float maxFrac = 0.9f;
            var taskLow = "";
            var anchorChaseEscort = false;
            var medicEscort = setup.BridgeMedic != null && setup.BridgeMedic.Enable;

            if (useHomeCupboard)
            {
                pet.Data.BridgeProtectAnchorIdlePrevValid = false;
                anchorPos = homePos;
                var hr = setup.BridgePatrol.HomeRoamRadiusMeters > 5f ? setup.BridgePatrol.HomeRoamRadiusMeters : 160f;
                radius = Mathf.Clamp(hr, 80f, 500f);
                minI = Mathf.Max(1.5f, setup.BridgePatrol.MinMoveIntervalSeconds * 0.55f);
                maxI = Mathf.Max(minI + 0.5f, setup.BridgePatrol.MaxMoveIntervalSeconds * 0.55f);
                minFrac = 0.48f;
                maxFrac = 0.98f;
            }
            else
            {
                var anchor = BasePlayer.FindByID(pet.Data.BridgeProtectAnchorUserId);
                if (anchor == null || !anchor.IsAlive()) return;
                anchorPos = anchor.transform.position;

                taskLow = (pet.Data.BridgeLastAppliedTask ?? "").Trim().ToLowerInvariant();
                // Protect / follow / guard = stay with streamer. Medic uses a wide patrol radius — still escort when BridgeMedic is on.
                anchorChaseEscort = setup.BattleState != null && setup.BattleState._protectBridgeAnchorPlayer &&
                    (taskLow == "protect" || taskLow == "follow" || taskLow == "guard" || medicEscort ||
                     (string.IsNullOrEmpty(taskLow) && setup.BridgePatrol.RadiusMeters <= 14f));
                if (anchorChaseEscort)
                {
                    var now = UnityEngine.Time.realtimeSinceStartup;
                    if (now >= pet.Data.BridgePatrolAnchorChaseNextAt &&
                        (!pet.Data.BridgePatrolAnchorPosValid ||
                         (anchorPos - pet.Data.BridgePatrolLastAnchorPos).sqrMagnitude > 6.25f))
                    {
                        pet.Data.BridgePatrolLastAnchorPos = anchorPos;
                        pet.Data.BridgePatrolAnchorPosValid = true;
                        pet.Data.BridgePatrolNextMoveAt = 0f;
                        pet.Data.BridgePatrolAnchorChaseNextAt = now + 0.35f;
                    }
                }

                radius = Mathf.Clamp(setup.BridgePatrol.RadiusMeters, 8f, 80f);
                if (anchorChaseEscort)
                {
                    minI = Mathf.Max(0.28f, setup.BridgePatrol.MinMoveIntervalSeconds);
                    maxI = Mathf.Max(minI + 0.12f, setup.BridgePatrol.MaxMoveIntervalSeconds);
                }
                else
                {
                    minI = Mathf.Max(2f, setup.BridgePatrol.MinMoveIntervalSeconds);
                    maxI = Mathf.Max(minI + 0.5f, setup.BridgePatrol.MaxMoveIntervalSeconds);
                }
            }

            var petPos = pet.transform.position;
            petPos.y = anchorPos.y;
            float dist = Vector3.Distance(petPos, anchorPos);

            // MaxxInvaders bridge task "protect": once close to the streamer, stand still while the streamer stands still;
            // when the streamer moves, normal patrol resumes (follow escort).
            if (!useHomeCupboard && anchorChaseEscort && (taskLow == "protect" || medicEscort))
            {
                var anchorStill = pet.Data.BridgeProtectAnchorIdlePrevValid &&
                                    (anchorPos - pet.Data.BridgeProtectAnchorIdlePrevSample).sqrMagnitude <=
                                    BridgeProtectIdleAnchorStationarySqr;
                pet.Data.BridgeProtectAnchorIdlePrevSample = anchorPos;
                pet.Data.BridgeProtectAnchorIdlePrevValid = true;

                if (anchorStill && dist <= radius * 0.92f)
                {
                    try
                    {
                        pet.MoveController?.Navigator?.Stop();
                    }
                    catch
                    {
                        /* ignored */
                    }

                    TrySnapBridgeNpcFeetToVisualGround(pet);

                    pet.Data.BridgePatrolNextMoveAt =
                        UnityEngine.Time.realtimeSinceStartup + Mathf.Max(0.28f, minI * 0.4f);
                    return;
                }
            }
            else if (!useHomeCupboard)
            {
                pet.Data.BridgeProtectAnchorIdlePrevValid = false;
            }

            Vector3 targetXZ;
            if (dist > radius * 0.97f)
            {
                var dir = petPos - anchorPos;
                dir.y = 0f;
                if (dir.sqrMagnitude < 0.01f)
                    dir = new Vector3(Random.Range(-1f, 1f), 0f, Random.Range(-1f, 1f));
                dir.Normalize();
                targetXZ = anchorPos + dir * (radius * 0.78f);
            }
            else
            {
                targetXZ = SamplePatrolPointAroundAnchor(anchorPos, radius, minFrac, maxFrac);
            }

            targetXZ.y = anchorPos.y;
            var navOk = pet.MoveController.Navigator.GetNearestNavmeshPosition(targetXZ, out var nav, 8f);
            if (navOk) targetXZ = nav;

            var mc = pet.MoveController;
                if (mc?.Navigator?.Agent != null && !mc.Navigator.Agent.isOnNavMesh)
                {
                    if (mc.Navigator.GetNearestNavmeshPosition(pet.transform.position, out var snapBot, 12f))
                    {
                        pet.transform.position = snapBot;
                        mc.Navigator.Warp(snapBot);
                        UnityEngine.Physics.SyncTransforms();
                    }
                }

            // Avoid Reset() each patrol tick while a path is still being followed — causes stop-go stepping.
            if (!useHomeCupboard && anchorChaseEscort && navOk && ShouldSkipBridgeEscortRepath(pet))
            {
                pet.Data.BridgePatrolNextMoveAt =
                    UnityEngine.Time.realtimeSinceStartup +
                    Mathf.Clamp(Random.Range(minI, maxI) * 0.5f, 0.18f, 0.85f);
                return;
            }

            // Full nav speed immediately — avoids slow ramp + per-frame Move spam from SetDestination(reset speed=0).
            if (mc?.Navigator?.Agent != null && mc.Navigator.Agent.isOnNavMesh && navOk)
                mc.SetDestinationFast(targetXZ, _ => { }, false);

            var interval = Random.Range(minI, maxI);
            if (!navOk || mc?.Navigator?.Agent == null || !mc.Navigator.Agent.isOnNavMesh)
                interval = Mathf.Min(interval, 0.5f);
            pet.Data.BridgePatrolNextMoveAt = UnityEngine.Time.realtimeSinceStartup + interval;
        }

        /// <summary>MaxxInvaders: valid tool cupboard for this bot (same OwnerID as anchor).</summary>
        private static bool TryGetBridgeHomeCupboardPosition(CustomPet pet, out Vector3 pos)
        {
            pos = default;
            if (pet?.Data == null || pet.Data.BridgeHomeCupboardNetId == 0UL) return false;
            var ent = BaseNetworkable.serverEntities.Find(new NetworkableId(pet.Data.BridgeHomeCupboardNetId)) as BaseEntity;
            if (ent == null || ent.IsDestroyed || ent is not BuildingPrivlidge) return false;
            if (pet.Data.BridgeProtectAnchorUserId != 0UL && ent.OwnerID != pet.Data.BridgeProtectAnchorUserId)
                return false;
            pos = ent.transform.position;
            return true;
        }

        private static Vector3 SamplePatrolPointAroundAnchor(Vector3 anchorPos, float radiusMeters)
        {
            return SamplePatrolPointAroundAnchor(anchorPos, radiusMeters, 0.22f, 0.9f);
        }

        private static Vector3 SamplePatrolPointAroundAnchor(Vector3 anchorPos, float radiusMeters, float minFrac,
            float maxFrac)
        {
            var ang = Random.Range(0f, Mathf.PI * 2f);
            var dist = Random.Range(radiusMeters * minFrac, radiusMeters * maxFrac);
            return anchorPos + new Vector3(Mathf.Cos(ang) * dist, 0f, Mathf.Sin(ang) * dist);
        }

        private static int PerformBridgeDepositItemTransfer(CustomPet pet, IItemContainerEntity containerEntity)
        {
            var setup = pet?.Data?.Setup;
            if (setup == null || containerEntity?.inventory == null) return -1;
            var inv = pet.inventory?.containerMain;
            if (inv == null) return -1;
            var items = Pool.Get<List<Item>>();
            items.AddRange(inv.itemList);
            var moved = 0;
            for (var i = 0; i < items.Count && containerEntity != null; i++)
            {
                var item = items[i];
                if (item == null || item.amount <= 0) continue;
                if (setup.ContainsItem(item)) continue;
                if (item.MoveToContainer(containerEntity.inventory)) moved++;
                else break;
            }

            Pool.FreeUnmanaged(ref items);
            return moved;
        }

        /// <summary>MaxxInvaders bridge bots with anchor storage: when main is full, prefer auto-deposit / standby instead of <see cref="DroppedState"/>.</summary>
        public bool ShouldDeferDroppedForBridgeAutoDeposit(CustomPet pet)
        {
            if (pet?.Data == null) return false;
            if (!pet.Data.SpawnedFromMaxxInvadersBridge || pet.Data.BridgeProtectAnchorUserId == 0UL) return false;
            if (pet.Data.Setup?.FullState == null || !pet.Data.Setup.FullState.BridgeUseAnchorOwnedStorage) return false;
            var main = pet.inventory?.containerMain;
            return main != null && main.IsFull();
        }

        /// <summary>Nearest anchor-owned <see cref="StorageContainer"/> for standby (may be full). Falls back to assigned box net id even if full.</summary>
        private static bool TryFindNearestAnchorOwnedStorageForBridgeStandby(CustomPet pet, out StorageContainer sc)
        {
            sc = null;
            var data = pet?.Data;
            var fs = data?.Setup?.FullState;
            if (fs == null || !fs.BridgeUseAnchorOwnedStorage) return false;
            if (!data.SpawnedFromMaxxInvadersBridge || data.BridgeProtectAnchorUserId == 0UL) return false;

            var ownerId = data.BridgeProtectAnchorUserId;

            if (data.BridgeDepositContainerNetId != 0UL)
            {
                var ent = BaseNetworkable.serverEntities.Find(new NetworkableId(data.BridgeDepositContainerNetId)) as BaseEntity;
                if (ent != null && !ent.IsDestroyed && ent is StorageContainer assigned &&
                    (ownerId == 0UL || ent.OwnerID == ownerId))
                {
                    sc = assigned;
                    return true;
                }
            }

            var anchor = BasePlayer.FindByID(data.BridgeProtectAnchorUserId);
            if (anchor == null || !anchor.IsAlive()) return false;

            var radius = Mathf.Clamp(fs.BridgeAnchorStorageSearchRadius, 4f, 80f);
            var list = Pool.Get<List<BaseEntity>>();
            Vis.Entities(anchor.transform.position, radius, list,
                LayerMask.GetMask("Deployed", "Construction", "Default", "World"),
                QueryTriggerInteraction.Ignore);

            StorageContainer best = null;
            var bestDist = float.MaxValue;
            foreach (var e in list)
            {
                if (e == null || e.IsDestroyed) continue;
                if (e.OwnerID != ownerId) continue;
                if (e is not StorageContainer storage) continue;
                if (storage.inventory == null) continue;
                var d = Vector3.Distance(pet.transform.position, e.transform.position);
                if (d < bestDist)
                {
                    best = storage;
                    bestDist = d;
                }
            }

            Pool.FreeUnmanaged(ref list);
            if (best == null) return false;
            sc = best;
            return true;
        }

        /// <summary>Path to storage or transfer immediately when already in range. Clears standby flags.</summary>
        private int TryBeginBridgeDepositApproach(CustomPet pet, IItemContainerEntity container)
        {
            if (pet?.Data == null || container == null) return -1;
            pet.Data.BridgeDepositStandbyActive = false;
            pet.Data.BridgeDepositStandbyNextMoveAt = 0f;
            pet.Data.BridgeDepositStandbyNextSearchAt = 0f;

            var be = container as BaseEntity;
            if (be == null || be.net == null)
            {
                pet.Data.BridgeDepositApproachActive = false;
                pet.Data.BridgeDepositApproachContainerNetId = 0UL;
                return PerformBridgeDepositItemTransfer(pet, container);
            }

            var stand = be.transform.position;
            if (pet.MoveController?.Navigator != null &&
                pet.MoveController.Navigator.GetNearestNavmeshPosition(stand, out var nav, 6f))
                stand = nav;

            if (pet.MoveController?.Navigator == null)
            {
                pet.Data.BridgeDepositApproachActive = false;
                pet.Data.BridgeDepositApproachContainerNetId = 0UL;
                return PerformBridgeDepositItemTransfer(pet, container);
            }

            if (Vector3.Distance(pet.transform.position, stand) > BridgeDepositApproachCompleteDistance)
            {
                pet.Data.BridgeDepositApproachActive = true;
                pet.Data.BridgeDepositApproachContainerNetId = be.net.ID.Value;
                pet.MoveController.SetDestinationFast(stand, _ => { }, false);
                return -3;
            }

            pet.Data.BridgeDepositApproachActive = false;
            pet.Data.BridgeDepositApproachContainerNetId = 0UL;
            return PerformBridgeDepositItemTransfer(pet, container);
        }

        /// <summary>When main is full on a bridge bot with anchor storage: walk to a free box or standby near a full/nearby box or the anchor.</summary>
        public void EnsureBridgeAutoDepositOrStandby(CustomPet pet)
        {
            if (pet?.Data == null) return;
            var main = pet.inventory?.containerMain;
            if (main == null || !main.IsFull()) return;
            if (!ShouldDeferDroppedForBridgeAutoDeposit(pet)) return;
            if (pet.Data.BridgeDepositApproachActive) return;

            if (TryFindAnchorOwnedStorageForBridge(pet, out var container) && container != null)
            {
                TryBeginBridgeDepositApproach(pet, container);
                return;
            }

            pet.Data.BridgeDepositStandbyActive = true;
            if (UnityEngine.Time.realtimeSinceStartup < pet.Data.BridgeDepositStandbyNextMoveAt) return;
            pet.Data.BridgeDepositStandbyNextMoveAt = UnityEngine.Time.realtimeSinceStartup + 8f;

            Vector3 goal;
            if (TryFindNearestAnchorOwnedStorageForBridgeStandby(pet, out var sc) && sc != null)
            {
                goal = sc.transform.position;
                var offset = UnityEngine.Random.insideUnitSphere;
                offset.y = 0f;
                if (offset.sqrMagnitude < 0.01f)
                    offset = new Vector3(1f, 0f, 0f);
                offset.Normalize();
                goal += offset * UnityEngine.Random.Range(1.2f, 2.8f);
            }
            else
            {
                var anchor = BasePlayer.FindByID(pet.Data.BridgeProtectAnchorUserId);
                if (anchor == null || !anchor.IsAlive()) return;
                var ap = anchor.transform.position;
                var ang = UnityEngine.Random.Range(0f, Mathf.PI * 2f);
                var dist = UnityEngine.Random.Range(2.5f, 4.5f);
                goal = ap + new Vector3(Mathf.Cos(ang) * dist, 0f, Mathf.Sin(ang) * dist);
                goal.y = ap.y;
            }

            if (pet.MoveController?.Navigator == null) return;
            if (pet.MoveController.Navigator.GetNearestNavmeshPosition(goal, out var navGoal, 8f))
                goal = navGoal;
            pet.MoveController.SetDestinationFast(goal, _ => { }, false);
        }

        /// <summary>Complete MaxxInvaders <c>deposit</c> after the bot reaches the storage (within <see cref="BridgeDepositApproachCompleteDistance"/> m).</summary>
        private void BridgeDepositApproachTick()
        {
            if (listNpcPlayers == null || listNpcPlayers.Count == 0) return;
            foreach (var pet in listNpcPlayers.Values)
            {
                if (pet == null || pet.IsDestroyed || !pet.IsAlive()) continue;
                var data = pet.Data;
                if (data == null) continue;

                var mainInv = pet.inventory?.containerMain;
                if (data.BridgeDepositStandbyActive && (mainInv == null || !mainInv.IsFull()))
                {
                    data.BridgeDepositStandbyActive = false;
                    data.BridgeDepositStandbyNextMoveAt = 0f;
                    data.BridgeDepositStandbyNextSearchAt = 0f;
                }

                if (data.BridgeDepositStandbyActive && !data.BridgeDepositApproachActive && mainInv != null &&
                    mainInv.IsFull() && ShouldDeferDroppedForBridgeAutoDeposit(pet))
                {
                    if (UnityEngine.Time.realtimeSinceStartup >= data.BridgeDepositStandbyNextSearchAt)
                    {
                        data.BridgeDepositStandbyNextSearchAt = UnityEngine.Time.realtimeSinceStartup + 5f;
                        if (TryFindAnchorOwnedStorageForBridge(pet, out var c) && c != null)
                            TryBeginBridgeDepositApproach(pet, c);
                    }
                }

                if (!data.BridgeDepositApproachActive) continue;

                var ent = BaseNetworkable.serverEntities.Find(new NetworkableId(data.BridgeDepositApproachContainerNetId)) as
                    BaseEntity;
                if (ent == null || ent.IsDestroyed || ent is not StorageContainer sc || sc.inventory == null ||
                    sc.inventory.IsFull())
                {
                    data.BridgeDepositApproachActive = false;
                    data.BridgeDepositApproachContainerNetId = 0UL;
                    continue;
                }

                if (data.BridgeProtectAnchorUserId != 0UL && ent.OwnerID != data.BridgeProtectAnchorUserId)
                {
                    data.BridgeDepositApproachActive = false;
                    data.BridgeDepositApproachContainerNetId = 0UL;
                    continue;
                }

                var stand = ent.transform.position;
                if (pet.MoveController?.Navigator != null &&
                    pet.MoveController.Navigator.GetNearestNavmeshPosition(stand, out var nav, 6f))
                    stand = nav;

                if (Vector3.Distance(pet.transform.position, stand) <= BridgeDepositApproachCompleteDistance)
                {
                    data.BridgeDepositApproachActive = false;
                    data.BridgeDepositApproachContainerNetId = 0UL;
                    PerformBridgeDepositItemTransfer(pet, sc);
                    continue;
                }

                // Re-issue only when path is missing or navigator stopped — SetDestinationFast calls Reset() each time;
                // calling it every 0.25s was restarting pathing constantly (stutter / "small steps").
                var mc = pet.MoveController;
                if (mc != null && (!mc.HasPath || !mc.IsMoving))
                    mc.SetDestinationFast(stand, _ => { }, false);
            }
        }

        private void OnCollectiblePickedup(CollectibleEntity collectible, CustomPet customPet, Item item)
        {
            if (customPet) customPet.CustomBrain.OnCollectiblePickedup(item);
        }
        #endregion

        #region Methods

        public string GetBotStateName(CustomPet bot)
        {
            if (bot?.CustomBrain?.currentState != null)
                return bot.CustomBrain.currentState.NameState.ToString();
            var d = bot?.Data;
            if (d?.SpawnedFromMaxxInvadersBridge == true && d.BridgeProtectAnchorUserId != 0UL)
                return "BridgePatrolIdle";
            return null;
        }

        /// <summary>Admin debug overlay: bridge bots often have no Miner/Hunter FSM target — patrol is driven by BridgePatrolTick instead.</summary>
        private static string DescribeBrainStateForDebug(CustomPet npc)
        {
            if (npc?.CustomBrain?.currentState != null)
                return npc.CustomBrain.currentState.ToString();
            var d = npc?.Data;
            if (d?.SpawnedFromMaxxInvadersBridge == true && d.BridgeProtectAnchorUserId != 0UL)
                return "Bridge patrol (idle — FSM waits for nearby loot/resources)";
            return "Not State";
        }

        public bool IsDeployableNatureEntity(BaseEntity entity) => DeployableNature?.Call<bool>("IsDeployableNature", entity) ?? false;

        public bool IsBotInCombat(CustomPet bot)
        {
            if (bot?.CustomBrain?.currentState == null) return false;

            var state = bot.CustomBrain.currentState;

            if (state is AttackerState) return true;
            else if (state is HunterState) return true;

            return false;
        }

        /// <summary>Bridge patrol must not override Miner/Medical/etc. movement — causes rubberbanding with task AI.</summary>
        private static bool ShouldSkipBridgePatrolForTaskBrainState(CustomPet pet)
        {
            var cs = pet?.CustomBrain?.currentState;
            if (cs == null) return false;
            return cs is MinerState or MedicalState or DroppedState or ResearcherState or BridgeAnchorMedicState;
        }

        /// <summary>After defending the streamer, re-apply <see cref="DataBot.BridgeLastAppliedTask"/> so gather/hunt/etc. resumes.</summary>
        private void ScheduleResumeBridgeTaskAfterDefense(CustomPet pet)
        {
            if (pet?.Data == null || !pet.Data.SpawnedFromMaxxInvadersBridge) return;
            if (string.IsNullOrEmpty(pet.Data.BridgeLastAppliedTask)) return;
            if (pet.Data.BridgeResumeAfterDefenseScheduled) return;
            var netId = pet.net?.ID.Value ?? 0UL;
            if (netId == 0UL) return;

            pet.Data.BridgeResumeAfterDefenseScheduled = true;
            pet.Data.BridgePatrolNextMoveAt = UnityEngine.Time.realtimeSinceStartup + 4f;

            timer.Once(0.25f, () =>
            {
                if (pet == null || pet.IsDestroyed || !pet.IsAlive())
                {
                    if (pet?.Data != null) pet.Data.BridgeResumeAfterDefenseScheduled = false;
                    return;
                }

                pet.Data.BridgeResumeAfterDefenseScheduled = false;
                if (IsBotInCombat(pet)) return;

                try
                {
                    ApplyBridgeTask(netId, pet.Data.BridgeProtectAnchorUserId, pet.Data.BridgeLastAppliedTask);
                }
                catch (Exception ex)
                {
                    PrintError($"[RoamingNPCs] ScheduleResumeBridgeTaskAfterDefense: {ex}");
                }
            });
        }

        public BaseCombatEntity GetBotCombatTarget(CustomPet bot)
        {
            if (bot?.CustomBrain?.currentState == null) return null;

            var state = bot.CustomBrain.currentState;

            if (state is AttackerState attackerState)
            {
                var target = attackerState.GetTargetState<BasePlayer>();
                if (target?.IsAlive() == true) return target;
            }
            else if (state is HunterState hunterState)
            {
                var target = hunterState.GetTargetState<BaseCombatEntity>();
                if (target?.IsAlive() == true) return target;
            }

            return null;
        }

        public void AlertBotToTarget(CustomPet bot, BaseCombatEntity target)
        {
            if (bot?.CustomBrain == null || target == null || !target.IsAlive()) return;

            bot.CustomBrain.OnNpcTarget(target);
        }

        public BaseEntity GetBotGatherTarget(CustomPet bot)
        {
            if (bot?.CustomBrain?.currentState == null) return null;

            var state = bot.CustomBrain.currentState;

            if (state is MinerState minerState)
            {
                var target = minerState.GetTargetState<BaseEntity>();
                if (target?.IsValid() == true) return target;
            }

            return null;
        }

        public List<CustomPet> GetBotsInRadius(Vector3 position, float radius) =>
            listNpcPlayers.Values.Where(x => x != null ? (!x.IsDestroyed && Vector3.Distance(x.transform.position, position) <= radius) : false).ToList();

        public void KillBotsUnload()
        {
            List<ulong> ids = new List<ulong>();
            ids.AddRange(listNpcPlayers.Keys);
            foreach (var id in ids) listNpcPlayers[id]?.Kill(BaseNetworkable.DestroyMode.Gib);
        }
        public void AdminKillBots()
        {
            List<ulong> ids = Pool.Get<List<ulong>>();
            ids.AddRange(listNpcPlayers.Keys);
            foreach (var id in ids) listNpcPlayers[id]?.AdminKill();
            Pool.FreeUnmanaged(ref ids);
        }
        public void InitializationBots(bool isAdminCall)
        {
            if(respawnTimers.Count > 0)
            {
                foreach(var timer in respawnTimers.Values) timer?.Destroy();
                respawnTimers.Clear();
            }
            if (listNpcPlayers.Count > 0)
            {
                AdminKillBots();
                if (isAdminCall)
                {
                    Data.Clear();
                    SaveDataBots();
                }
            }
            LoadDataBots();
            var botsDataKeys = Pool.Get<List<string>>();
            botsDataKeys.AddRange(Data.Keys);
            foreach (var key in botsDataKeys)
            {
                var data = Data[key];
                if (data == null)
                {
                    Debug.LogWarning(RU ? $"Загруженные данные бота[{key}] пустые, и будут удалены" : $"Loaded bot data[{key}] is empty, and will be deleted");
                }

                // Extract base name from key (handles both "botname" and "botname_0" formats)
                string baseName = key;
                int underscoreIndex = key.LastIndexOf('_');
                if (underscoreIndex > 0 && int.TryParse(key.Substring(underscoreIndex + 1), out _))
                {
                    baseName = key.Substring(0, underscoreIndex);
                }

                if (!config.bots.TryGetValue(baseName, out BotSetup cfg))
                {
                    object hookResult = Interface.CallHook("OnRoamingNPCDataValidate", key, data);
                    if (hookResult is bool && (bool)hookResult) continue;

                    // MaxxInvaders bridge spawns use dynamic keys "templateKey_viewerId..." (not a config row). Remove stale data quietly.
                    var staleBridgeDynamicKey = false;
                    if (config?.bots != null)
                    {
                        foreach (var botKey in config.bots.Keys.OrderByDescending(k => k.Length))
                        {
                            if (key.Length > botKey.Length + 1 && key.StartsWith(botKey + "_", StringComparison.OrdinalIgnoreCase))
                            {
                                staleBridgeDynamicKey = true;
                                break;
                            }
                        }
                    }

                    if (staleBridgeDynamicKey)
                    {
                        Interface.CallHook("OnRoamingNPCRemove", key);
                        Data.Remove(key);
                        continue;
                    }

                    Debug.LogWarning(RU ? $"Не найден конфиг бота[{key}], загруженные данные будут удалены" : $"Bot config[{key}] not found, loaded data will be deleted");
                    Interface.CallHook("OnRoamingNPCRemove", key);
                    Data.Remove(key);
                    continue;
                }
                if (cfg == null)
                {
                    Debug.LogWarning(RU ? $"Конфиг бота[{key}] пустой, загруженные данные будут удалены" : $"Bot config[{key}] is empty, loaded data will be deleted");
                    Interface.CallHook("OnRoamingNPCRemove", key);
                    Data.Remove(key);
                    continue;
                }
            }
            Pool.FreeUnmanaged(ref botsDataKeys);
            var botsData = Pool.Get<List<DataBot>>();
            foreach (var setup in config.bots)
            {
                if (!setup.Value.Enable) continue;
                int amount = setup.Value.GetAmount();

                for (int i = 0; i < amount; i++)
                {
                    string uniqueKey = amount > 1 ? $"{setup.Key}_{i}" : setup.Key;

                    if (Data.TryGetValue(uniqueKey, out var data))
                    {
#if DebugLog
                        Debug.Log(RU ? $"Загруженные данные бота[{uniqueKey}] проверены и отправлены для восстановления бота на карте" : $"Loaded bot data[{uniqueKey}] has been sent to restore the bot on the map");
#endif
                        data.Setup = setup.Value;
                        Respawn(data);
                    }
                    else
                    {
#if DebugLog
                        Debug.Log(RU ? $"Создание нового бота[{uniqueKey}] на карте" : $"Creating new bot[{uniqueKey}] on the map");
#endif
                        data = new(uniqueKey, setup.Value);
                        botsData.Add(data);
                    }
                }
            }
            foreach (var data in botsData) Respawn(data);
            SaveDataBots();
            Pool.FreeUnmanaged(ref botsData);
        }
        public CustomPet Respawn(DataBot data, bool isRespawn = false)
        {
            // Allow addons to prevent spawning (bridge spawns skip — MaxxInvaders must not be blocked here)
            if (!data.SpawnedFromMaxxInvadersBridge)
            {
                object hookResult = Interface.CallHook("OnRoamingNPCSpawn", data.NameSetup, data);
                if (hookResult is bool && !(bool)hookResult) return null;
            }

            data.IsRespawnData = isRespawn;
            Vector3 positionSpawn = data.GetSpawnPosition(this);
            var customPet = CreateNpcPlayer(positionSpawn);
            customPet.Data = data;

            if (data.DisplayName != data.Setup.Name && (string.IsNullOrEmpty(data.DisplayName) || !string.IsNullOrEmpty(data.Setup.Name))) data.DisplayName = data.Setup.Name;
            if (string.IsNullOrEmpty(data.DisplayName))
            {
                if(data.Setup.UseRandomNamesData && NicknamesData?.Count > 0)
                {
                    data.DisplayName = NicknamesData[Random.Range(0, NicknamesData.Count)];                    
                }
                else
                {                    
                    data.DisplayName = RandomUsernames.Get(Random.Range(0, 1000));
                    char chr = data.DisplayName[0];
                    data.DisplayName = string.Concat(chr.ToString().ToUpper(), data.DisplayName.Substring(1));
                }
            }

            int digits = config.GetDigits();
            int amount = data.Setup.GetAmount();

            // If Amount > 1, ignore configured id and generate random IDs to avoid collisions
            if (amount > 1)
            {
                if (data.userID == 0 || data.userID.ToString().Length != digits)
                {
                    data.userID = BotIdGenerator.GenerateBotId(customPet.GetInstanceID().ToString(), digits);
                }
            }
            else
            {
                // Single bot: use configured id if available
                ulong id = data.Setup.GetId();
                if (id != data.userID && (data.userID == 0 || id != 0)) data.userID = id;
                if (data.userID == 0 || data.userID.ToString().Length != digits || BotIdGenerator.ContainsID(data.userID)) data.userID = BotIdGenerator.GenerateBotId(customPet.GetInstanceID().ToString(), digits);
            }

            BotIdGenerator.AddID(data.userID);

            customPet.userID = data.userID;
            customPet.UserIDString = data.userID.ToString();
            // Hide vanilla nameplate for normal bots (ddraw / admin markers). MaxxInvaders bridge: show viewer
            // DisplayName on the plate — HiddenNpcNameplate still lets some clients render the numeric bot userID.
            // Important: set after userID assignment so the client doesn't briefly render a `0`.
            if (data.SpawnedFromMaxxInvadersBridge && !string.IsNullOrWhiteSpace(data.DisplayName))
            {
                var dn = data.DisplayName.Trim().Replace("<", "").Replace(">", "");
                if (dn.Length > 24) dn = dn.Substring(0, 24);
                customPet.displayName = string.IsNullOrEmpty(dn) ? HiddenNpcNameplate : dn;
            }
            else
            {
                customPet.displayName = HiddenNpcNameplate;
            }
            customPet.gameObject.AwakeFromInstantiate();
            customPet.Spawn();

            if (OnBotCreated != null) OnBotCreated.Invoke(customPet);

            return customPet;
        }
        private static CustomPet CreateNpcPlayer(Vector3 position)
        {
            BasePlayer player = GameManager.server.CreateEntity(PrefabPlayer, Vector3.zero, Quaternion.identity, false) as BasePlayer;
            FrankensteinPet pet = GameManager.server.CreateEntity(PrefabPetBot, position, Quaternion.identity, false) as FrankensteinPet;

            CustomPet npcPlayer = pet.gameObject.AddComponent<CustomPet>();
            CopySerializableFields(player, pet);
            CopySerializableFields(pet, npcPlayer);

            UnityEngine.Object.DestroyImmediate(player, true);
            UnityEngine.Object.DestroyImmediate(pet, true);

            npcPlayer.enableSaving = false;

            return npcPlayer;
        }
        private static void CopySerializableFields<T>(T src, T dst)
        {
            if (src == null)
            {
                Debug.LogWarning<T>($"Source object is null. Skipping copy.[{typeof(T).Name}]");
                return;
            }
            FieldInfo[] srcFields = typeof(T).GetFields(BindingFlags.Public | BindingFlags.Instance);
            foreach (FieldInfo field in srcFields)
            {
                object value = field.GetValue(src);
                field.SetValue(dst, value);
            }
        }
        private static void CallVoice(BasePlayer npc, BasePlayer target, string nameFile, float radius = 100f)
        {
            if (npc && !string.IsNullOrEmpty(nameFile))
            {
                if (target != null) instance?.PlayVoiceFile(npc, target, nameFile);
                else instance?.PlayVoiceFile(npc, npc.transform.position, radius, nameFile);
            }
        }
        public void RendererTextMarkerStashes(BasePlayer player, float timerDraw)
        {
            if (player == null || player?.IsConnected != true || !visibleAdminsStash.Contains(player.UserIDString))
            {
                if (player) visibleAdminsStash.Remove(player.UserIDString);
                return;
            }
            bool isAdmin = player.IsAdmin;
            if (!isAdmin) player.SetPlayerFlag(BasePlayer.PlayerFlags.IsAdmin, true);
            string text = "";
            var list = Pool.Get<List<CustomPet>>();
            list.AddRange(listNpcPlayers.Values);
            foreach (var npc in list)
            {
                foreach (var container in npc.Data.CustomMemory.GetDropContainers())
                {
                    SetInfoStash(container, npc, player, ref text);
                    player?.SendConsoleCommand("ddraw.text", timerDraw, Color.blue, container.transform.position + Vector3.up * 1.2f, text);
                }

            }
            Pool.FreeUnmanaged(ref list);
            if (!isAdmin) player.SetPlayerFlag(BasePlayer.PlayerFlags.IsAdmin, false);

            player.Invoke(() => RendererTextMarkerStashes(player, timerDraw), timerDraw);
        }
        public void SetInfoStash(DropContainer container, CustomPet npc, BasePlayer player, ref string text)
        {
            text = "<size=16>";
            text += "Stash: " + container?.entity.ShortPrefabName + $"[{npc.GetResolvedDisplayName()}]";
            text += $"\nDistance[{player.Distance(container.entity):0.0 m}]";
            text += "</size>";
        }
        public void RendererTextMarkerBots(BasePlayer player, float timerDraw)
        {
            if (player == null || player?.IsConnected != true || !visibleAdmins.Contains(player.UserIDString))
            {
                if (player) visibleAdmins.Remove(player.UserIDString);
                return;
            }
            bool isAdmin = player.IsAdmin;
            if (!isAdmin) player.SetPlayerFlag(BasePlayer.PlayerFlags.IsAdmin, true);
            string text = "";
            var list = Pool.Get<List<CustomPet>>();
            list.AddRange(listNpcPlayers.Values);
            float up = 2.2f;
            
            foreach (var npc in list)
            {
                SetInfoBot(npc, player, ref text);
                player?.SendConsoleCommand("ddraw.text", timerDraw, Color.yellow, npc.transform.position + Vector3.up * up, text);
#if DebugLog
                npc.MoveController.DrawPatch(player, timerDraw);
                if (npc?.CustomBrain?.currentState?.HasTarget == true)
                {
                    player?.SendConsoleCommand("ddraw.text", timerDraw, Color.red, npc.CustomBrain.currentState.TargetPosition + Vector3.up * 1, $"<size=14>{npc} target</size>");
                }
#endif
            }
            Pool.FreeUnmanaged(ref list);
            if (!isAdmin) player.SetPlayerFlag(BasePlayer.PlayerFlags.IsAdmin, false);

            player.Invoke(() => RendererTextMarkerBots(player, timerDraw), timerDraw);
        }
        public void SetInfoBot(CustomPet npc, BasePlayer player, ref string text)
        {
            text = "<size=16>";
            // Hide bot name and long user-id digits in admin marker text (player still sees health/state).
            text += $"({npc.GetPersonality()})";
            text += $"\nDistance[{npc.Distance(player):0.0 m}]";
            text += $"   Health: {npc.Health() / npc.MaxHealth():0%}";
            text += $"\nState: {DescribeBrainStateForDebug(npc)}";
            text += "</size>";
        }
        public void UpdateInfoUI()
        {
            var list = Pool.Get<List<CustomPet>>();
            Dictionary<string, string> info = Pool.Get<Dictionary<string, string>>();
            list.AddRange(listNpcPlayers.Values);
            string text = "";
            foreach (var npc in list)
            {
                if (npc != null)
                {
                    SetInfoUI(npc, ref text);
                    info.Add(npc.GetResolvedDisplayName(), text);
                }
            }
            try
            {
                Interface.Oxide.CallHook("UpdatePluginInfo", Name, info);
            }
            finally
            {
                Pool.FreeUnmanaged(ref info);
                Pool.FreeUnmanaged(ref list);
            }
        }
        public void SetInfoUI(CustomPet npc, ref string text)
        {
            // text = $"<size=9>Total hook time: {TotalHookTime:0.00 s},    Total hook memory: {TotalHookMemory.FormatBytes()}</size>\n";
            text = "";
            text += $"\n{npc.ToString()}";
            text += $"\nPersonality[{npc.GetPersonality()}]";
            text += $"\nPosition[{npc.transform.position}]";
            text += $"\nHealth: {npc.Health() / npc.MaxHealth():0%}({npc.Health():0.0}/{npc.MaxHealth():0.0})";
            text += $"\nIn water[{npc.InWaterState}]";
            text += $"\nIn diving[{npc.InDiving}]";
            text += $"\nIn ducking[{npc.Ducked}({npc.modelState.ducking:0.0})]";
            text += $"\nHydration[{(npc.metabolism.hydration.value / npc.metabolism.hydration.max):0%} ({npc.metabolism.hydration.value:0.0}/{npc.metabolism.hydration.max:0.0})]";
            text += $"\nCalories[{(npc.metabolism.calories.value / npc.metabolism.calories.max):0%} ({npc.metabolism.calories.value:0.0}/{npc.metabolism.calories.max:0.0})]";
            text += $"\nRadiation level[{npc.metabolism.radiation_level.value:0.0}/{npc.metabolism.radiation_level.max:0.0}]";
            text += $"\nRadiation poison[{(npc.metabolism.radiation_poison.value / npc.metabolism.radiation_poison.max):0%} ({npc.metabolism.radiation_poison.value:0.0}/{npc.metabolism.radiation_poison.max:0.0})]";
            text += $"\nInSafeZone: {npc.InSafeZone()}";
            text += $"\n\nState: {DescribeBrainStateForDebug(npc)}";
            if (npc.MoveController != null) text += $"\n{npc.MoveController}";
        }
        public void SaveBots()
        {
            foreach (var bot in listNpcPlayers.Values)
            {
                bot?.OnServerSave();
            }
            SaveDataBots();
        }
        public static bool CheckRoad(Vector3 position)
        {
            return DoCheckSphereTag(position, 1f, GameObjectTag.Road, "World");
        }
        public static bool DoCheckSphereTag(Vector3 position, float radius, GameObjectTag tag, params string[] layers)
        {
            List<Collider> obj = Pool.Get<List<Collider>>();
            GamePhysics.OverlapSphere(position, radius, obj, LayerMask.GetMask(layers), QueryTriggerInteraction.Collide);
            bool flag = false;
            for (int i = 0; i < obj.Count; i++)
            {
                Collider collider = obj[i];
                if (collider != null && collider.gameObject.HasCustomTag(tag))
                {
                    flag = true;
                    break;
                }
            }

            return flag;
        }
        public static bool TryGetRandomMapPoint(float cycle, out Vector3 result)
        {
            result = Vector3.zero;

            while (cycle > 0)
            {
                cycle--;
                Vector3 size = TerrainMeta.Size / 2f;
                float x = Random.Range(-size.x, size.x);
                float z = Random.Range(-size.z, size.z);
                Vector3 position = new Vector3(x, 0, z);
                HeightMap.ToGroundPoint(ref position);
                if (NavMesh.SamplePosition(position, out var hit, 1f, 1 << NavMesh.GetAreaFromName("Walkable")))
                {
                    position = hit.position;
                }
                else continue;

                bool noWater = !WaterLevel.Test(position, true, true) && Physics.OverlapSphere(position, 10f, LayerMask.GetMask("Water")).Length == 0;
                bool noMonuments = Physics.OverlapSphere(position, 50f, LayerMask.GetMask("Prevent Building")).Length == 0;
                bool noCupboards = Physics.OverlapSphere(position, 50f, LayerMask.GetMask("Default", "Construction", "Deployed")).Where((x) => x.ToBaseEntity() is BuildingPrivlidge).Count() == 0;
                bool noPlayers = Physics.OverlapSphere(position, 50f, LayerMask.GetMask("Player (Server)", "Player Movement")).Length == 0;

                bool noIceAndCliffs = true;

                foreach (var collider in Physics.OverlapSphere(position, 5f, LayerMask.GetMask("Default", "World")))
                {
                    if(collider.name.Contains("ice_sheet") || collider.name.Contains("iceberg") || collider.name.Contains("shore_ice") || collider.name.Contains("cliff") || collider.name.Contains("rocks") || collider.name.Contains("rock_formation"))
                    {
                        noIceAndCliffs = false;
                        break;
                    }
                }

                NavMeshHit navHit;
                bool onNavMesh = NavMesh.SamplePosition(position, out navHit, 5f, NavMesh.AllAreas);

                if (noWater && noCupboards && noMonuments && noPlayers && noIceAndCliffs && onNavMesh)
                {
                    result = position;
                    break;
                }
            }

            return result != Vector3.zero;
        }
        public static bool TryGetRandomRoadPoint(float cycle, BotSetup.RoadSpawnMode roadSpawnMode, out Vector3 result)
        {
            result = Vector3.zero;

            List<PathList> targetPathList;

            switch(roadSpawnMode)
            {
                case BotSetup.RoadSpawnMode.MainRoads:
                    targetPathList = TerrainMeta.Path.MainRoads;
                    break;
                
                case BotSetup.RoadSpawnMode.SideRoads:
                    targetPathList = TerrainMeta.Path.SideRoads;
                    break;

                case BotSetup.RoadSpawnMode.TrailRoads:
                    targetPathList = TerrainMeta.Path.TrailRoads;
                    break;

                case BotSetup.RoadSpawnMode.Rails:
                    targetPathList = TerrainMeta.Path.Rails;
                    break;

                default:
                    targetPathList = TerrainMeta.Path.Roads;
                    break;
            }

            if(targetPathList == null || targetPathList?.Count == 0) return false;

            while (cycle > 0)
            {
                cycle--;
                
                Vector3 position = TerrainMeta.Path.Roads.GetRandom().Path.Points.GetRandom();
                HeightMap.ToGroundPoint(ref position);
                if (NavMesh.SamplePosition(position, out var hit, 1f, 1 << NavMesh.GetAreaFromName("Walkable")))
                {
                    position = hit.position;
                }
                else continue;

                bool noMonuments = true;
                bool noPlayers = Physics.OverlapSphere(position, 50f, LayerMask.GetMask("Player (Server)", "Player Movement")).Length == 0;

                foreach (var monument in instance.monuments.allMonuments)
                {
                    if (monument.IsInBounds(position))
                    {
                        noMonuments = false;
                        break;
                    }
                    if (Vector3.Distance(monument.transform.position, position) <= monument.Bounds.size.x || Vector3.Distance(monument.transform.position, position) <= 40f)
                    {
                        noMonuments = false;
                        break;
                    }
                }

                if (noMonuments && noPlayers)
                {
                    result = position;
                    break;
                }
            }

            return result != Vector3.zero;
        }

        #endregion

        #region Commands
        [Command("rnpc"), Permission(AdminPermission)]
        void CmdNpc(IPlayer iPlayer, string command, string[] args)
        {
            var admin = iPlayer.Object as BasePlayer;
            if(admin == null) return;
            if (args.Length == 0)
            {
                iPlayer.Reply(RU ? "Доступные команды: /rnpc create" : "Available commands: /rnpc create");
            }
            else switch (args[0].ToLower())
                {
                    case "vis":
                        if (visibleAdmins.Contains(iPlayer.Id))
                        {
                            visibleAdmins.Remove(iPlayer.Id);
                            iPlayer.Reply("Off visible markers");
                            return;
                        }
                        else
                        {
                            visibleAdmins.Add(iPlayer.Id);
                            admin.Invoke(() => RendererTextMarkerBots(admin, 0.2f), 0.1f);
                            iPlayer.Reply("On visible markers");
                            return;
                        }
                    case "reinit":
                        var npcs = new List<CustomPet>(listNpcPlayers.Values);
                        for (int i = listNpcPlayers.Count - 1; i >= 0; i--)
                        {
                            npcs[i].TriggerPeriodicRespawn();
                        }
                        return;
                    case "checkpos":
                        bool noWater = !WaterLevel.Test(admin.transform.position, true, true) && Physics.OverlapSphere(admin.transform.position, 10f, LayerMask.GetMask("Water")).Length == 0;
                        bool noMonuments = Physics.OverlapSphere(admin.transform.position, 50f, LayerMask.GetMask("Prevent Building")).Length == 0;
                        bool noCupboards = Physics.OverlapSphere(admin.transform.position, 50f, LayerMask.GetMask("Default", "Construction", "Deployed")).Where((x) => x.ToBaseEntity() is BuildingPrivlidge).Count() == 0;
                        bool noPlayers = Physics.OverlapSphere(admin.transform.position, 50f, LayerMask.GetMask("Player (Server)", "Player Movement")).Length == 0;

                        admin.ChatMessage($"No Water: {noWater}");
                        admin.ChatMessage($"No Monuments: {noMonuments}");
                        admin.ChatMessage($"No Cupboards: {noCupboards}");
                        admin.ChatMessage($"No Players: {noPlayers}");
                        return;
                    case "stashvis":
                        {
                            if (visibleAdminsStash.Contains(iPlayer.Id))
                            {
                                visibleAdminsStash.Remove(iPlayer.Id);
                                iPlayer.Reply("Off stash visible markers");
                                return;
                            }
                            else
                            {
                                visibleAdminsStash.Add(iPlayer.Id);
                                admin.Invoke(() => RendererTextMarkerStashes(admin, 1f), 0.1f);
                                iPlayer.Reply("On stash visible markers");
                                return;
                            }
                        }
                    case "infoui":
                        {
                            if (_timer == null || _timer.Destroyed)
                            {
                                _timer = timer.Every(0.2f, UpdateInfoUI);
                                iPlayer.Reply("On update info UI");
                            }
                            else
                            {
                                timer.Destroy(ref _timer);
                                iPlayer.Reply("Off update info UI");
                            }
                            return;
                        }
                    case "killall":
                        AdminKillBots();
                        listNpcPlayers.Clear();
                        Data.Clear();
                        SaveDataBots();
                        break;
                    case "init":
                        Interface.Oxide.CallHook("InitRoamingBots");
                        InitializationBots(true);
                        break;
                    case "tp":
                        foreach (var npc in listNpcPlayers.Values)
                        {
                            if (npc)
                            {
                                npc.CustomBrain.ChangeState(null);
                                npc.Teleport(iPlayer.Object as BasePlayer);
                            }
                        }
                        break;
                    case "totp":
                        {
                            CustomPet bot = null;
                            float dist = float.MaxValue;
                            foreach (var npc in listNpcPlayers.Values)
                            {
                                if (npc)
                                {
                                    if ((iPlayer.Object as BasePlayer).Distance(npc) < dist)
                                    {
                                        bot = npc;
                                        dist = (iPlayer.Object as BasePlayer).Distance(npc);
                                    }
                                }
                            }
                            if (bot) (iPlayer.Object as BasePlayer).Teleport(bot);
                            break;
                        }
                    case "recvoice":
                        {
                            Cmd_RecVoice(iPlayer, command, args.Skip(1));
                            break;
                        }


                    default: break;
                }
        }
        #endregion

        #region EntityComponents
        public interface IEntity<T>
        {
        }
        public class EntityComponent<T> : PluginEntityComponent, IEntity<T> where T : BaseCombatEntity
        {
            public T entity;
            public ulong SkinID => entity.skinID;

            #region UnityCallbacks
            protected override void Awake()
            {
                base.Awake();
                entity = owner as T;
            }

            #endregion

            #region Methods
            public override void KillImmediate()
            {
                DestroyImmediate(this);
            }
            #endregion
        }
        public abstract class PluginEntityComponent : FacepunchBehaviour
        {
            private static Dictionary<ulong, PluginEntityComponent> _componentsNetID;
            protected BaseEntity owner;
            public virtual Vector3 ServerPosition => owner?.transform.position ?? Vector3.zero;
            public virtual Quaternion ServerRotation => owner?.ServerRotation ?? Quaternion.identity;
            protected ulong netId;
            public bool IsDestroyed { get; private set; }
            public virtual bool IsValid => owner?.IsValid() == true && !IsDestroyed;

            #region UnityCallbacks
            protected virtual void Awake()
            {
                owner = gameObject.GetComponent<BaseEntity>();
                netId = owner.net.ID.Value;
                if (TryGetComponent<PluginEntityComponent>(owner, out var component))
                {
                    DestroyImmediate(component);
                }
                _componentsNetID.Add(netId, this);
            }
            protected virtual void OnDestroy()
            {
                IsDestroyed = true;
                _componentsNetID?.Remove(netId);
            }
            #endregion

            #region AbstractMethods
            public abstract void KillImmediate();
            #endregion

            #region Methods
            public ulong GetId() => netId;
            public virtual T GetEntity<T>() where T : BaseEntity => owner as T;
            #endregion

            #region StaticMethods
            public static T Create<T>(BaseEntity parent) where T : PluginEntityComponent
            {
                T result = null;
                if(!typeof(T).IsAbstract && parent != null)
                {
                    result = parent.gameObject.AddComponent<T>();
                }
                return result;
            }
            public static bool TryGetComponent<T>(BaseEntity entity, out T component) where T : PluginEntityComponent
            {
                component = null;
                if (entity?.net != null && _componentsNetID?.TryGetValue(entity.net.ID.Value, out var result) == true) component = result as T;
                return component != null;
            }
            public static bool Contains(BaseEntity entity) => entity?.net != null && _componentsNetID?.ContainsKey(entity.net.ID.Value) == true;
            public static void InitPlugin() => _componentsNetID = new();
            public static void UnloadPlugin()
            {
                if (_componentsNetID != null)
                {
                    var list = Pool.Get<List<PluginEntityComponent>>();
                    list.AddRange(_componentsNetID.Values);
                    foreach (var component in list) component.KillImmediate();
                    Pool.FreeUnmanaged(ref list);
                }
                _componentsNetID = null;
            }
            public static void UnloadPlugin<T>() where T : PluginEntityComponent
            {
                if (_componentsNetID != null)
                {
                    var list = Pool.Get<List<PluginEntityComponent>>();
                    foreach(var item in _componentsNetID.Values)
                    {
                        if (item is T) list.Add(item);
                    }
                    foreach (var component in list) component.KillImmediate();
                    Pool.FreeUnmanaged(ref list);
                }
                _componentsNetID = null;
            }
            #endregion
        }
        #endregion

        #region BotComponent
        public class CustomPet : FrankensteinPet
        {
            public CapsuleCollider capsule;
            public static float ThinkUpdate => 0.01f;
            public float ThinkController => Data?.Setup?.Controller?.GetTimerTickController() ?? 0.1f;
            public float ThinkBrain => Data?.Setup?.Controller?.GetTimerTickBrain() ?? 0.1f;
            public DataBot Data;

            /// <summary>World nameplate may be cleared for MaxxInvaders bridge; use stored Data.DisplayName for UI/logs.</summary>
            public string GetResolvedDisplayName() =>
                !string.IsNullOrEmpty(displayName) && displayName != HiddenNpcNameplate
                    ? displayName
                    : Data?.DisplayName ?? "";

            private Brain customBrain;
            private MoveController moveController;
            public Brain CustomBrain => customBrain;
            public MemoryBot CustomMemory => Data?.CustomMemory;
            public MoveController MoveController => moveController;
            private BaseEntity targetCurrentAttack;
            private BaseMelee meleeCurrentAttack;
            private bool isNPC = true;
            private bool inWater;
            private bool inDiving;
            private Timer periodicRespawnTimer;
            public float AccuracyOfFire => Data?.Setup?.Controller?.GetAccuracyOfFire() ?? 1f;
            public override bool IsNpc => isNPC;
            public bool IsInitBot { get; private set; }
            public bool InWaterState => inWater;
            public bool InDiving => inDiving;
            public int TimesWounded;
            public bool Ducked
            {
                get
                {
                    if (inWater)
                    {
                        modelState.ducked = false;
                        if (modelState.ducking > 0.5f)
                        {
                            modelState.ducking = 0;
                        }
                        SendNetworkUpdate();
                    }
                    return modelState.ducking > 0.5f && modelState.ducked;
                }
                set
                {
                    if (inWater)
                    {
                        modelState.ducked = false;
                        if (modelState.ducking > 0.5f)
                        {
                            modelState.ducking = 0;
                        }
                        SendNetworkUpdate();
                        return;
                    }
                    modelState.ducked = value;
                    if (value)
                    {
                        if (modelState.ducking <= 0.5f)
                        {
                            modelState.ducking = 1;
                            SendNetworkUpdate();
                        }
                    }
                    else
                    {
                        if (modelState.ducking > 0.5f)
                        {
                            modelState.ducking = 0;
                            SendNetworkUpdate();
                        }
                    }
                }
            }


            #region UnityCallbacks
            private void FixedUpdate()
            {
                float factor = WaterFactor();
                if (factor <= 0.7f) factor = 0;
                if (factor == 0)
                {
                    if (inWater) inWater = false;
                    if (inDiving) SetNotDiving();
                    if (modelState.waterLevel != 0)
                    {
                        modelState.waterLevel = 0;
                        SendNetworkUpdate();
                    }
                }
                else
                {
                    if (!inWater) inWater = true;
                    if (factor > 0.8f && !inDiving) inDiving = true;
                    if (modelState.waterLevel != factor)
                    {
                        modelState.waterLevel = factor;
                        SendNetworkUpdate();
                    }
                }
            }
            private void Awake()
            {
                capsule = gameObject.GetComponent<CapsuleCollider>();
                if (customBrain == null) customBrain = Pool.Get<Brain>().Init<Brain>(this);
                if (moveController == null) moveController = Pool.Get<MoveController>().Init<MoveController>(this);
            }
            private void OnDestroy()
            {
                if (customBrain != null) Pool.Free(ref customBrain);
                if (moveController != null) Pool.Free(ref moveController);
            }
            #endregion

            #region Methods
            private void SetNotDiving()
            {
                inDiving = false;
                Vector3 pos = transform.position;
                pos.y = TerrainMeta.HeightMap.GetHeight(pos);
                if(MoveController?.Navigator != null)
                {
                    if(MoveController.Navigator.GetNearestNavmeshPosition(pos, out var pos2, 1f)) MoveController.Navigator.Warp(pos2);
                    else Suicide();
                }
            }
            public override void Spawn()
            {
                base.Spawn();
                instance.listNpcPlayers.Add(net.ID.Value, this);
                spawnDeployableCorpseOnDeath = false;
                InitSettings();
                if (IsInitBot)
                {
                    instance.Data.AddBot(Data);
                    customBrain?.Start();
                    moveController?.Start();
                    InvokeRepeating(Think, ThinkUpdate, ThinkUpdate);
                    StartPeriodicRespawnTimer();
                    Interface.Oxide.CallHook("OnSpawnedRoamingNPC", this);
                }
                else
                {
                    Debug.LogError<CustomPet>(RU ? $"Spawn: Не заданы настройки бота." : $"Spawn: Bot settings are not set.");
                    Invoke(AdminKill, 0.1f);
                    return;
                }
            }
            public void Suicide()
            {
                lastAttacker = null;

                // Debug.LogTest<CustomPet>($"Suicide: {displayName}[{MaxHealth() * 2}]");
                using (TimeWarning.New("Hurt"))
                {
                    HitInfo obj = Pool.Get<HitInfo>();
                    obj.Init(null, this, DamageType.Suicide, MaxHealth() * 2, base.transform.position);
                    obj.UseProtection = false;
                    Die(obj);
                    Pool.Free(ref obj);
                }
            }
            public override void Hurt(HitInfo info)
            {
                info?.damageTypes?.Scale(DamageType.Drowned, inDiving ? Data.Setup.Controller.RateDamageWater : 0f);
                info?.damageTypes?.Scale(DamageType.Decay, 0);
                if (info?.Initiator != null && info.Initiator != this)
                {
                    info.damageTypes.ScaleAll(Data.Setup.Controller.GetScaleDamageFrom(info.Initiator));
                }

#if DebugLog
                DamageType damageType = info?.damageTypes?.GetMajorityDamageType() ?? 0;
                float damage = info?.damageTypes?.Total() ?? 0;
                if (damage != 0) Debug.Log<CustomPet>(RU ? $"[{damageType}] общий урон: {damage}" : $"[{damageType}] total damage: {damage}");
#endif

                base.Hurt(info);
            }
            public override BaseCorpse CreateCorpse(PlayerFlags flagsOnDeath, Vector3 posOnDeath, Quaternion rotOnDeath, List<TriggerBase> triggersOnDeath, bool forceServerSide = false)
            {
                Data.ClearInventory();
                if (Data.CanLockWear && !Data.Setup.KeepClothesNPCCorpse)
                {
                    Data.SaveWearInventory(inventory.containerWear);
                    inventory.containerWear.Clear();
                }
                if (!Data.CanDropBeltInventory)
                {
                    Data.SaveBeltInventory(inventory.containerBelt);
                    inventory.containerBelt.Clear();
                }

                List<Item> allItems = new List<Item>();
                inventory.GetAllItems(allItems);

                if(allItems != null)
                {
                    for (int i = allItems.Count - 1; i >= 0; i--)
                    {
                        var item = allItems[i];
                        if(item != null)
                        {
                            var found = Data.Setup.itemsGiveBot.Where(
                                (x) => x.ItemConfig.SkinID == item.skin && (x.ItemConfig.shortNameOrId == item.info.shortname || x.ItemConfig.shortNameOrId == item.info.itemid.ToString())
                            ).ToList();
                            if (found.Count > 0)
                            {
                                if(found[0].ItemConfig.enableDropChance && Random.Range(0, 100) >= found[0].ItemConfig.dropChance)
                                {
                                    item.RemoveFromContainer();
                                }
                            }
                        }
                    }
                }

                if(Data.DeathItemsBlacklist != null)
                {
                    if(Data.DeathItemsBlacklist.Count > 0)
                    {
                        if(allItems != null)
                        {
                            for (int i = allItems.Count - 1; i >= 0; i--)
                            {
                                var item = allItems[i];
                                if(item != null)
                                {
                                    if (Data.DeathItemsBlacklist.Where(
                                        (x) => x.SkinID == item.skin && (x.shortNameOrId == item.info.shortname || x.shortNameOrId == item.info.itemid.ToString())
                                    ).Count() > 0)
                                    {
                                        item.RemoveFromContainer();
                                    }
                                }
                            }
                        }
                    }
                }

                BaseCorpse corpse;
                switch (Data.Setup.Corpse)
                {
                    case DeadCorpse.NpcCorpse: corpse = CreateNPCPlayerCorpse(flagsOnDeath, posOnDeath, rotOnDeath, triggersOnDeath, forceServerSide); break;
                    case DeadCorpse.PlayerCorpse: corpse = CreatePlayerCorpse(flagsOnDeath, posOnDeath, rotOnDeath, triggersOnDeath, forceServerSide); break;
                    case DeadCorpse.Backpack:
                    default: corpse = null; break;
                }

                if (!CollectionEx.IsNullOrEmpty(triggersOnDeath))
                {
                    foreach (TriggerBase item2 in triggersOnDeath)
                    {
                        if (item2 is TriggerParent triggerParent)
                        {
                            triggerParent.ForceParentEarly(corpse);
                        }
                    }
                }
                if (!corpse) DroppedBackpack();
                return corpse;
            }
            private void DroppedBackpack()
            {
                var backpack = GameManager.server.CreateEntity("assets/prefabs/misc/item drop/item_drop_backpack.prefab", ServerPosition, Quaternion.identity) as DroppedItemContainer;
                ItemContainer[] source = new ItemContainer[3];
                source[0] = inventory.containerMain;
                source[1] = inventory.containerWear;
                source[2] = inventory.containerBelt;
                if (backpack)
                {
                    backpack.TakeFrom(source, Data.Setup.DestroyPercent());
                    backpack.EnableSaving(false);
                    backpack.Spawn();

                    if(backpack?.inventory?.itemList?.Count == 0) backpack?.Kill();
                }
            }
            private PlayerCorpse CreateNPCPlayerCorpse(PlayerFlags flagsOnDeath, Vector3 posOnDeath, Quaternion rotOnDeath, List<TriggerBase> triggersOnDeath, bool forceServerSide = false)
            {
                using (TimeWarning.New("Create corpse"))
                {
                    NPCPlayerCorpse nPCPlayerCorpse = DropCorpse(CorpsePath, flagsOnDeath, modelState) as NPCPlayerCorpse;
                    if ((bool)nPCPlayerCorpse)
                    {
                        if (NavAgent != null)
                        {
                            nPCPlayerCorpse.transform.position += Vector3.down * NavAgent.baseOffset;
                        }

                        nPCPlayerCorpse.SetLootableIn(2f);
                        nPCPlayerCorpse.SetFlag(Flags.Reserved5, HasPlayerFlag(PlayerFlags.DisplaySash));
                        nPCPlayerCorpse.SetFlag(Flags.Reserved2, b: true);
                        if (CopyInventoryToCorpse)
                        {
                            nPCPlayerCorpse.TakeFrom(this, inventory.containerMain, inventory.containerWear, inventory.containerBelt);
                        }
                        else
                        {
                            nPCPlayerCorpse.CreateEmptyContainer(inventory.containerMain.capacity);
                        }

                        nPCPlayerCorpse.playerName = (string.IsNullOrEmpty(displayName) || displayName == HiddenNpcNameplate) &&
                            Data != null
                            ? Data.DisplayName
                            : displayName;
                        nPCPlayerCorpse.playerSteamID = userID;
                        nPCPlayerCorpse.Spawn();
                        if (ShouldCorpseTakeChildren)
                        {
                            nPCPlayerCorpse.TakeChildren(this);
                        }

                        ApplyLoot(nPCPlayerCorpse);
                    }

                    return nPCPlayerCorpse;
                }
            }
            private PlayerCorpse CreatePlayerCorpse(PlayerFlags flagsOnDeath, Vector3 posOnDeath, Quaternion rotOnDeath, List<TriggerBase> triggersOnDeath, bool forceServerSide = false)
            {
                using (TimeWarning.New("Create corpse"))
                {
                    string strCorpsePrefab = ((!(ConVar.Physics.serversideragdolls || forceServerSide)) ? "assets/prefabs/player/player_corpse.prefab" : "assets/prefabs/player/player_corpse_new.prefab");
                    bool flag = false;
                    if (ConVar.Global.cinematicGingerbreadCorpses)
                    {
                        foreach (Item item in inventory.containerWear.itemList)
                        {
                            if (item != null && item.info.TryGetComponent<ItemCorpseOverride>(out var component))
                            {
                                strCorpsePrefab = ((GetFloatBasedOnUserID(userID, 4332uL) > 0.5f) ? component.FemaleCorpse.resourcePath : component.MaleCorpse.resourcePath);
                                flag = component.BlockWearableCopy;
                                break;
                            }
                        }
                    }

                    PlayerCorpse playerCorpse = DropCorpse(strCorpsePrefab, posOnDeath, rotOnDeath, flagsOnDeath, modelState) as PlayerCorpse;
                    if ((bool)playerCorpse)
                    {
                        playerCorpse.SetFlag(Flags.Reserved5, HasPlayerFlag(PlayerFlags.DisplaySash));
                        if (!flag)
                        {
                            playerCorpse.TakeFrom(this, inventory.containerMain, inventory.containerWear, inventory.containerBelt);
                        }

                        playerCorpse.playerName = (string.IsNullOrEmpty(displayName) || displayName == HiddenNpcNameplate) &&
                            Data != null
                            ? Data.DisplayName
                            : displayName;
                        playerCorpse.playerSteamID = userID;
                        playerCorpse.Spawn();
                        playerCorpse.TakeChildren(this);
                        ResourceDispenser component2 = playerCorpse.GetComponent<ResourceDispenser>();
                        int num = 2;
                        if (lifeStory != null)
                        {
                            num += Mathf.Clamp(Mathf.FloorToInt(lifeStory.secondsAlive / 180f), 0, 20);
                        }

                        component2.containedItems.Add(new ItemAmount(ItemManager.FindItemDefinition("fat.animal"), num));
                        return playerCorpse;
                    }
                }

                return null;
                static float GetFloatBasedOnUserID(ulong steamid, ulong seed)
                {
                    UnityEngine.Random.State state = UnityEngine.Random.state;
                    UnityEngine.Random.InitState((int)(seed + steamid));
                    float result = UnityEngine.Random.Range(0f, 1f);
                    UnityEngine.Random.state = state;
                    return result;
                }
            }
            public override void OnDied(HitInfo info)
            {
                float t = Data?.Setup?.GetTimerRespawn() ?? 0;
                Data?.OnDied();
                if(t > 0)
                {
                    ulong user = userID;
                    DataBot data = Data;
                    if(!instance?.respawnTimers?.ContainsKey(user) ?? false)
                    {                        
                        instance?.respawnTimers?.Add(user, instance.timer.Once(t, () =>
                        {
                            instance?.respawnTimers?.Remove(user);
                            instance?.Respawn(data, true);
                        }));
                    }
                }

#if DebugLog
                Debug.Log<CustomPet>(RU ? $"Бот[{displayName}] мертв[{info?.damageTypes?.GetMajorityDamageType()}], возрождение через {t} секунд." : $"Bot[{displayName}] is dead[{info?.damageTypes.GetMajorityDamageType()}], respawn in {t} seconds.");
#endif

                base.OnDied(info);
            }
            public override void OnAttacked(HitInfo info)
            {
                CustomBrain?.OnNpcTarget(info?.Initiator as BaseCombatEntity);
                base.OnAttacked(info);
            }
            public override void AdminKill()
            {
                StopPeriodicRespawnTimer();
                instance.Data.RemoveBot(ref Data);
                base.AdminKill();
            }
            public override void OnKilled()
            {
                StopPeriodicRespawnTimer();
                instance.listNpcPlayers.Remove(net.ID.Value);
                Interface.CallHook("OnRoamingNPCKilled", this);
                base.OnKilled();
            }
            public void OnServerSave()
            {
                if (this.IsValid()) Data.OnSaveServer(this);
            }
            public override void Save(SaveInfo info)
            {
                base.Save(info);
            }
            private void Think()
            {
                float delta = ThinkUpdate;
                try
                {
                    // Debug.CallTest<CustomPet>($"Think [{displayName}]", () => {
                    customBrain?.Think(delta);
                    moveController?.Think(delta);
                    // });
                }
                catch (Exception ex)
                {
                    Debug.LogError<CustomPet>($"Think: {ex}");
                }
            }

            #region Periodic Respawn

            private bool HasPlayersNearby(float radius)
            {
                Collider[] colliders = Physics.OverlapSphere(transform.position, radius, LayerMask.GetMask("Player (Server)"));

                foreach (var collider in colliders)
                {
                    if (collider != null)
                    {
                        var ent = collider.ToBaseEntity();

                        if (ent != null)
                        {
                            if (ent is BasePlayer player)
                            {
                                if (player.userID.IsSteamId())
                                {
                                    return true;
                                }
                            }
                        }
                    }
                }
                
                return false;
            }

            private bool CanPeriodicRespawn()
            {
                if (Data?.Setup?.EnablePeriodicRespawn != true) return false;
                if (HasPlayersNearby(Data.Setup.GetPeriodicRespawnPlayerCheckRadius())) return false;

                if (CustomBrain?.currentState is AttackerState or HunterState) return false;

                return true;
            }

            private void CheckPeriodicRespawn()
            {
                if (CanPeriodicRespawn()) TriggerPeriodicRespawn();
            }

            public void TriggerPeriodicRespawn()
            {
                if (this.IsValid() && Data != null)
                {
                    Data.OnSaveServer(this);
                    StopPeriodicRespawnTimer();

                    instance.listNpcPlayers.Remove(net.ID.Value);
                    instance.timer.Once(0.1f, () => instance?.Respawn(Data, false));

                    base.AdminKill();
                }
            }

            private void StartPeriodicRespawnTimer()
            {
                if (Data?.Setup?.EnablePeriodicRespawn != true) return;

                float interval = Data.Setup.GetPeriodicRespawnInterval();
                periodicRespawnTimer = instance.timer.Every(interval, CheckPeriodicRespawn);
            }

            private void StopPeriodicRespawnTimer()
            {
                if (periodicRespawnTimer != null && !periodicRespawnTimer.Destroyed)
                {
                    periodicRespawnTimer.Destroy();
                    periodicRespawnTimer = null;
                }
            }

            #endregion
            private void InitSettings()
            {
                IsInitBot = Data != null;
                if (IsInitBot)
                {
                    Data.RestorePet(this);
                    Data.lastPosition = transform.position;
                    if (!Data.IsInitMemory) Data.InitializeMemory();
                }
            }
            public void CallVoiceToPosition(string nameFile)
            {
                if (string.IsNullOrEmpty(nameFile)) return;
                isNPC = false;
                CallVoice(this, null, nameFile, 100f);
                isNPC = true;
            }
            public void WeaponFire(BaseProjectile weapon)
            {
                isNPC = false;
                Ducked = Random.Range(0, 100) < Data.Setup.BattleState._duckChance;
                weapon.ServerUse();
                isNPC = true;
            }
            public void AttackMelee(HeldEntity held, BaseEntity target)
            {
                if(targetCurrentAttack != null) return;
                if (held is BaseMelee melee && !melee.HasAttackCooldown() && target.IsValid() && melee.IsValid())
                {
                    if(melee.GetParentEntity() == null || melee.GetItem() == null) return;

                    SetAimDirectionMelee(target);
                    melee.StartAttackCooldown(melee.repeatDelay * 2f);
                    SignalBroadcast(Signal.Attack, string.Empty);

                    if (melee.swingEffect.isValid) Effect.server.Run(melee.swingEffect.resourcePath, base.transform.position, Vector3.forward, net.connection);
                    if (IsInvoking(ServerMeleeAttack)) CancelInvoke(ServerMeleeAttack);

                    targetCurrentAttack = target;
                    meleeCurrentAttack = melee;

                    Invoke(ServerMeleeAttack, melee.aiStrikeDelay);
                }
            }
            public void ServerMeleeAttack()
            {
                try
                {
                    if(targetCurrentAttack == null || meleeCurrentAttack == null || eyes == null) return;

                    if (!targetCurrentAttack.IsValid() || !meleeCurrentAttack)
                    {
                        targetCurrentAttack = null;
                        meleeCurrentAttack = null;
                        return;
                    }

                    Vector3 vector = eyes.BodyForward();

                    float num = 0f;
                    if(meleeCurrentAttack.damageTypes != null)
                    {
                        foreach (DamageTypeEntry damageType in meleeCurrentAttack.damageTypes) num += damageType.amount;
                    }
                    HitInfo info = new HitInfo(this, targetCurrentAttack, DamageType.Slash, num * meleeCurrentAttack.npcDamageScale);
                    info.Weapon = meleeCurrentAttack;
                    info.CanGather = !(targetCurrentAttack is BasePlayer or BaseNpc);
                    targetCurrentAttack?.OnAttacked(info);
                    HitInfo obj2 = Pool.Get<HitInfo>();
                    obj2.HitEntity = targetCurrentAttack;
                    obj2.HitPositionWorld = targetCurrentAttack.CenterPoint();
                    obj2.HitNormalWorld = -vector;
                    if (targetCurrentAttack is BaseNpc || targetCurrentAttack is BasePlayer)
                    {
                        obj2.HitMaterial = StringPool.Get("Flesh");
                    }
                    else
                    {
                        obj2.HitMaterial = StringPool.Get(targetCurrentAttack.gameObject.GetComponent<Collider>() is Collider collider && collider.sharedMaterial != null ? collider.sharedMaterial.GetName() : "generic");
                    }

                    meleeCurrentAttack.ServerUse_OnHit(obj2);
                    Effect.server.ImpactEffect(obj2);
                    Pool.Free(ref obj2);
                }
#if DebugLog
                catch(Exception ex)
                {
                    Debug.LogError<CustomPet>($"ServerMeleeAttack: {ex}");
                }
#else
                catch {}
#endif
                
                targetCurrentAttack = null;
                meleeCurrentAttack = null;
            }
            public bool ActivatedItem(SlotItemUseItems typeItem)
            {
                try
                {
                    if(IsWounded() || IsIncapacitated()) return false;
                    Item slot = inventory.containerBelt.GetSlot((int)typeItem);
                    Item result = null;
                    if (slot != null && slot.isBroken)
                    {
                        slot.Drop(GetDropPosition(), GetDropVelocity());
                        slot = null;
                    }
                    (ItemDefinition, ulong, bool, int) createItem = (null, 0, false, 0);
                    foreach (var value in Data.Setup.GetMedicalItems(typeItem))
                    {
                        if (CompareItem(slot, value.Item1, value.Item2))
                        {
                            UpdateActiveItem(slot.uid);
                            result = slot;
                            break;
                        }
                        if (FindItemInMain(inventory.containerMain, value.Item1, value.Item2) is Item item)
                        {
                            slot?.RemoveFromContainer();
                            if (item.MoveToContainer(inventory.containerBelt, (int)typeItem))
                            {
                                if (slot != null && !slot.MoveToContainer(inventory.containerMain))
                                {
                                    slot.Drop(GetDropPosition(), GetDropVelocity());
                                }
                                result = item;
                                UpdateActiveItem(item.uid);
                                break;
                            }
                            else
                            {
                                if (slot != null && !slot.MoveToContainer(inventory.containerMain))
                                {
                                    slot.Drop(GetDropPosition(), GetDropVelocity());
                                }
                            }
                        }
                        else if (value.Item3) createItem = value;
                    }
                    Item activeItem = GetActiveItem();
                    slot = inventory.containerBelt.GetSlot((int)typeItem);
                    if (activeItem != null && activeItem == slot && activeItem == result)
                    {
                        return true;
                    }
                    else if (createItem.Item3 && createItem.Item4 > 0 && ItemManager.Create(createItem.Item1, 1, createItem.Item2) is Item item)
                    {
                        slot?.RemoveFromContainer();
                        if (item.MoveToContainer(inventory.containerBelt, (int)typeItem))
                        {
                            if (slot != null && !slot.MoveToContainer(inventory.containerMain))
                            {
                                slot.Drop(GetDropPosition(), GetDropVelocity());
                            }
                            result = item;
                            UpdateActiveItem(item.uid);
                        }
                        else
                        {
                            if (slot != null && !slot.MoveToContainer(inventory.containerMain))
                            {
                                slot.Drop(GetDropPosition(), GetDropVelocity());
                            }
                        }
                    }
                    bool isActiveItem = GetActiveItem() is Item _result && _result == result;
                    return isActiveItem;
                }
                catch (Exception ex)
                {
                    Debug.LogError<CustomPet>($"ActivatedItem SlotItemUseItems:" + ex);
                    return false;
                }
            }
            public bool ActivatedItem(SlotItemTools typeItem)
            {
                try
                {
                    if(IsWounded() || IsIncapacitated()) return false;

                    // Belt index 0 is shared by Pickaxe + Knife enums. Clone templates often spawn a knife + pickaxe;
                    // foreach below hits CompareItem(slot, pickaxe) before FindItemInMain pulls jackhammer from main.
                    if (typeItem == SlotItemTools.Pickaxe && TryPreferJackhammerOnMiningBelt())
                        return true;

                    Item slot = inventory.containerBelt.GetSlot((int)typeItem);
                    Item result = null;
                    if (slot != null && slot.isBroken)
                    {
                        slot.Drop(GetDropPosition(), GetDropVelocity());
                        slot = null;
                    }
                    (ItemDefinition, ulong, bool) createItem = (null, 0, false);
                    foreach (var value in Data.Setup.GetToolItems(typeItem))
                    {
                        if (CompareItem(slot, value.Item1, value.Item2))
                        {
                            UpdateActiveItem(slot.uid);
                            result = slot;
                            break;
                        }
                        if (FindItemInMain(inventory.containerMain, value.Item1, value.Item2) is Item item)
                        {
                            slot?.RemoveFromContainer();
                            if (item.MoveToContainer(inventory.containerBelt, (int)typeItem))
                            {
                                if (slot != null && !slot.MoveToContainer(inventory.containerMain))
                                {
                                    slot.Drop(GetDropPosition(), GetDropVelocity());
                                }
                                result = item;
                                UpdateActiveItem(item.uid);
                                break;
                            }
                            else
                            {
                                if (slot != null && !slot.MoveToContainer(inventory.containerMain))
                                {
                                    slot.Drop(GetDropPosition(), GetDropVelocity());
                                }
                            }
                        }
                        else if (value.Item3) createItem = value;
                    }
                    Item activeItem = GetActiveItem();
                    slot = inventory.containerBelt.GetSlot((int)typeItem);
                    if (activeItem != null && activeItem == slot && activeItem == result) return true;
                    else if (createItem.Item3 && ItemManager.Create(createItem.Item1, 1, createItem.Item2) is Item item)
                    {
                        slot?.RemoveFromContainer();
                        if (item.MoveToContainer(inventory.containerBelt, (int)typeItem))
                        {
                            if (slot != null && !slot.MoveToContainer(inventory.containerMain))
                            {
                                slot.Drop(GetDropPosition(), GetDropVelocity());
                            }
                            result = item;
                            UpdateActiveItem(item.uid);
                        }
                        else
                        {
                            if (slot != null && !slot.MoveToContainer(inventory.containerMain))
                            {
                                slot.Drop(GetDropPosition(), GetDropVelocity());
                            }
                        }
                    }
                    bool isActiveItem = GetActiveItem() is Item _result && _result == result;
                    return isActiveItem;
                }
                catch (Exception ex)
                {
                    Debug.LogError<CustomPet>($"ActivatedItem SlotItemTools:" + ex);
                    return false;
                }
            }
            public bool ActivatedItem(SlotItemWeapons typeItem)
            {
                try
                {
                    if(IsWounded() || IsIncapacitated()) return false;
                    if (InWaterState && typeItem == SlotItemWeapons.Weapon) return false;
                    Item result = null;
                    Item slot = inventory.containerBelt.GetSlot((int)typeItem);
                    if (slot != null && slot.isBroken)
                    {
                        slot.Drop(GetDropPosition(), GetDropVelocity());
                        slot = null;
                    }

                    (ItemDefinition, ulong, bool, AmmoTypes, ItemBot) createItem = (null, 0, false, 0, null);
                    foreach (var value in Data.Setup.GetWeaponItems(typeItem))
                    {
                        if (CompareItem(slot, value.Item1, value.Item2) && HasAmmo(slot?.GetHeldEntity() as BaseProjectile))
                        {
                            UpdateActiveItem(slot.uid);
                            result = slot;
                            break;
                        }
                        if (FindItemInMain(inventory.containerMain, value.Item1, value.Item2) is Item item && HasAmmo(item.GetHeldEntity() as BaseProjectile))
                        {
                            slot?.RemoveFromContainer();
                            bool moved = item.MoveToContainer(inventory.containerBelt, (int)typeItem);
                            if (moved)
                            {
                                if (slot != null && !slot.MoveToContainer(inventory.containerMain))
                                {
                                    slot.Drop(GetDropPosition(), GetDropVelocity());
                                }
                                result = item;
                                UpdateActiveItem(item.uid);
                                break;
                            }
                            else
                            {
                                if (slot != null && !slot.MoveToContainer(inventory.containerMain))
                                {
                                    slot.Drop(GetDropPosition(), GetDropVelocity());
                                }
                            }
                        }
                        else
                        {
                            if (createItem.Item1 == null && value.Item3 && HasAmmo(value.Item4)) createItem = value;
                        }
                    }
                    Item activeItem = GetActiveItem();
                    slot = inventory.containerBelt.GetSlot((int)typeItem);
                    if (activeItem != null && activeItem == slot && activeItem == result)
                    {
                        return HasAmmo(activeItem?.GetHeldEntity() as BaseProjectile);
                    }
                    else if (createItem.Item3 && createItem.Item5?.CreateItem() is Item item)
                    {
                        slot?.RemoveFromContainer();
                        if (item.MoveToContainer(inventory.containerBelt, (int)typeItem))
                        {
                            if (slot != null && !slot.MoveToContainer(inventory.containerMain))
                            {
                                slot.Drop(GetDropPosition(), GetDropVelocity());
                            }
                            result = item;
                            UpdateActiveItem(item.uid);
                        }
                        else
                        {
                            if (slot != null && !slot.MoveToContainer(inventory.containerMain))
                            {
                                slot.Drop(GetDropPosition(), GetDropVelocity());
                            }
                        }
                    }
                    bool isActiveItem = GetActiveItem() is Item _result && _result == result;
                    return isActiveItem;
                }
                catch (Exception ex)
                {
                    Debug.LogError<CustomPet>($"ActivatedItem SlotItemWeapons:" + ex);
                    return false;
                }
            }
            public bool HasItem(SlotItemTools typeItem)
            {
                Item slot = inventory.containerBelt.GetSlot((int)typeItem);
                foreach (var value in Data.Setup.GetToolItems(typeItem))
                {
                    if (CompareItem(slot, value.Item1, value.Item2) || value.Item3 || CanGetItemInMain(value.Item1, value.Item2))
                    {
                        return true;
                    }
                }
                return false;
            }
            public bool HasItem(SlotItemWeapons typeItem)
            {
                Item slot = inventory.containerBelt.GetSlot((int)typeItem);
                BaseProjectile weapon = slot?.GetHeldEntity() as BaseProjectile;
                foreach (var value in Data.Setup.GetWeaponItems(typeItem))
                {
                    if ((CompareItem(slot, value.Item1, value.Item2) && HasAmmo(weapon)) || (value.Item3 && HasAmmo(value.Item4)) || CanGetItemInMain(value.Item1, value.Item2))
                    {
                        return true;
                    }
                }
                return false;
            }
            public bool HasUseItem(SlotItemUseItems typeItem, out (Item, ItemModConsume) component)
            {
                component = (null, null);
                foreach (var value in Data.Setup.GetMedicalItems(typeItem))
                {
                    if (FindItemInMain(inventory.containerBelt, value.Item1, value.Item2) is Item item && item.info.HasComponent<ItemModConsume>())
                    {
                        component = (item, item?.info?.GetComponent<ItemModConsume>());
                        return true;
                    }
                    else if (FindItemInMain(inventory.containerMain, value.Item1, value.Item2) is Item item2 && item2.info.HasComponent<ItemModConsume>())
                    {
                        component = (item2, item2?.info?.GetComponent<ItemModConsume>());
                        return true;
                    }
                    else if (value.Item3 && value.Item1?.HasComponent<ItemModConsume>() == true && value.Item4 > 0)
                    {
                        if (value.Item3 && value.Item1?.HasComponent<ItemModConsume>() == true && value.Item4 > 0)
                        {
                            Item item3 = ItemManager.Create(value.Item1, value.Item4, value.Item2);
                            if (item3.MoveToContainer(inventory.containerMain))
                            {
                                component = (item3, item3?.info?.GetComponent<ItemModConsume>());
                                return true;
                            }
                            else item3.Remove();
                        }
                    }
                }
                return false;
            }
            public bool HasItem(SlotItemUseItems typeItem)
            {
                Item slot = inventory.containerBelt.GetSlot((int)typeItem);
                foreach (var value in Data.Setup.GetMedicalItems(typeItem))
                {
                    if (CompareItem(slot, value.Item1, value.Item2) || value.Item3 || CanGetItemInMain(value.Item1, value.Item2))
                    {
                        return true;
                    }
                }
                return false;
            }
            private Item FindItemInMain(ItemContainer container, ItemDefinition def, ulong skin)
            {
                Item result = null;
                for (int i = 0; i < container.itemList.Count; i++)
                {
                    result = container.itemList[i];
                    if (result != null && result.info == def && result.skin == skin) return result;
                }
                return null;
            }

            /// <summary>
            /// If a jackhammer exists in main, move it to the mining belt slot before the generic tool loop.
            /// Otherwise pickaxe already on slot 0 wins CompareItem and the bot never switches to jackhammer.
            /// </summary>
            private bool TryPreferJackhammerOnMiningBelt()
            {
                try
                {
                    var jackDef = ItemManager.FindItemDefinition("jackhammer");
                    if (jackDef == null) return false;
                    var beltIdx = (int)SlotItemTools.Pickaxe;
                    var slotNow = inventory.containerBelt.GetSlot(beltIdx);
                    if (slotNow != null && slotNow.info == jackDef && slotNow.skin == 0UL)
                    {
                        UpdateActiveItem(slotNow.uid);
                        return GetActiveItem() == slotNow;
                    }

                    var jack = FindItemInMain(inventory.containerMain, jackDef, 0UL);
                    if (jack == null || !jack.IsValid()) return false;

                    slotNow?.RemoveFromContainer();
                    if (!jack.MoveToContainer(inventory.containerBelt, beltIdx))
                    {
                        if (slotNow != null && !slotNow.MoveToContainer(inventory.containerMain))
                            slotNow.Drop(GetDropPosition(), GetDropVelocity());
                        return false;
                    }

                    if (slotNow != null && !slotNow.MoveToContainer(inventory.containerMain))
                        slotNow.Drop(GetDropPosition(), GetDropVelocity());
                    UpdateActiveItem(jack.uid);
                    return GetActiveItem() == jack;
                }
                catch
                {
                    return false;
                }
            }
            private bool CanGetItemInMain(ItemDefinition def, ulong skin, AmmoTypes ammoType = 0)
            {
                for (int i = 0; i < inventory.containerMain.itemList.Count; i++)
                {
                    Item result = inventory.containerMain.itemList[i];
                    if (CompareItem(result, def, skin) && HasAmmo(result?.GetHeldEntity() as BaseProjectile)) return true;
                }
                return false;
            }
            private bool CompareItem(Item item, ItemDefinition def, ulong skin) => item != null && item.IsValid() && item.info == def && item.skin == skin;
            private bool HasAmmo(BaseProjectile weapon)
            {
                if (weapon == null) return true;
                if (weapon.primaryMagazine.contents > 0) return true;
                return HasAmmo(weapon.primaryMagazine.definition.ammoTypes);
            }
            private bool HasAmmo(AmmoTypes ammoType)
            {
                if (ammoType == 0) return true;
                if (!Data.Setup.ItemsWeapon.CanUseAmmo) return true;
                return inventory.HasAmmo(ammoType);
            }
            public void SetAimDirectionWeapon(HeldEntity weapon, BaseEntity target)
            {
                if (target)
                {
                    if (weapon is BaseProjectile projectile) SetAimDirection(projectile.ModifyAIAim(this.GetHeadRayToTarget(target), AccuracyOfFire));
                    else SetAimDirection((target.CenterPoint() - eyes.position).normalized);

                    SendNetworkUpdate_Position();
                }
            }
            public void SetAimDirectionMelee(BaseEntity target)
            {
                if (target != null) SetAimDirection((target.transform.position - transform.position).normalized);
            }
            public bool CanHunt() => Data?.Setup?.HunterState?.CanHunt == true;
            private PersonalityBot? randomPersonality = null;
            public PersonalityBot GetPersonality()
            {
                object personality = Interface.Oxide.CallHook("GetPersonality", this);
                if(personality != null && personality is PersonalityBot personalityBot) return personalityBot;
                else
                {
                    if(Data?.Setup?.EnableRandomPersonality ?? false)
                    {
                        if(randomPersonality == null) randomPersonality = (PersonalityBot)Random.Range(0, 2);
                        return randomPersonality ?? PersonalityBot.Friendly;
                    }

                    return Data?.Setup?.Personality ?? PersonalityBot.Friendly;
                }
            }
            public bool PriorityMeleeHunting() => Data.Setup.HunterState.PriorityMelee;
            public bool CanMining(BaseEntity resource) => Data.Setup.MinerState.CanMining(resource);
            public bool CanHunterAnimal(BaseCombatEntity animalNPC) => Data.Setup.HunterState.CanHunting(animalNPC);
            public bool CanBattleNpc(BaseCombatEntity npc) => true;
            public bool CanButcher(BaseCorpse corpse) => Data.Setup.MinerState.CanButcher(corpse);
            public bool CanLootedCorpse(BaseCorpse corpse) => Data.Setup.MinerState.CanLooted(corpse);

            /// <summary>
            /// Drops gathered loot (not template kit items per <see cref="BotSetup.ContainsItem"/>) at feet so a full
            /// main inventory can clear without <see cref="Suicide"/> (DroppedState / deposit failures / bad build spot).
            /// </summary>
            public void TryDropNonKitLootFromMainToWorld()
            {
                if (inventory?.containerMain == null || Data?.Setup == null) return;
                var list = Pool.Get<List<Item>>();
                list.AddRange(inventory.containerMain.itemList);
                foreach (var item in list)
                {
                    if (item == null || !item.IsValid() || item.amount <= 0) continue;
                    if (Data.Setup.ContainsItem(item)) continue;
                    item.Drop(inventory.containerMain.dropPosition, inventory.containerMain.dropVelocity);
                }

                Pool.FreeUnmanaged(ref list);
            }

            public void DropItemsFromFullContainer(Vector3 position)
            {
                IItemContainerEntity containerEntity = null;
                var anchorDeposit = instance != null &&
                                    instance.TryFindAnchorOwnedStorageForBridge(this, out containerEntity);

                if (!anchorDeposit)
                {
                    if (!TryGetContainer(position, out containerEntity))
                    {
                        TryDropNonKitLootFromMainToWorld();
                        if (!inventory.containerMain.IsFull()) return;

                        Suicide();
                        return;
                    }

                    var timerKill = containerEntity is StashContainer
                        ? Data.Setup.FullState.Stash.TimerKill
                        : Data.Setup.FullState.Box.TimerKill;
                    if (!Data.CustomMemory.AddDroppedContainer(containerEntity as BaseCombatEntity, timerKill))
                    {
                        (containerEntity as BaseEntity)?.Kill();
                        TryDropNonKitLootFromMainToWorld();
                        if (!inventory.containerMain.IsFull()) return;

                        Suicide();
                        return;
                    }
                }

                List<Item> items = Pool.Get<List<Item>>();
                items.AddRange(inventory.containerMain.itemList);
                for (int i = 0; i < items.Count && containerEntity != null; i++)
                {
                    Item item = items[i];
                    if (item != null && item.amount > 0 && !Data.Setup.ContainsItem(item))
                    {
                        if (!item.MoveToContainer(containerEntity.inventory)) break;
                    }
                }

                if (!anchorDeposit && containerEntity is StashContainer stash && Data.Setup.FullState.Stash.CanHideStash)
                    stash.SetHidden(true);
                Pool.FreeUnmanaged(ref items);
                if (inventory.containerMain.IsFull())
                {
                    TryDropNonKitLootFromMainToWorld();
                    if (!inventory.containerMain.IsFull()) return;

                    Suicide();
                }
            }
            public bool CanDroppedContainer() => CanStash() || CanBox();
            private bool CanStash() => Data.Setup.FullState.Stash.Enable
                && (Data.Setup.FullState.Stash.MaxStash <= 0 || (Data.Setup.FullState.Stash.MaxStash > 0 && Data.CustomMemory.GetDropContainers(true).Count() < Data.Setup.FullState.Stash.MaxStash));
            private bool CanBox() => Data.Setup.FullState.Box.Enable
                && (Data.Setup.FullState.Box.MaxBox <= 0 || (Data.Setup.FullState.Box.MaxBox > 0 && Data.CustomMemory.GetDropContainers(false).Count() < Data.Setup.FullState.Box.MaxBox));
            private bool TryGetContainer(Vector3 position, out IItemContainerEntity container)
            {
                container = null;

                if (CanStash()) container = Data.Setup.FullState.CreateStash(position);
                else if (CanBox()) container = Data.Setup.FullState.CreateBox(position);

                return container != null;
            }
            public override void GiveItem(Item item, GiveItemReason reason = GiveItemReason.Generic, GiveItemOptions options = GiveItemOptions.None)
            {
                if (Data?.Setup?.Wear?.CanUseFoundWear == true && item.info.category == ItemCategory.Attire)
                {
                    for (int slot = 0; slot < inventory.containerWear.capacity; slot++)
                    {
                        if (inventory.containerWear.GetSlot(slot) == null && inventory.CanWearItem(item, slot) && item.MoveToContainer(inventory.containerWear)) return;
                    }
                }
                Interface.Oxide.CallHook("OnGiveBotItem", this, item);
                if(item == null || !item.IsValid() || item.amount <= 0)
                {
                    if(item?.IsValid() == true) item.Remove();
                    return;
                }
                if (!item.MoveToContainer(inventory.containerMain)) item.Drop(inventory.containerMain.dropPosition, inventory.containerMain.dropVelocity);
            }
            public bool CheckOwnerPosition(BaseEntity target)
            {
                Vector3 start = transform.position;
                var colliders = Physics.OverlapCapsule(start, start + Vector3.up * capsule.bounds.size.y, capsule.radius, LayerMask.GetMask("World", "Construction", "AI", "Deployed", "Default"), QueryTriggerInteraction.Ignore);
                Vector3 size = Vector3.zero;
                foreach (var collider in colliders)
                {
                    if (collider is MeshCollider || collider.ToBaseEntity() == this) continue;
                    if (collider.ToBaseEntity() == target)
                    {
                        size = collider.bounds.size;
                        break;
                    }
                }
                if (size != Vector3.zero) start += Vector3.up * (size.y * 0.55f);
                HeightMap.ToGroundPoint(ref start);
                transform.position = start;
                return true;
            }

            #endregion

            public enum SlotItemTools
            {
                Pickaxe = 0, Hatchet = 1, Hummer = 4, Planner = 5,
            }
            public enum SlotItemWeapons
            {
                Knife = 0, Melee = 1, Weapon = 2,
            }
            public enum SlotItemUseItems
            {
                Medical = 5,
            }

        }
        #endregion

        #region BotClasses
        public class Brain : BotComponent<CustomPet>
        {
            private const bool canUseMinerState = true;
            private const bool canUseHunterState = true;
            private const bool canUseResearcherState = true;
            private const bool canUseAttackerState = true;
            private const bool canUseMedicalState = true;
            private const bool canUseBridgeAnchorMedicState = true;
            private const bool canUseDroppedState = true;
            private bool hasStateAddonBuilder = false;

            public MemoryBot memory => owner?.Data?.CustomMemory;
            private int layerMask = LayerMask.GetMask
            (
                "Player (Server)",
                "AI",
                "Deployed",
                "Harvestable",
                "Default",
                "Physics Debris",
                "Ragdoll",
                "Vehicle World",
                "Tree",
                "Prevent Building",
                "World"
            );
            private HashSet<BaseEntity> bufferEntity;
            private HashSet<BaseEntity> ignores;
            private List<BaseEntity> buffer;
            private MinerState minerState;
            private HunterState hunterState;
            private ResearcherState researcherState;
            private AttackerState attackerState;
            private MedicalState medicalState;
            private BridgeAnchorMedicState bridgeAnchorMedicState;
            private DroppedState droppedState;
            public float RadiusFindEntity => owner?.Data?.Setup?.Controller?.RadiusFindEntity ?? 30f;
            public IBotState currentState { get; private set; }
            public int CountEntity => bufferEntity.Count;
            public override float ThinkStateDelta => owner?.ThinkBrain ?? base.ThinkStateDelta;

            public override void EnterPool()
            {
                owner?.StopAllCoroutines();
                currentState = null;
                Pool.Free(ref minerState);
                Pool.Free(ref hunterState);
                Pool.Free(ref researcherState);
                Pool.Free(ref attackerState);
                Pool.Free(ref medicalState);
                Pool.Free(ref bridgeAnchorMedicState);
                Pool.Free(ref droppedState);
                Pool.FreeUnmanaged(ref bufferEntity);
                Pool.FreeUnmanaged(ref ignores);
                Pool.FreeUnmanaged(ref buffer);
                base.EnterPool();
            }
            public override void LeavePool()
            {
                bufferEntity = Pool.Get<HashSet<BaseEntity>>();
                ignores = Pool.Get<HashSet<BaseEntity>>();
                buffer = Pool.Get<List<BaseEntity>>();
                minerState = Pool.Get<MinerState>();
                hunterState = Pool.Get<HunterState>();
                researcherState = Pool.Get<ResearcherState>();
                attackerState = Pool.Get<AttackerState>();
                medicalState = Pool.Get<MedicalState>();
                bridgeAnchorMedicState = Pool.Get<BridgeAnchorMedicState>();
                droppedState = Pool.Get<DroppedState>();
                base.LeavePool();
            }
            public override void Start()
            {
                minerState?.Init<MinerState>(owner);
                minerState?.Start();
                hunterState?.Init<HunterState>(owner);
                hunterState?.Start();
                researcherState?.Init<ResearcherState>(owner);
                researcherState?.Start();
                attackerState?.Init<AttackerState>(owner);
                attackerState?.Start();
                medicalState?.Init<MedicalState>(owner);
                medicalState?.Start();
                bridgeAnchorMedicState?.Init<BridgeAnchorMedicState>(owner);
                bridgeAnchorMedicState?.Start();
                droppedState?.Init<DroppedState>(owner);
                droppedState?.Start();
                owner.StartCoroutine(CheckStateCoroutine());
            }
            public override void Think(float delta)
            {
            }
            public override void ThinkUpdate()
            {
            }
            public void OnCollectiblePickedup(Item item) => minerState?.OnCollectiblePickedup(item);
            public bool IsActive(IBotState state) => currentState != null && state != null && currentState.NameState == state.NameState;
            /// <summary>MaxxInvaders bridge with streamer anchor: skip hunter/researcher so bots do not path to animals or monuments across the map.</summary>
            private bool BridgeAnchorStayLocalOnly =>
                owner?.Data?.SpawnedFromMaxxInvadersBridge == true && owner.Data.BridgeProtectAnchorUserId != 0UL;

            /// <summary>Allow <see cref="HunterState"/> on bridge bots when defending streamer from an animal that damaged them.</summary>
            private bool BridgeAnimalRetaliationActive()
            {
                var d = owner?.Data;
                if (d == null || !d.SpawnedFromMaxxInvadersBridge || d.BridgeRetaliationAnimalNetId == 0UL)
                    return false;
                return UnityEngine.Time.realtimeSinceStartup < d.BridgeRetaliationExpireTime;
            }

            public void ChangeState(IBotState state)
            {
                currentState?.LeaveState(state);
                currentState = state;
                state?.EnterState();
            }
            private void FindEntity()
            {
                List<BaseEntity> buffer = Pool.Get<List<BaseEntity>>();
                buffer.AddRange(bufferEntity);
                if(CollectibleHelper.Instance != null) buffer.AddRange(CollectibleHelper.Instance.GetCollectibleEntity(owner.transform.position, RadiusFindEntity));
                Vis.Entities(owner.transform.position, RadiusFindEntity, buffer, layerMask, QueryTriggerInteraction.Ignore);

                bufferEntity.Clear();
                if (!owner.InSafeZone())
                {
                    foreach (var entity in buffer)
                    {
                        if (entity?.IsValid() == true && entity != owner && !ignores.Contains(entity) && !entity.InSafeZone() && !(entity is NPCShopKeeper) && entity is BaseCorpse or BasePlayer or BaseNpc or BaseNPC2 or ResourceEntity or CollectibleEntity or DroppedItem or DroppedItemContainer or LootContainer)
                        {
                            // MaxxInvaders bridge: never track streamer anchor in brain buffer (stops initial aggro on them when real players are not ignored).
                            if (entity is BasePlayer bpSkipAnchor && owner?.Data?.SpawnedFromMaxxInvadersBridge == true &&
                                owner.Data.BridgeProtectAnchorUserId != 0UL &&
                                bpSkipAnchor.userID == owner.Data.BridgeProtectAnchorUserId)
                                continue;

                            if ((owner?.Data?.IgnoreBotsInVehicles ?? false) || (owner?.Data?.IgnoreSleepingPlayers ?? false) || (owner?.Data?.IgnoreRNPCs ?? false) || (owner?.Data?.IgnoreNPCs ?? false) || (owner?.Data.IgnoreRealPlayers ?? false) || (owner?.Data.IgnorePVEPlayer ?? false))
                            {
                                if(entity is BasePlayer player)
                                {
                                    if(owner?.Data.IgnoreRealPlayers ?? false)
                                    {
                                        if(player.userID.IsSteamId()) continue;
                                    }

                                    if(owner?.Data.IgnorePVEPlayer ?? false)
                                    {
                                        if(instance.WarMode != null)
                                        {
                                            if(instance.WarMode.Call("GetEntityMode", entity) is string mode)
                                            {
                                                if(mode == "pve") continue;
                                            }
                                        }
                                    }

                                    if(owner?.Data.IgnoreBotsInVehicles ?? false)
                                    {                                        
                                        if((player.IsNpc || !player.userID.IsSteamId()) && player.isMounted)
                                        {
                                            continue;
                                        }
                                    }

                                    if(owner?.Data.IgnoreSleepingPlayers ?? false)
                                    {
                                        if(player.IsSleeping())
                                        {
                                            continue;
                                        }
                                    }
                                }
                            }

                            // RNPC / PersonalNPC / broad NPC filter (runs for every BasePlayer so templates cannot skip it when other ignore flags are off).
                            if (entity is BasePlayer playerGuard)
                            {
                                if ((owner?.Data?.IgnoreRNPCs ?? true) && playerGuard is CustomPet)
                                    continue;
                                if (owner?.Data?.IgnorePersonalNpcBots ?? true)
                                {
                                    try
                                    {
                                        var pn = Interface.Call("IsPersonalNPCPlayer", playerGuard);
                                        if (pn is bool pnb && pnb)
                                            continue;
                                    }
                                    catch
                                    {
                                        /* optional PersonalNPC */
                                    }
                                }

                                if (owner?.Data?.IgnoreNPCs ?? false)
                                {
                                    if (!playerGuard.userID.IsSteamId())
                                        continue;
                                    if (playerGuard.IsNpc && playerGuard is not ScientistNPC && playerGuard is not HumanNPC)
                                        continue;
                                }
                            }

                            bufferEntity.Add(entity);
                        }
                    }
                }

                Pool.FreeUnmanaged(ref buffer);
            }
            public bool HasEntity(Func<BaseEntity, bool> func)
            {
                foreach (var entity in bufferEntity) if (!ignores.Contains(entity) && func.Invoke(entity)) return true;
                return false;
            }
            public bool HasEntity<T>(Func<T, bool> func) where T : BaseEntity
            {
                foreach (var entity in bufferEntity) if (!ignores.Contains(entity) && entity is T value && func.Invoke(value)) return true;
                return false;
            }
            public bool HasTypeEntity<T>() where T : BaseEntity
            {
                foreach (var entity in bufferEntity) if (!ignores.Contains(entity) && entity is T) return true;
                return false;
            }
            public bool HasTypeEntity<T, T2>() where T : BaseEntity
            {
                foreach (var entity in bufferEntity) if (!ignores.Contains(entity) && entity is T or T2) return true;
                return false;
            }
            public bool HasTypeEntity<T, T2, T3>() where T : BaseEntity
            {
                foreach (var entity in bufferEntity) if (!ignores.Contains(entity) && entity is T or T2 or T3) return true;
                return false;
            }
            public IEnumerable<T> GetTypeEntity<T>(Func<T, bool> func) where T : BaseEntity
            {
                if(bufferEntity != null && bufferEntity.Count > 0)
                {
                    using var enumerator = bufferEntity.GetEnumerator();
                    while (enumerator.MoveNext())
                    {
                        if (enumerator.Current.IsValid() && enumerator.Current is T entity && func?.Invoke(entity) == true)
                        {
                            yield return entity;
                        }
                    }
                }
                
            }
            public T GetNearestEntity<T>(Func<T, bool> func) where T : BaseEntity
            {
                T nearestEntity = null;
                if (IsValid() && bufferEntity.Count > 0)
                {
                    float distance = float.MaxValue;
                    using var enumerator = bufferEntity.GetEnumerator();
                    while (IsValid() && enumerator.MoveNext())
                    {
                        if (enumerator.Current is T && enumerator.Current?.IsValid() == true && !ignores.Contains(enumerator.Current) && func.Invoke(enumerator.Current as T))
                        {
                            float _distance = owner.Distance(enumerator.Current);
                            if (_distance < distance)
                            {
                                distance = _distance;
                                nearestEntity = enumerator.Current as T;
                            }
                        }
                    }
                }
                return nearestEntity as T;
            }
            public void IgnoreEntity(BaseEntity entity)
            {
                if (entity != null) ignores.Add(entity);

                if(bufferEntity.Contains(entity)) bufferEntity.Remove(entity);
            }
            public void RemoveEntity(BaseEntity entity, bool hasIgnore)
            {
                if (entity != null && hasIgnore)
                {
                    ignores.Add(entity);
                    entity.Invoke(() =>
                    {
                        if (IsValid()) ignores?.Remove(entity);
                    }, 1800f);
                }

                bufferEntity.Remove(entity);
            }
            public void OnNpcTarget(BaseCombatEntity initiator)
            {
                if (initiator == null) return;

                // MaxxInvaders bridge: streamer anchor damaging this bot must not add them to the combat buffer / aggro list.
                if (initiator is BasePlayer bp &&
                    owner?.Data?.SpawnedFromMaxxInvadersBridge == true &&
                    owner.Data.BridgeProtectAnchorUserId != 0UL &&
                    bp.userID == owner.Data.BridgeProtectAnchorUserId)
                    return;

                object hookResult = Interface.CallHook("CanRoamingNPCTarget", owner, initiator);
                if (hookResult != null) return;

                switch (initiator)
                {
                    case BaseAnimalNPC animal:
                        {
                            if (animal.IsAlive())
                            {
                                hunterState?.OnNpcTarget(animal);
                                break;
                            }
                            return;
                        }
                    case BaseNPC2 animal:
                        {
                            if (animal.IsAlive() && animal.IsAnimal)
                            {
                                hunterState?.OnNpcTarget(animal);
                                break;
                            }
                            return;
                        }
                    case global::HumanNPC player:
                        {
                            if (player.IsValid())
                            {
                                attackerState?.OnNpcTarget(player);
                                break;
                            }
                            return;
                        }
                    case BasePlayer player:
                        {
                            if (player.IsAlive() && player.IsConnected)
                            {
                                attackerState?.OnNpcTarget(player);
                                break;
                            }
                            return;
                        }
                    default: return;
                }
                bufferEntity.Add(initiator);
                ignores.Remove(initiator);
            }
            
            #region Coroutines
            private IEnumerator CheckStateCoroutine()
            {
                yield return CoroutineEx.waitForSeconds(ThinkStateDelta);

                while (IsValid())
                {
                    FindEntity();
                    yield return CoroutineEx.waitForSeconds(ThinkStateDelta);
                    if(!IsValid()) yield break;

                    if(owner.IsWounded() || owner.IsIncapacitated()) goto End;

                    if (canUseBridgeAnchorMedicState && bridgeAnchorMedicState.CanEnterState)
                    {
                        if (!IsActive(bridgeAnchorMedicState)) ChangeState(bridgeAnchorMedicState);

                        yield return currentState.routine;
                        goto End;
                    }

                    else if (IsActive(bridgeAnchorMedicState)) ChangeState(null);

                    if (canUseAttackerState && attackerState.CanEnterState)
                    {
                        if (!IsActive(attackerState)) ChangeState(attackerState);

                        yield return currentState.routine;
                        goto End;
                    }
                    else if (IsActive(attackerState)) ChangeState(null);

                    if (canUseHunterState && (!BridgeAnchorStayLocalOnly || BridgeAnimalRetaliationActive()) &&
                        hunterState.CanEnterState)
                    {
                        if (!IsActive(hunterState)) ChangeState(hunterState);

                        yield return currentState.routine;
                        goto End;
                    }
                    else if (IsActive(hunterState)) ChangeState(null);

                    if (canUseMedicalState && medicalState.CanEnterState)
                    {
                        if (!IsActive(medicalState)) ChangeState(medicalState);

                        yield return currentState.routine;
                        goto End;
                    }
                    else if (IsActive(medicalState)) ChangeState(null);

                    yield return CoroutineEx.waitForSeconds(ThinkStateDelta);
                    if(!IsValid()) yield break;

                    if(owner.IsWounded() || owner.IsIncapacitated()) goto End;
                    // TimerSince timer = 0;
                    object buildStateHook = Interface.Oxide.CallHook("OnBuildState", owner);
                    // Debug.LogTest<Brain>($"Нагрузка метода CheckStateAddonBuilder {timer.TotalMilliseconds:0.000 ms}");
                    if(buildStateHook is IBotState buildState)
                    {
                        if (!IsActive(buildState)) ChangeState(buildState);
                        yield return currentState.routine;
                        goto End;
                    }

                    if (canUseDroppedState && droppedState.CanEnterState)
                    {
                        if (instance.ShouldDeferDroppedForBridgeAutoDeposit(owner))
                        {
                            if (IsActive(droppedState)) ChangeState(null);
                            if (IsActive(minerState)) ChangeState(null);
                            if (IsActive(researcherState)) ChangeState(null);
                            instance.EnsureBridgeAutoDepositOrStandby(owner);
                            goto End;
                        }

                        if (!IsActive(droppedState)) ChangeState(droppedState);

                        yield return currentState.routine;
                        goto End;
                    }
                    else if (IsActive(droppedState)) ChangeState(null);

                    if (canUseMinerState && minerState.CanEnterState)
                    {
                        if (!IsActive(minerState)) ChangeState(minerState);

                        yield return currentState.routine;
                        goto End;
                    }
                    else if (IsActive(minerState)) ChangeState(null);

                    if (canUseResearcherState && !BridgeAnchorStayLocalOnly && researcherState.CanEnterState)
                    {
                        if (!IsActive(researcherState)) ChangeState(researcherState);
                        yield return currentState.routine;
                        goto End;
                    }
                    else if (IsActive(researcherState)) ChangeState(null);

                End: yield return CoroutineEx.waitForSeconds(ThinkStateDelta);
                }
            }
            #endregion
        }
        public class MoveController : BotComponent<CustomPet>
        {
            protected Vector3 endPoint;
            protected Vector3 obstaclePoint;
            protected BaseEntity target;
            protected UnityAction<bool> finishCallback;
            protected ModeMove modeMove;
            protected NPCPlayerNavigator navigator;
            public NPCPlayerNavigator Navigator => navigator;
            protected Sphere sphere = new Sphere(Vector3.zero, 3f);
            protected TimeSince timeSuicide = 0;
            protected TimeSince timeNotVelocity = 0;
            protected float timerNotVelocity => owner?.Data?.Setup?.Controller?.GetTimerObstacle() ?? 3f;
            protected float timerSuicide => owner?.CustomBrain?.currentState?.TimerSuicideController ?? 600f;
            protected bool canSuicide => timerSuicide > 0;
            protected Vector3 lastPosition;
            protected float depth => inWater ? WaterLevel.GetWaterDepth(CurrentPoint, false, true, owner) : 0;
            protected float waterLevel => inWater ? WaterLevel.GetWaterLevel(CurrentPoint, true) : WaterSystem.OceanLevel;
            protected int currentSpeed = 0;
            protected int layerMaskToObstacle = LayerMask.GetMask("Terrain", "World", "Default", "Construction");
            protected virtual float distanceMoveToObstacle => IsMoving ? 1f : owner?.CustomBrain?.currentState?.ObstacleDistance ?? 10f;
            protected bool canObstacle => owner?.CustomBrain?.currentState?.CanObstacle == true;
            public bool HasPath => IsValid() && modeMove != ModeMove.Idle;
            public bool HasTarget
            {
                get
                {
                    bool has = IsValid() && target != null && target.IsValid() && HasFlag(ModeMove.TargetMove);
                    if (!has) target = null;
                    return has;
                }
            }
            public Vector3 CurrentPoint => owner?.transform.position ?? Vector3.zero;
            public Vector3 EndPoint
            {
                get
                {
                    Vector3 position = endPoint;
                    if (IsValid())
                    {
                        if (HasFlag(ModeMove.ObstacleMove))
                        {
                            position = obstaclePoint;
                        }
                        else if (HasFlag(ModeMove.TargetMove))
                        {
                            if (HasTarget)
                            {
                                position = target.transform.position;
                            }
                            else position = CurrentPoint;
                        }
                    }

                    return position;
                }
            }
            public override float ThinkStateDelta => owner?.ThinkController ?? base.ThinkStateDelta;
            public int MaxSpeedMoveToWater => owner?.Data?.Setup?.Controller?.GetSpeedWater() ?? 1;
            public int MaxSpeedMoveToGround => owner?.Data?.Setup?.Controller?.GetSpeed() ?? 3;
            public BaseNavigator.NavigationSpeed CurrentSpeed => (BaseNavigator.NavigationSpeed)Mathf.Clamp(currentSpeed, 0, 3);
            public BaseNavigator.NavigationSpeed MaxSpeed => (BaseNavigator.NavigationSpeed)Mathf.Clamp(inWater ? MaxSpeedMoveToWater : MaxSpeedMoveToGround, 0, 3);
            public static string DefaultArea => "Walkable";
            public bool IsMoving => navigator?.Moving == true;
            protected bool inWater => IsValid() && owner.InWaterState;
            public float Distance => IsValid() && HasPath ? Vector3.Distance(CurrentPoint, EndPoint) : 0;
            public override void EnterPool()
            {
                Reset();
                finishCallback = null;
                navigator = null;
                base.EnterPool();
            }
            public override void LeavePool()
            {
                Reset();
                base.LeavePool();
            }
            public override void Start()
            {
                sphere.position = CurrentPoint;
                base.Start();
            }
            public override bool IsValid() => base.IsValid() && navigator != null;
            public override void Think(float delta)
            {
            }
            public override void ThinkUpdate()
            {
                if (!IsValid())
                {
                    if (owner.Brain.Navigator != null)
                    {
                        navigator = owner.Brain.Navigator as NPCPlayerNavigator;
                        navigator.CanUseBaseNav = owner?.Data?.Setup?.Controller?.OnlyNavMeshUse != true;
                        navigator.CanUseRandomMovePointIfNonFound = true;
                        navigator.CanPathFindToChaseTargetIfNoMovePoint = true;
#if DebugLog
                        Debug.Log<MoveController>($@"{owner}
    Navigator:
            DefaultArea: {navigator.DefaultArea}
            CanUseRandomMovePointIfNonFound: {navigator.CanUseRandomMovePointIfNonFound}
            CanUseBaseNav: {navigator.CanUseBaseNav}
            CanUseNavMesh: {navigator.CanUseNavMesh}
            CanNavigateMounted: {navigator.CanNavigateMounted}
            TriggerStuckEvent: {navigator.TriggerStuckEvent}
            FaceMoveTowardsTarget: {navigator.FaceMoveTowardsTarget}
            FaceTargetChaseDistance: {navigator.FaceTargetChaseDistance}
            CanPathFindToChaseTargetIfNoMovePoint: {navigator.CanPathFindToChaseTargetIfNoMovePoint}
            
    Agent:
            agentTypeID: {navigator.Agent.agentTypeID}
            obstacleAvoidanceType: {navigator.Agent.obstacleAvoidanceType}
            autoTraverseOffMeshLink: {navigator.Agent.autoTraverseOffMeshLink}
            avoidancePriority: {navigator.Agent.avoidancePriority}
            autoRepath: {navigator.Agent.autoRepath}
            autoBraking: {navigator.Agent.autoBraking}
            updateUpAxis: {navigator.Agent.updateUpAxis}");
#endif
                    }
                    return;
                }

                // Speed ramp: only adjust navigator speed — do NOT call Move() every ThinkUpdate or SetDestination fires
                // every frame → path churn, visible skipping, and sluggish escort bots.
                // SetCurrentSpeed touches NavMeshAgent; must not run while off-mesh or Unity logs SetDestination/Resume.
                if (CurrentSpeed != MaxSpeed && !owner.Ducked)
                {
                    if (CurrentSpeed < MaxSpeed) currentSpeed++;
                    else if (CurrentSpeed > MaxSpeed) currentSpeed--;
                    if (navigator.Agent != null && !navigator.Agent.isOnNavMesh)
                        TryEnsureNavMeshAgent();
                    if (navigator.Agent != null && navigator.Agent.enabled && navigator.Agent.isOnNavMesh)
                        navigator.SetCurrentSpeed(CurrentSpeed);
                    if (!IsMoving)
                        Move(EndPoint);
                }
                else if (owner.Ducked && currentSpeed != 1)
                {
                    currentSpeed = 1;
                    if (navigator.Agent != null && !navigator.Agent.isOnNavMesh)
                        TryEnsureNavMeshAgent();
                    if (navigator.Agent != null && navigator.Agent.enabled && navigator.Agent.isOnNavMesh)
                        navigator.SetCurrentSpeed(CurrentSpeed);
                    if (!IsMoving)
                        Move(EndPoint);
                }

                if (HasPath)
                {
                    sphere.position = CurrentPoint;
                    UpdateControlMove(inWater, IsMoving, depth, waterLevel);
                }
                else UpdateControlIdle();
            }
            protected virtual void UpdateControlMove(bool inWater, bool isMoving, float depth, float waterLevel)
            {
                if (owner == null || navigator == null || navigator?.Agent == null || owner?.eyes == null) return;
                if (navigator.Agent != null && !navigator.Agent.isOnNavMesh)
                    TryEnsureNavMeshAgent();

                Vector3 endPoint = EndPoint;
                Vector3 agentVelocity = navigator.Agent.velocity;
                bool isSphere = sphere.Contains(endPoint);
                float distanceHorizontal = owner.DistanceHorizontal(endPoint);
                float distance = Vector3.Distance(CurrentPoint, endPoint);

                if ((HasFlag(ModeMove.TargetMove) && !HasTarget) || (Physics.Raycast(owner.eyes.HeadRay(), out var hitInfo, 5f, LayerMask.GetMask("Construction"), QueryTriggerInteraction.Ignore) && hitInfo.GetEntity() is BaseEntity entity && entity.OwnerID != owner.userID && navigator.CurrentNavigationType != BaseNavigator.NavigationType.NavMesh))
                {
                    Finish(false);
                    return;
                }

                if (inWater && !HasFlag(ModeMove.MoveToWater))
                {
                    SetMoveTo(false);
                    
                    if (!HasFlag(ModeMove.WaterLerpMove))
                    {
                        if (navigator.Agent != null && navigator.Agent.isOnNavMesh)
                            navigator.Stop();
                        SetFlag(ModeMove.WaterLerpMove, true);
                    }
                }
                else if (!inWater && !HasFlag(ModeMove.MoveToGround))
                {
                    SetMoveTo(true);
                    
                    if (HasFlag(ModeMove.WaterLerpMove))
                    {
                        SetFlag(ModeMove.WaterLerpMove, false);
                        Move(EndPoint);
                    }
                }

                if (HasFlag(ModeMove.Paused)) return;

                if (HasFlag(ModeMove.Finish))
                {
                    modeMove = ModeMove.Idle;
                    SetFlag(ModeMove.Paused, true);
                    Finish(isSphere);
                    return;
                }

                if (HasFlag(ModeMove.WaterMoveDown))
                {
                    if (!WaterMoveDown())
                    {
                        SetFlag(ModeMove.WaterMoveDown, false);
                    }
                }

                if (HasFlag(ModeMove.WaterMoveUp))
                {
                    if (!WaterMoveUp())
                    {
                        SetFlag(ModeMove.WaterMoveUp, false);
                    }
                }

                if (HasFlag(ModeMove.WaterMoveTarget))
                {
                    if (!isSphere || distanceHorizontal < sphere.radius)
                    {
                        if (endPoint.y > CurrentPoint.y)
                        {
                            if (WaterMoveUp()) return;
                        }
                        else
                        {
                            if (WaterMoveDown()) return;
                        }
                    }
                    SetFlag(ModeMove.WaterMoveTarget, false);
                    SetFlag(ModeMove.Finish, true);
                }

                if (HasFlag(ModeMove.WaterLerpMove))
                {
                    if (isSphere || distanceHorizontal <= sphere.radius)
                    {
                        SetFlag(ModeMove.WaterLerpMove, false);
                        SetFlag(ModeMove.Finish, true);
                        return;
                    }

                    if (WaterLerpMove())
                    {
                        return;
                    }
                    else
                    {
                        SetFlag(ModeMove.WaterLerpMove, false);
                        SetFlag(ModeMove.Finish, true);
                        return;
                    }
                }

                if (!HasFlag(ModeMove.MoveToGround) && !HasFlag(ModeMove.MoveToWater)) return;

                if (canSuicide)
                {
                    if (timeSuicide > timerSuicide)
                    {
                        owner.Suicide();
                        return;
                    }
                }
                else timeSuicide = 0;

                if (!isMoving)
                {
                    ResetTimerVelocity();
                    if (isSphere || distance <= sphere.radius)
                    {
                        if (HasFlag(ModeMove.ObstacleMove))
                        {
                            SetFlag(ModeMove.ObstacleMove, false);
                            if (HasFlag(ModeMove.MoveToWater))
                            {
                                SetFlag(ModeMove.WaterMoveDown, false);
                                SetFlag(ModeMove.WaterMoveUp, false);
                                SetFlag(ModeMove.WaterMoveTarget, false);
                            }
                            Move(EndPoint);
                            return;
                        }
                        SetFlag(ModeMove.Finish, true);
                        return;
                    }
                    if (HasFlag(ModeMove.MoveToWater) && distanceHorizontal < sphere.radius)
                    {
                        if (HasFlag(ModeMove.Finish))
                        {
                            return;
                        }
                        else
                        {
                            SetFlag(ModeMove.WaterMoveTarget, true);
                            return;
                        }
                    }
                    if (HasFlag(ModeMove.ObstacleMove))
                    {
                        SetFlag(ModeMove.ObstacleMove, false);
                        Move(EndPoint);
                        return;
                    }
    
                    if(HasFlag(ModeMove.TargetMove) && endPoint != EndPoint && Move(EndPoint)) return;
                    if (canObstacle && distanceHorizontal > sphere.radius)
                    {
                        UpdateObstaclePoint(distanceMoveToObstacle);
                        return;
                    }
                    if (!owner.Ducked && !inWater)
                    {
                        owner.Ducked = true;
                        Move(endPoint);
                        return;
                    }
                    SetFlag(ModeMove.Finish, true);
                    return;
                }
                else
                {
                    if (Mathf.Floor(agentVelocity.sqrMagnitude) == 0)
                    {
                        if (timeNotVelocity > timerNotVelocity)
                        {

                            if (HasFlag(ModeMove.ObstacleMove))
                            {
                                SetFlag(ModeMove.ObstacleMove, false);
                                ResetTimerVelocity();
                                Move(EndPoint);
                                return;
                            }

                            if (Vector3.Distance(lastPosition, CurrentPoint) > 0.5f)
                            {
                                ResetTimerVelocity();
                                return;
                            }

                            ResetTimerVelocity();

                            if (canObstacle)
                            {
                                UpdateObstaclePoint(distanceMoveToObstacle);
                                Move(obstaclePoint);
                                return;
                            }
                            if (!owner.Ducked && !inWater)
                            {
                                owner.Ducked = true;
                                Move(endPoint);
                                return;
                            }
                            SetFlag(ModeMove.Finish, true);
                        }
                        return;
                    }
                    ResetTimerVelocity();
                }
            }
            protected virtual void UpdateControlMove2(bool inWater, bool isMoving, float depth, float waterLevel)//оригинальный метод контрорля
            {
                Vector3 endPoint = EndPoint;
                Vector3 agentVelocity = navigator.Agent.velocity;
                bool isSphere = sphere.Contains(endPoint);
                float distanceHorizontal = owner.DistanceHorizontal(endPoint);
                float distance = Vector3.Distance(CurrentPoint, endPoint);

                if ((HasFlag(ModeMove.TargetMove) && !HasTarget) || (Physics.Raycast(owner.eyes.HeadRay(), 5f, LayerMask.GetMask("Construction"), QueryTriggerInteraction.Ignore) && navigator.CurrentNavigationType != BaseNavigator.NavigationType.NavMesh))
                {
                    Finish(false);
                    return;
                }

                if (inWater && !HasFlag(ModeMove.MoveToWater))
                {
                    SetMoveTo(false);
                }
                else if (!inWater && !HasFlag(ModeMove.MoveToGround))
                {
                    SetMoveTo(true);
                }

                if (HasFlag(ModeMove.Paused)) return;

                if (HasFlag(ModeMove.Finish))
                {
                    modeMove = ModeMove.Idle;
                    SetFlag(ModeMove.Paused, true);
                    Finish(isSphere);
                    return;
                }

                if (HasFlag(ModeMove.WaterMoveDown))
                {
                    if (!WaterMoveDown())
                    {
                        SetFlag(ModeMove.WaterMoveDown, false);
                    }
                }

                if (HasFlag(ModeMove.WaterMoveUp))
                {
                    if (!WaterMoveUp())
                    {
                        SetFlag(ModeMove.WaterMoveUp, false);
                    }
                }

                if (HasFlag(ModeMove.WaterMoveTarget))
                {
                    if (!isSphere || distanceHorizontal < sphere.radius)
                    {
                        if (endPoint.y > CurrentPoint.y)
                        {
                            if (WaterMoveUp()) return;
                        }
                        else
                        {
                            if (WaterMoveDown()) return;
                        }
                    }
                    SetFlag(ModeMove.WaterMoveTarget, false);
                    SetFlag(ModeMove.Finish, true);
                }

                if (!HasFlag(ModeMove.MoveToGround) && !HasFlag(ModeMove.MoveToWater)) return;

                if (canSuicide)
                {
                    if (timeSuicide > timerSuicide)
                    {
                        owner.Suicide();
                        return;
                    }
                }
                else timeSuicide = 0;

                if (!isMoving)
                {
                    ResetTimerVelocity();
                    if (isSphere || distance <= sphere.radius)
                    {
                        if (HasFlag(ModeMove.ObstacleMove))
                        {
                            SetFlag(ModeMove.ObstacleMove, false);
                            if (HasFlag(ModeMove.MoveToWater))
                            {
                                SetFlag(ModeMove.WaterMoveDown, false);
                                SetFlag(ModeMove.WaterMoveUp, false);
                                SetFlag(ModeMove.WaterMoveTarget, false);
                            }
                            Move(EndPoint);
                            return;
                        }
                        SetFlag(ModeMove.Finish, true);
                        return;
                    }
                    if (HasFlag(ModeMove.MoveToWater) && distanceHorizontal < sphere.radius)
                    {
                        if (HasFlag(ModeMove.Finish))
                        {
                            return;
                        }
                        else
                        {
                            SetFlag(ModeMove.WaterMoveTarget, true);
                            return;
                        }
                    }
                    if (HasFlag(ModeMove.ObstacleMove))
                    {
                        SetFlag(ModeMove.ObstacleMove, false);
                        Move(EndPoint);
                        return;
                    }
                    // if (distanceHorizontal <= sphere.radius && CurrentPoint.y > endPoint.y)
                    // {
                    //     Vector3 pos = endPoint;
                    //     float h = CurrentPoint.y - endPoint.y;
                    //     pos.y = CurrentPoint.y;
                    //     if (!Physics.Raycast(owner.eyes.position, owner.eyes.HeadForward(), distanceHorizontal, layerMaskToObstacle, QueryTriggerInteraction.Ignore) && Physics.Raycast(pos, Vector3.down, out var hitInfo, 100f, layerMaskToObstacle, QueryTriggerInteraction.Ignore))
                    //     {
                    //         if (hitInfo.distance > 0.5f && hitInfo.distance <= h)
                    //         {
                    //             Warp(hitInfo.point, true);
                    //             return;
                    //         }
                    //     }
                    // }
                    if(HasFlag(ModeMove.TargetMove) && endPoint != EndPoint && Move(EndPoint)) return;
                    if (canObstacle && distanceHorizontal > sphere.radius)
                    {
                        UpdateObstaclePoint(distanceMoveToObstacle);
                        return;
                    }
                    if (!owner.Ducked && !inWater)
                    {
                        owner.Ducked = true;
                        Move(endPoint);
                        return;
                    }
                    SetFlag(ModeMove.Finish, true);
                    return;
                }
                else
                {
                    if (Mathf.Floor(agentVelocity.sqrMagnitude) == 0)
                    {
                        if (timeNotVelocity > timerNotVelocity)
                        {

                            if (HasFlag(ModeMove.ObstacleMove))
                            {
                                SetFlag(ModeMove.ObstacleMove, false);
                                ResetTimerVelocity();
                                Move(EndPoint);
                                return;
                            }

                            if (Vector3.Distance(lastPosition, CurrentPoint) > 0.5f)
                            {
                                ResetTimerVelocity();
                                return;
                            }

                            ResetTimerVelocity();

                            if (canObstacle)
                            {
                                UpdateObstaclePoint(distanceMoveToObstacle);
                                Move(obstaclePoint);
                                return;
                            }
                            if (!owner.Ducked && !inWater)
                            {
                                owner.Ducked = true;
                                Move(endPoint);
                                return;
                            }
                            SetFlag(ModeMove.Finish, true);
                        }
                        return;
                    }
                    ResetTimerVelocity();
                }
            }
            protected virtual void UpdateControlIdle()
            {
                ResetTimerVelocity();
                if (owner.InDiving)
                {
                    WaterMoveUp();
                }
            }
            protected virtual void UpdateObstaclePoint(float distance)
            {
                if (!IsMoving)
                {
                    UpdateObstaclePoint2(distance);
                    return;
                }
                ResetTimerVelocity();

                Vector3 direction = new Vector3(Random.Range(-1f, 1f), 0, Random.Range(-1f, 1f)).normalized;

                obstaclePoint = CurrentPoint + (direction * distance);
                HeightMap.ToGroundPoint(ref obstaclePoint);
                if (navigator.GetNearestNavmeshPosition(obstaclePoint, out var pos, 1f)) obstaclePoint = pos;

                owner.SetAimDirection(direction);

                SetFlag(ModeMove.ObstacleMove, true);

                Move(obstaclePoint);
            }
            protected virtual void UpdateObstaclePoint2(float distance)
            {
                ResetTimerVelocity();

                Vector3 direction = new Vector3(Random.Range(-1f, 1f), 0, Random.Range(-1f, 1f)).normalized;

                obstaclePoint = CurrentPoint + (direction * distance);
                HeightMap.ToGroundPoint(ref obstaclePoint);
                if (navigator.GetNearestNavmeshPosition(obstaclePoint, out var pos, 1f)) obstaclePoint = pos;

                owner.SetAimDirection(direction);

                SetFlag(ModeMove.ObstacleMove, true);
                Move(obstaclePoint);
            }
            protected void UpdateCurrentPosition(float radius = 1f)
            {
                if (!IsValid() || navigator?.Agent == null || navigator.Agent.isOnNavMesh) return;
                if (!navigator.GetNearestNavmeshPosition(owner.transform.position, out var position, radius))
                    return;
                owner.transform.position = position;
                navigator.Warp(position);
                UnityEngine.Physics.SyncTransforms();
            }

            /// <summary>
            /// Unity logs if <see cref="NavMeshAgent"/> Stop/SetDestination run while off-mesh — snap + Warp first (MaxxInvaders escort).
            /// </summary>
            protected bool TryEnsureNavMeshAgent()
            {
                if (navigator == null || navigator.Agent == null) return false;
                if (navigator.Agent.isOnNavMesh) return true;
                UpdateCurrentPosition(3f);
                if (navigator.Agent.isOnNavMesh) return true;
                for (var radius = 4f; radius <= 40f; radius += 4f)
                {
                    if (!navigator.GetNearestNavmeshPosition(owner.transform.position, out var snapped, radius))
                        continue;
                    owner.transform.position = snapped;
                    navigator.Warp(snapped);
                    UnityEngine.Physics.SyncTransforms();
                    if (navigator.Agent.isOnNavMesh) return true;
                }

                // Facepunch nearest sometimes misses; Unity sample can still find walkable hull (RustChaos-style).
                var p = owner.transform.position;
                for (var r = 2f; r <= 48f; r += 2f)
                {
                    if (!NavMesh.SamplePosition(p, out var hit, r, NavMesh.AllAreas))
                        continue;
                    owner.transform.position = hit.position;
                    navigator.Warp(hit.position);
                    UnityEngine.Physics.SyncTransforms();
                    if (navigator.Agent.isOnNavMesh) return true;
                }

                return false;
            }
            protected void Finish(bool isFinish)
            {
                if (finishCallback != null) finishCallback.Invoke(isFinish);
                else Reset();
            }
            protected bool CanWarp(float distance)
            {
                return IsValid() && owner.Data?.Setup?.Controller?.AllowedDistanceToWarp(distance) == true;
            }
            protected bool Warp(Vector3 target)
            {
                return Warp(target, CanWarp(Vector3.Distance(CurrentPoint, target)));
            }
            protected bool Warp(Vector3 target, bool canWarp)
            {
                if (!canWarp || !IsValid()) return false;
                if (navigator.GetNearestNavmeshPosition(target, out var position, 1f)) return navigator.Warp(position);
                else
                {
                    owner.Teleport(target);
                    return true;
                }
            }
            public void SetDestination(Vector3 target, UnityAction<bool> callback, bool faceMoveTowardsTarget = false)
            {
                if (!navigator)
                {
                    if (callback != null) callback.Invoke(false);
                    return;
                }
                if (!TryEnsureNavMeshAgent())
                {
                    if (callback != null) callback.Invoke(false);
                    return;
                }
                Reset();

                owner.Ducked = false;
                currentSpeed = 0;
                finishCallback = callback;
                this.target = null;

                endPoint = target;

                if (inWater) SetFlag(ModeMove.WaterMoveDown, true);
                else
                {
                    SetMoveTo(true);
                    Move(EndPoint);
                }
            }
            public void SetDestination(BaseEntity target, UnityAction<bool> callback, bool faceMoveTowardsTarget = true)
            {
                if (!navigator)
                {
                    if (callback != null) callback.Invoke(false);
                    return;
                }
                if (!TryEnsureNavMeshAgent())
                {
                    if (callback != null) callback.Invoke(false);
                    return;
                }
                Reset();

                owner.Ducked = false;
                currentSpeed = 0;
                finishCallback = callback;
                this.target = target;

                SetFlag(ModeMove.TargetMove, true);
                if (inWater) SetFlag(ModeMove.WaterMoveDown, true);
                else
                {
                    SetMoveTo(true);
                    Move(EndPoint);
                }
            }

            /// <summary>MaxxInvaders bridge deposit: use max configured walk speed immediately (avoids slow ramp from <c>currentSpeed == 0</c>).</summary>
            public void SetDestinationFast(Vector3 worldPos, UnityAction<bool> callback, bool faceMoveTowardsTarget = false)
            {
                if (!navigator)
                {
                    if (callback != null) callback.Invoke(false);
                    return;
                }
                if (!TryEnsureNavMeshAgent())
                {
                    if (callback != null) callback.Invoke(false);
                    return;
                }

                Reset();

                owner.Ducked = false;
                currentSpeed = Mathf.Clamp(MaxSpeedMoveToGround, 0, 3);
                finishCallback = callback;
                this.target = null;

                endPoint = worldPos;

                if (inWater) SetFlag(ModeMove.WaterMoveDown, true);
                else
                {
                    SetMoveTo(true);
                    Move(EndPoint);
                }
            }

            protected bool WaterMoveDown(Vector3 target)
            {
                if (owner.transform.position.y > target.y && !Physics.Raycast(owner.transform.position, Vector3.down, 0.1f, layerMaskToObstacle))
                {
                    owner.transform.Translate(Vector3.down * 0.1f);
                    owner.SendNetworkUpdate();
                    return true;
                }
                else
                {
                    return false;
                }
            }
            protected bool WaterMoveDown()
            {
                if (!Physics.Raycast(owner.transform.position, Vector3.down, 0.1f, layerMaskToObstacle))
                {
                    owner.transform.Translate(Vector3.down * 0.1f);
                    owner.SendNetworkUpdate();
                    return true;
                }
                else
                {
                    return false;
                }
            }
            protected bool WaterMoveUp()
            {
                if (owner.WaterFactor() > 0.8f && !Physics.Raycast(owner.eyes.position, Vector3.up, 0.1f, layerMaskToObstacle))
                {
                    owner.transform.Translate(Vector3.up * 0.1f);
                    owner.SendNetworkUpdate();
                    return true;
                }
                else
                {
                    return false;
                }
            }
            protected bool WaterLerpMove()
            {
                Vector3 endPoint = EndPoint;
                Vector3 currentPos = owner.transform.position;

                float waterFactor = owner.WaterFactor();

                if (waterFactor > 0.85f) currentPos.y += 0.25f;
                else if (waterFactor < 0.45f) currentPos.y += 0.25f;

                if (navigator.Agent != null && navigator.Agent.isOnNavMesh)
                    navigator.Stop();

                Vector3 currentPosFlat = new Vector3(currentPos.x, 0, currentPos.z);
                Vector3 endPointFlat = new Vector3(endPoint.x, 0, endPoint.z);
                float distanceHorizontal = Vector3.Distance(currentPosFlat, endPointFlat);

                float min = TerrainMeta.HeightMap.GetHeight(owner.transform.position);

                if(Physics.Raycast(owner.transform.position + (Vector3.up * 100f), Vector3.down, out var hit, Mathf.Infinity, LayerMask.GetMask("World", "Terrain"))) min = hit.point.y;

                if (distanceHorizontal > 0.1f)
                {
                    float moveSpeed = (MaxSpeedMoveToWater + 1) * 1f;
                    float step = moveSpeed * ThinkStateDelta;

                    Vector3 direction = (endPointFlat - currentPosFlat).normalized;
                    Vector3 newPosFlat = currentPosFlat + direction * step;

                    Vector3 newPos = new Vector3(newPosFlat.x, currentPos.y < min ? min : currentPos.y, newPosFlat.z);
                    owner.transform.position = newPos;

                    owner.SetAimDirection(direction);
                    owner.SendNetworkUpdate();

                    return true;
                }
                else
                {
                    owner.transform.position = new Vector3(currentPos.x, currentPos.y < min ? min : currentPos.y, currentPos.z);
                    owner.SendNetworkUpdate();
                }

                return false;
            }
            public void Reset()
            {
                timeSuicide = 0;
                ResetTimerVelocity();
                target = null;
                modeMove = ModeMove.Idle;
                if (navigator != null && navigator.Agent != null && navigator.Agent.isOnNavMesh)
                    navigator.Stop();
                finishCallback = null;
            }
            protected void ResetTimerVelocity()
            {
                timeNotVelocity = 0;
                lastPosition = CurrentPoint;
            }
            /// <summary>Unity logs Info if <see cref="NavMeshAgent"/> is disabled, not on mesh, or transforms are stale after <see cref="BaseNavigator.Warp"/>.</summary>
            protected bool SafeNavigatorSetDestination(Vector3 navTarget, BaseNavigator.NavigationSpeed speed)
            {
                if (navigator == null) return false;
                if (!TryEnsureNavMeshAgent()) return false;
                UnityEngine.Physics.SyncTransforms();
                var agent = navigator.Agent;
                if (agent == null || !agent.enabled || !agent.isOnNavMesh) return false;
                return navigator.SetDestination(navTarget, speed);
            }

            protected bool Move(Vector3 target)
            {
                if (navigator == null) return false;
                UpdateCurrentPosition(2.5f);

                var agent = navigator.Agent;
                if (agent != null && !agent.isOnNavMesh)
                {
                    for (var radius = 4f; radius <= 16f; radius += 4f)
                    {
                        if (!navigator.GetNearestNavmeshPosition(owner.transform.position, out var snapped, radius))
                            continue;
                        owner.transform.position = snapped;
                        navigator.Warp(snapped);
                        UnityEngine.Physics.SyncTransforms();
                        break;
                    }

                    agent = navigator.Agent;
                    if (agent == null || !agent.isOnNavMesh)
                        return false;
                }

                if (!navigator.GetNearestNavmeshPosition(target, out var position, 8f))
                    return false;
                target = position;

                return SafeNavigatorSetDestination(target, (BaseNavigator.NavigationSpeed)currentSpeed);
            }

#if DebugLog
            public void DrawPatch(BasePlayer initiator, float timerDraw)
            {
                if (HasPath)
                {
                    Vector3 endPoint = EndPoint;
                    initiator?.SendConsoleCommand("ddraw.sphere", timerDraw, Color.black, sphere.position, sphere.radius, true);
                    initiator?.SendConsoleCommand("ddraw.arrow", timerDraw, Color.green, CurrentPoint + Vector3.up * 50f, CurrentPoint, 0.5f);
                    initiator?.SendConsoleCommand("ddraw.arrow", timerDraw, Color.red, endPoint + Vector3.up * 50f, endPoint, 0.5f);
                    initiator?.SendConsoleCommand("ddraw.line", timerDraw, Color.green, CurrentPoint + Vector3.up * 50, endPoint + Vector3.up * 50);
                    if (navigator?.Agent != null) initiator?.SendConsoleCommand("ddraw.arrow", timerDraw, Color.magenta, navigator.Agent.nextPosition + Vector3.up, navigator.Agent.nextPosition, 0.3f, 2000f);
                    if(HasFlag(ModeMove.ObstacleMove)) initiator?.SendConsoleCommand("ddraw.arrow", timerDraw, Color.yellow, obstaclePoint + Vector3.up * 2f, obstaclePoint, 0.2f);
                }
                if (owner) initiator?.SendConsoleCommand("ddraw.line", timerDraw, Color.blue, owner.eyes.position, owner.eyes.position + owner.eyes.HeadRay().direction * 30f, 0.5f);
            }
#endif
            public override string ToString()
            {
                string text = "\n" + base.ToString() + $",    navigator type: {navigator?.GetType().Name}";
                if (IsValid())
                {
                    bool obstacle = HasFlag(ModeMove.ObstacleMove);
                    bool target = HasFlag(ModeMove.TargetMove);
                    string color = obstacle ? "red" : "white";
                    string color2 = target ? "red" : "white";
                    text += $"\nIsMoving: {IsMoving}";
                    text += $"\nModeMove: {modeMove}";
                    text += $"\nObstacle: <color={color}>{obstacle}</color>";
                    text += $"\nTargetMove: <color={color2}>{target}</color>";
                    text += $"\ndistance[{(HasPath ? Vector3.Distance(CurrentPoint, EndPoint) : 0):0.0 m}]";
                    text += $"\nNavigator:";
                    text += $"\n    agent has path[{navigator?.Agent?.hasPath == true}]";
                    text += $"\n    agent in navmesh[{navigator?.Agent?.isOnNavMesh == true}]";
                    text += $"\n    type[{navigator?.CurrentNavigationType}]";
                    text += $"\n    agent velocity[{Mathf.Floor(navigator.Agent.velocity.sqrMagnitude)}]";
                    text += $"\nFinishCallback: {finishCallback != null}";
                    text += $"\nTimeNotVelocity: {(float)timeNotVelocity:0 sec.}";
                    text += $"\ntimeSuicide: {(float)timeSuicide:0 sec.}";
                    text += $"\nCurrentSpeed: {CurrentSpeed}";
                }
                return text;
            }
            protected void SetMoveTo(bool moveGround)
            {
                SetFlag(ModeMove.MoveToWater, !moveGround);
                SetFlag(ModeMove.MoveToGround, moveGround);
                SetFlag(ModeMove.Finish, false);
                if (moveGround)
                {
                    SetFlag(ModeMove.WaterMoveDown, false);
                    SetFlag(ModeMove.WaterMoveUp, false);
                    SetFlag(ModeMove.WaterMoveTarget, false);
                    SetFlag(ModeMove.WaterLerpMove, false);
                }
            }
            public void SetFlag(ModeMove flag, bool add)
            {
                if (add)
                {
                    if (HasFlag(flag)) return;
                    modeMove |= flag;
                }
                else
                {
                    if (!HasFlag(flag)) return;
                    modeMove &= ~flag;
                }
            }
            public bool HasFlag(ModeMove flag) => (modeMove & flag) == flag;

            public enum ModeMove
            {
                Idle, Finish = 1, MoveToGround = 2, MoveToWater = 4, TargetMove = 8, ObstacleMove = 16, WaterMoveDown = 32, WaterMoveUp = 64, WaterMoveTarget = 128, Paused = 256, WaterLerpMove = 512,
            }

            public bool IsTarget<T>(T target) where T : BaseEntity
            {
                if (target == null) return false;
                if (HasTarget) return target == this.target;
                else return false;
            }

            public void SetTarget<T>(T target) where T : BaseEntity
            {
                if (target != null && HasPath)
                {
                    this.target = target;
                    SetFlag(ModeMove.TargetMove, true);
                }
            }
            public void ChangeEndPoint(Vector3 position)
            {
                if (!HasFlag(ModeMove.TargetMove)) endPoint = position;
            }

        }

        public abstract class BotComponent<T> : Pool.IPooled where T : FacepunchBehaviour
        {
            public T owner;
            protected bool isPooled = false;
            public virtual float ThinkStateDelta => CustomPet.ThinkUpdate;

            public virtual void EnterPool()
            {
                owner?.CancelInvoke(ThinkUpdate);
                isPooled = true;
                owner = null;
            }

            public virtual void LeavePool()
            {
                isPooled = false;
            }

            public virtual T2 Init<T2>(T owner) where T2 : BotComponent<T>
            {
                this.owner = owner;
                return this as T2;
            }

            public virtual void Start()
            {
                owner?.InvokeRepeating(ThinkUpdate, ThinkStateDelta, ThinkStateDelta);
            }
            public abstract void Think(float delta);
            public abstract void ThinkUpdate();
            public virtual bool IsValid() => !isPooled;
            public override string ToString() => $"{GetType().Name}" + (IsValid() ? "[<color=green>valid</color>]" : "[<color=red>not valid</color>]");
            public override bool Equals(object obj)
            {
                if (obj is BotComponent<T> other)
                {
                    return this == other;
                }
                return base.Equals(obj);
            }
            public override int GetHashCode()
            {
                return isPooled ? 0 : base.GetHashCode();
            }
            public static implicit operator string(BotComponent<T> p)
            {
                return p.ToString();
            }
            public static implicit operator bool(BotComponent<T> p)
            {
                return p?.isPooled == true;
            }
            public static bool operator ==(BotComponent<T> left, BotComponent<T> right)
            {
                if (left is null && right is null)
                    return true;

                if (left is null || right is null)
                    return left?.isPooled == true || right?.isPooled == true;

                if (left.isPooled && right.isPooled)
                    return false;

                return ReferenceEquals(left, right);
            }
            public static bool operator !=(BotComponent<T> left, BotComponent<T> right)
            {
                return !(left == right);
            }
        }
        #endregion

        #region MemoryBotClasses
        public class MemoryBot
        {
            private DataBot.MemoryData data;
            public Dictionary<int, int> RequiredResources = new();
            public bool IsInit { get; private set; }
            private List<DropContainer> droppedStashes = new();
            private List<DropContainer> droppedContainers = new();

            public MemoryBot(DataBot.MemoryData data)
            {
                this.data = data;
            }
            public void Init()
            {
                IsInit = true;
            }

            public bool AddDroppedContainer(BaseCombatEntity container, float timerKill)
            {
                if (container == null) return false;
                DropContainer dropContainer = container.gameObject.AddComponent<DropContainer>();
                if (container == null) return false;
                if (container is StashContainer) droppedStashes.Add(dropContainer);
                else droppedContainers.Add(dropContainer);
                dropContainer.memoryBot = this;
                dropContainer.StartKill(timerKill);
                return true;
            }
            public void RemoveDropContainer(DropContainer container, bool isStash)
            {
                if (isStash) droppedStashes?.Remove(container);
                else droppedContainers?.Remove(container);
            }
            public IEnumerable<DropContainer> GetDropContainers(bool isStash)
            {
                if (isStash) return droppedStashes;
                else
                {
                    return droppedContainers;
                }
            }
            public IEnumerable<DropContainer> GetDropContainers()
            {
                foreach (var container in droppedStashes) yield return container;
                foreach (var container in droppedContainers) yield return container;
            }

        }
        public class DropContainer : EntityComponent<BaseCombatEntity>
        {
            public MemoryBot memoryBot;
            public bool IsStash => entity is StashContainer;

            protected override void OnDestroy()
            {
                memoryBot?.RemoveDropContainer(this, IsStash);
                base.OnDestroy();
            }

            public void StartKill(float timer)
            {
                if (timer > 0) Invoke(entity.KillMessage, timer);
            }

            public override void KillImmediate()
            {
                entity?.Kill();
            }


        }
        #endregion

        #region BotStateClasses
        public interface IBotState
        {
            BotState.State NameState { get; }
            string ToString();
            void LeaveState(IBotState state);
            void EnterState();
            bool HasTarget { get; }
            IEnumerator routine { get; }
            bool CanObstacle { get; }
            float ObstacleDistance { get; }
            float TimerSuicideController { get; }
            Vector3 TargetPosition { get; }
        }

        public class MinerState : BotState
        {
            private bool HasRequiredResources => owner.Data.CustomMemory.RequiredResources.Count > 0;
            private string phrasesPickupCollectable => owner?.Data?.Setup?.Phrases?.MinerPhrases?.PhrasesPickupCollectable.Phrase;
            private string phrasesPickupItem => owner?.Data?.Setup?.Phrases?.MinerPhrases?.PhrasesPickupItem.Phrase;
            private string phrasesMiningTree => owner?.Data?.Setup?.Phrases?.MinerPhrases?.PhrasesMiningTree.Phrase;
            private string phrasesMiningOre => owner?.Data?.Setup?.Phrases?.MinerPhrases?.PhrasesMiningOre.Phrase;
            private string phrasesLooting => owner?.Data?.Setup?.Phrases?.MinerPhrases?.PhrasesLooting.Phrase;
            private string phrasesBreaking => owner?.Data?.Setup?.Phrases?.MinerPhrases?.PhrasesBreaking.Phrase;
            private string phrasesLootingCorpse => owner?.Data?.Setup?.Phrases?.MinerPhrases?.PhrasesLootingCorpse.Phrase;
            private string phrasesButcherCorpse => owner?.Data?.Setup?.Phrases?.MinerPhrases?.PhrasesButcherCorpse.Phrase;
            public override bool CanEnterState =>
                target != null && !instance.ShouldDeferDroppedForBridgeAutoDeposit(owner);
            public override float ThinkStateDelta => WaitBrain;
            private float distanceAttack => 1.5f;
            private BaseEntity lastTarget;
            private BaseEntity target
            {
                get
                {
                    return GetTargetState<BaseEntity>() is BaseEntity entity && entity != null && entity.IsValid() ? entity : null;
                }
                set
                {
                    if (value?.IsValid() == true) SetTargetState<BaseEntity>(value);
                    else SetTargetState<BaseEntity>(null);
                }
            }
            public override IEnumerator routine => Job();
            public override bool CanObstacle => lastTarget is OreResourceEntity or CollectibleEntity or TreeEntity ? true : false;
            public override float ObstacleDistance => Random.Range(10f, 20f);

            public override void EnterPool()
            {
                lastTarget = null;
                base.EnterPool();
            }
            public override void LeavePool()
            {
                state = State.Miner;
                lastTarget = null;
                base.LeavePool();
            }

            public override void LeaveState(IBotState state)
            {
                lastTarget = null;
                base.LeaveState(state);
            }
            public override void ThinkUpdate()
            {
                try
                {
                    if (IsValid())
                    {
                        BaseEntity entity = target;
                        // if (entity == null || owner.Distance(entity) > brain.RadiusFindEntity) target = brain.GetNearestEntity<BaseEntity>(CheckResources);
                        float distance = entity == null ? float.MaxValue : owner.Distance(entity);
                        if (entity == null || (distance > brain.RadiusFindEntity && distance > 150f)) target = brain.GetNearestEntity<BaseEntity>(CheckResources);
                    }
                    else target = null;
                }
#if DebugLog
                catch (Exception ex)
                {
                    Debug.LogError(RU ? $"[{this}]>>>Ошибка в методе ThinkUpdate: {ex}" : $"[{this}]>>>Error in ThinkUpdate method: {ex}");
                }
#else
                catch { }
#endif
            }

            private bool CheckResources(BaseEntity resource)
            {
                if(!resource.IsValid() || instance == null) return false;
                if (instance.IsDeployableNatureEntity(resource)) return false;
                if (!owner.CanMining(resource)) return false;

                // Hook to check if resource is already being targeted by teammate
                object hookResult = Interface.CallHook("CanRoamingNPCTargetResource", owner, resource);
                if (hookResult is bool canTarget && !canTarget) return false;

                return resource switch
                {
                    CollectibleEntity collectibleEntity => CanMining(collectibleEntity),
                    TreeEntity treeEntity => CanMining(treeEntity),
                    OreResourceEntity oreResourceEntity => CanMining(oreResourceEntity),
                    DroppedItem droppedItem => CanMining(droppedItem),
                    LootContainer lootContainer => CanMining(lootContainer),
                    BaseCorpse corpse => CanButcher(corpse) || owner.CanLootedCorpse(corpse),
                    _ => false
                };
            }
            private bool CanButcher(BaseCorpse corpse)
            {
                return owner.CanButcher(corpse) && owner.HasItem(CustomPet.SlotItemWeapons.Knife);
            }
            private bool CanMining(CollectibleEntity collectibleEntity)
            {
                if (HasRequiredResources)
                {
                    if (collectibleEntity?.IsValid() == true)
                    {
                        foreach (var item in collectibleEntity.itemList)
                        {
                            if (owner.Data.CustomMemory.RequiredResources.ContainsKey(item.itemid) && owner.inventory.containerMain.GetAmount(item.itemid, true) + owner.inventory.containerBelt.GetAmount(item.itemid, true) < owner.Data.CustomMemory.RequiredResources[item.itemid]) return true;
                        }
                    }

                    return false;
                }
                return collectibleEntity?.IsValid() == true;
            }
            private float CalculateProtectionChange(Item itemToWear)
            {
                if (!itemToWear.info.TryGetComponent<ItemModWearable>(out var newItemModWearable)) return 0f;

                float newItemProtection = CalculateTotalProtection(newItemModWearable, itemToWear);
                float removedProtection = 0f;

                foreach (Item wornItem in owner.inventory.containerWear.itemList)
                {
                    if (wornItem == null || wornItem == itemToWear) continue;
                    if (!wornItem.info.TryGetComponent<ItemModWearable>(out var wornModWearable)) continue;

                    if (!newItemModWearable.CanExistWith(wornModWearable))
                    {
                        float protection = CalculateTotalProtection(wornModWearable, wornItem);
                        removedProtection += protection;
                    }
                }

                return newItemProtection - removedProtection;
            }
            private float CalculateTotalProtection(ItemModWearable wearable, Item item)
            {
                float total = 0f;
                total += wearable.GetProtection(item, DamageType.Bullet);
                total += wearable.GetProtection(item, DamageType.Arrow);
                total += wearable.GetProtection(item, DamageType.Bite);
                total += wearable.GetProtection(item, DamageType.Bleeding);
                total += wearable.GetProtection(item, DamageType.Blunt);
                total += wearable.GetProtection(item, DamageType.Cold);
                total += wearable.GetProtection(item, DamageType.Explosion);
                total += wearable.GetProtection(item, DamageType.Radiation);
                total += wearable.GetProtection(item, DamageType.Slash);
                total += wearable.GetProtection(item, DamageType.Stab);
                return total;
            }
            private bool CanMining(DroppedItem droppedItem)
            {
                if(droppedItem?.IsValid() == true && droppedItem?.item?.info != null && droppedItem?.item?.info?.category == ItemCategory.Attire)
                {
                    if(CalculateProtectionChange(droppedItem.item) <= 0f) return false;
                }

                if (HasRequiredResources)
                {
                    if (droppedItem?.IsValid() == true && droppedItem.item?.info != null && owner.Data.CustomMemory.RequiredResources.ContainsKey(droppedItem.item.info.itemid) && owner.inventory.containerMain.GetAmount(droppedItem.item.info.itemid, true) + owner.inventory.containerBelt.GetAmount(droppedItem.item.info.itemid, true) < owner.Data.CustomMemory.RequiredResources[droppedItem.item.info.itemid]) return true;
                    return false;
                }
                return droppedItem?.IsValid() == true;
            }
            private bool CanMining(ResourceEntity oreResourceEntity)
            {
                bool hasTool = false;
                if (!hasTool && oreResourceEntity.ShortPrefabName == "wood-pile") hasTool = owner.HasItem(CustomPet.SlotItemTools.Hatchet);
                if (!hasTool && oreResourceEntity is TreeEntity) hasTool = owner.HasItem(CustomPet.SlotItemTools.Hatchet);
                if (!hasTool) hasTool = owner.HasItem(CustomPet.SlotItemTools.Pickaxe);
                if (!hasTool) return false;
                if (HasRequiredResources)
                {
                    if (oreResourceEntity?.IsValid() == true)
                    {
                        foreach (var item in oreResourceEntity.resourceDispenser.containedItems)
                        {
                            if (owner.Data.CustomMemory.RequiredResources.ContainsKey(item.itemid) && owner.inventory.containerMain.GetAmount(item.itemid, true) + owner.inventory.containerBelt.GetAmount(item.itemid, true) < owner.Data.CustomMemory.RequiredResources[item.itemid]) return true;
                        }
                        foreach (var item in oreResourceEntity.resourceDispenser.finishBonus)
                        {
                            if (owner.Data.CustomMemory.RequiredResources.ContainsKey(item.itemid) && owner.inventory.containerMain.GetAmount(item.itemid, true) + owner.inventory.containerBelt.GetAmount(item.itemid, true) < owner.Data.CustomMemory.RequiredResources[item.itemid]) return true;
                        }
                    }

                    return false;
                }
                return oreResourceEntity?.IsValid() == true;
            }
            private bool CanMining(LootContainer lootContainer)
            {
                bool hasTool = true;
                if (lootContainer.ShortPrefabName.Contains("loot_barrel") || lootContainer.ShortPrefabName.Contains("loot-barrel") || lootContainer.ShortPrefabName.Contains("oil_barrel") || lootContainer.ShortPrefabName.Contains("roadsign") || lootContainer is NaturalBeehive) hasTool = owner.HasItem(CustomPet.SlotItemTools.Hatchet) || owner.HasItem(CustomPet.SlotItemTools.Pickaxe) || owner.HasItem(CustomPet.SlotItemWeapons.Melee) || owner.HasItem(CustomPet.SlotItemWeapons.Knife);
                if (!hasTool) return false;
                return lootContainer?.IsValid() == true;
            }
            public void OnCollectiblePickedup(Item item)
            {
            }
            private bool ActivatedTool(BaseEntity resource)
            {
                if (!resource || !IsValid()) return false;
                if ((resource.ShortPrefabName == "wood-pile" || resource is TreeEntity) && owner.ActivatedItem(CustomPet.SlotItemTools.Hatchet)) return true;
                else if (owner.ActivatedItem(CustomPet.SlotItemTools.Pickaxe)) return true;
                else if (resource is LootContainer && (owner.ActivatedItem(CustomPet.SlotItemWeapons.Melee) || owner.ActivatedItem(CustomPet.SlotItemWeapons.Weapon) || owner.ActivatedItem(CustomPet.SlotItemWeapons.Knife))) return true;
                else return false;
            }
            public void TransferAllItemsToContainer(LootableCorpse corpse)
            {
                for (int i = 0; i < corpse.containers.Length; i++)
                {
                    ItemContainer itemContainer2 = corpse.containers[i];
#if CARBON || OXIDE
                    if (!corpse.CanLootContainer(itemContainer2, i))
                    {
                        continue;
                    }
#endif

                    for (int j = 0; j < itemContainer2.capacity; j++)
                    {
                        Item slot = itemContainer2.GetSlot(j);
                        if (slot != null)
                        {
                            owner.GiveItem(slot);
                        }
                    }
                }
            }
            public void TransferAllItemsToContainer(DroppedItem corpse)
            {
                if (corpse.item == null)
                {
                    return;
                }

                if (corpse.item.contents != null && corpse.item.IsBackpack())
                {
                    int capacity = corpse.item.contents.capacity;
                    for (int i = 0; i < capacity; i++)
                    {
                        if (corpse.item.contents != null)
                        {
                            Item slot = corpse.item.contents.GetSlot(i);
                            if (slot != null)
                            {
                                owner.GiveItem(slot);
                            }
                        }
                    }
                }

                if (corpse.item != null)
                {
                    Item slot = corpse.item;
                    corpse.RemoveItem();
                    owner.GiveItem(slot);
                }
            }
            public void MoveItems(ItemContainer target)
            {
                if (!IsValid()) return;
                for (int num = target.itemList.Count - 1; num >= 0; num--)
                {
                    owner.GiveItem(target.itemList[num]);
                }
            }
            protected override void RemoveTarget(BaseEntity target, bool hasIgnore)
            {
                this.target = null;
                base.RemoveTarget(target, hasIgnore);
            }

            private bool CanAccessContainer(LootContainer container)
            {
                if (!container || !IsValid()) return false;

                Vector3 containerCenter = container.CenterPoint();
                Vector3 ownerEyes = owner.eyes.position;

                if (!owner.CanSee(ownerEyes, containerCenter)) return false;

                return true;
            }

            private IEnumerator Job()
            {
                yield return CoroutineEx.waitForSeconds(WaitBrain);
                if (IsValid())
                {
                    if (lastTarget != target)
                    {
                        lastTarget = target;
                        StopMove();
                    }

                    if (target != null)
                    {
                        if (moveMode == MoveMode.Finish)
                        {
                            switch (target)
                            {
                                case CollectibleEntity collectible:
                                    {
                                        yield return PickupResource(collectible);
                                        break;
                                    }
                                case TreeEntity treeEntity:
                                    {
                                        if (ActivatedTool(treeEntity))
                                        {
                                            float treeMul = Mathf.Max(0.08f,
                                                owner?.Data?.Setup?.MinerState?.TreeMiningStrikeDelayMultiplier ?? 1f);
                                            yield return MiningResource(treeEntity, treeMul);
                                        }
                                        else RemoveTarget(treeEntity, true);
                                        break;
                                    }
                                case OreResourceEntity oreEntity:
                                    {
                                        if (ActivatedTool(oreEntity))
                                        {
                                            float multOre = owner?.Data?.Setup?.MinerState?.OreGatherYieldMultiplier ?? 1f;
                                            int strikes = Mathf.Clamp(Mathf.RoundToInt(multOre), 1, 6);
                                            for (var si = 0; si < strikes; si++)
                                            {
                                                if (!oreEntity.IsValid()) yield break;
                                                yield return MiningResource(oreEntity, si == 0 ? 1f : 0.42f);
                                            }
                                        }
                                        else RemoveTarget(oreEntity, true);
                                        break;
                                    }
                                case LootContainer lootContainer:
                                    {
                                        if (lootContainer.ShortPrefabName.Contains("loot_barrel") || lootContainer.ShortPrefabName.Contains("loot-barrel") || lootContainer.ShortPrefabName.Contains("oil_barrel") || lootContainer.ShortPrefabName.Contains("roadsign") || lootContainer is NaturalBeehive)
                                        {
                                            if (ActivatedTool(lootContainer))
                                            {
                                                yield return MiningResource(lootContainer, 1f);
                                            }
                                            else yield return LootingContainer(lootContainer);
                                        }
                                        else yield return LootingContainer(lootContainer);
                                        break;
                                    }
                                case DroppedItem droppedItem:
                                    {
                                        yield return PickupResource(droppedItem);
                                        break;
                                    }
                                case BaseCorpse corpse:
                                    {
                                        if (corpse is LootableCorpse lootableCorpse && owner.CanLootedCorpse(corpse)) yield return LootingCorpse(lootableCorpse);
                                        if (owner.CanButcher(corpse) && owner.ActivatedItem(CustomPet.SlotItemWeapons.Knife))
                                        {
                                            yield return AttackedCorpse(corpse, 1f);
                                        }
                                        else RemoveTarget(corpse, true);
                                        break;
                                    }
                                default: RemoveTarget(target, true); break;
                            }
                            StopMove();
                        }
                        else
                        {
                            if (moveMode == MoveMode.NotFinish)
                            {
                                RemoveTarget(target, true);
                                StopMove();
                            }
                            else if (!IsMoved())
                            {
                                if (target is DroppedItem) StartMove(target);
                                else StartMove(target.transform.position);
                            }
                        }
                    }
                    else
                    {
                        brain.ChangeState(null);
                    }
                }
            }
            private IEnumerator PickupResource(CollectibleEntity entity)
            {
                if (!entity || !IsValid()) yield break;
                yield return PhraseTo(phrasesPickupCollectable);
                if (!entity || !IsValid()) yield break;
                owner.SignalBroadcast(BaseEntity.Signal.Gesture, "pickup_item", null);
                entity?.DoPickup(owner, false);
            }
            private IEnumerator LootingContainer(LootContainer entity)
            {
                if (!entity || !IsValid()) yield break;

                if (!CanAccessContainer(entity))
                {
                    RemoveTarget(entity, true);
                    yield break;
                }

                yield return PhraseTo(phrasesLooting);
                if (!entity || !IsValid()) yield break;
                owner.SignalBroadcast(BaseEntity.Signal.Gesture, "pickup_item", null);
                entity.ClientRPC(RpcTarget.NetworkGroup("PickupSound"));
                MoveItems(entity.inventory);
                if (entity.inventory.IsEmpty()) entity.Kill();
            }
            private IEnumerator PickupResource(DroppedItem entity)
            {
                if (!entity || !IsValid()) yield break;
                yield return PhraseTo(phrasesPickupItem);
                if (!entity || !IsValid()) yield break;
                owner.SignalBroadcast(BaseEntity.Signal.Gesture, "pickup_item", null);
                entity.ClientRPC(RpcTarget.NetworkGroup("PickupSound"));
                TransferAllItemsToContainer(entity);
            }
            private IEnumerator MiningResource(BaseEntity resource, float wait)
            {
                if (!resource || !IsValid()) yield break;

                yield return PhraseTo(resource is TreeEntity ? phrasesMiningTree : resource is OreResourceEntity ? phrasesMiningOre : resource is LootContainer ? phrasesBreaking : "");

                HeldEntity heldEntity = owner.GetHeldEntity();
                ToggleTool(heldEntity, true);
                owner.AttackMelee(heldEntity, resource);
                yield return CoroutineEx.waitForSeconds(wait);

                var heldAfter = owner.GetHeldEntity();
                // Chainsaw: ToggleTool(false) kills the engine between swings — feels broken for lumberjack gather.
                // Leave the saw running while chopping trees / wood piles; other tools still reset normally.
                var woodChop = resource is TreeEntity ||
                               (resource is ResourceEntity wre && wre.ShortPrefabName == "wood-pile");
                if (!(heldAfter is Chainsaw && woodChop))
                    ToggleTool(heldAfter, false);
            }
            private IEnumerator AttackedCorpse(BaseCorpse corpse, float wait)
            {
                if (!corpse || !IsValid()) yield break;

                yield return CoroutineEx.waitForSeconds(WaitBrain);

                BaseMelee heldEntity = owner.GetHeldEntity() as BaseMelee;
                ToggleTool(heldEntity, true);
                owner.AttackMelee(heldEntity, corpse);
                yield return PhraseTo(phrasesButcherCorpse);
                ToggleTool(owner?.GetHeldEntity(), false);
                yield break;
            }
            private IEnumerator LootingCorpse(LootableCorpse corpse)
            {
                if (!corpse || !IsValid()) yield break;
                yield return PhraseTo(phrasesLootingCorpse);
                if (!corpse || !IsValid()) yield break;
                owner.SignalBroadcast(BaseEntity.Signal.Gesture, "pickup_item", null);
                corpse.ClientRPC(RpcTarget.NetworkGroup("PickupSound"));
                TransferAllItemsToContainer(corpse);
            }
        }

        public class HunterState : BattleState<BaseCombatEntity>
        {
            public override float radiusWeaponAttacked => owner?.Data?.Setup?.HunterState?.RadiusWeaponAttacked ?? base.radiusWeaponAttacked;
            public override float radiusMeleeAttacked => owner?.Data?.Setup?.HunterState?.RadiusMeleeAttacked ?? base.radiusMeleeAttacked;
            protected override string phraseStartAttack => owner?.Data?.Setup?.Phrases?.HunterPhrases?.PhrasesStartAttack.Phrase;
            protected override BaseCombatEntity Target
            {
                get
                {
                    return GetTargetState<BaseCombatEntity>() is BaseCombatEntity animal && animal?.IsAlive() == true && animal?.InSafeZone() != true ? animal : null;
                }

                set
                {
                    if (value != null && !value.InSafeZone()) SetTargetState<BaseCombatEntity>(value);
                    else SetTargetState<BaseCombatEntity>(null);
                }

            }
            public override bool CanEnterState => Target is BaseCombatEntity target && target != null &&
                                                  (IsAggressiveToOwner(target) || owner.CanHunt() ||
                                                   IsBridgeAnimalRetaliationTarget(target));
            public override IEnumerator routine => Job();
            public override float ObstacleDistance => Random.Range(20f, 50f);

            public override void LeavePool()
            {
                state = State.Hunter;
                base.LeavePool();
            }

            /// <summary>MaxxInvaders: streamer was damaged by this animal — hunt it even when <see cref="SetupHunting.CanHunt"/> is false.</summary>
            private bool IsBridgeAnimalRetaliationTarget(BaseCombatEntity entity)
            {
                if (owner?.Data == null || entity == null || entity.net == null) return false;
                if (UnityEngine.Time.realtimeSinceStartup >= owner.Data.BridgeRetaliationExpireTime) return false;
                return owner.Data.BridgeRetaliationAnimalNetId != 0UL &&
                       entity.net.ID.Value == owner.Data.BridgeRetaliationAnimalNetId;
            }

            private bool CheckTarget(BaseCombatEntity target)
            {
                if (target == null || target.InSafeZone()) return false;
                if (IsBridgeAnimalRetaliationTarget(target)) return true;
                return target switch
                {
                    BaseAnimalNPC animalNPC => owner.CanHunterAnimal(animalNPC) || IsAggressiveToOwner(animalNPC),
                    BaseNPC2 animalNPC => owner.CanHunterAnimal(animalNPC) || IsAggressiveToOwner(animalNPC),
                    _ => false
                };
            }
            protected override bool UpdateTarget()
            {
                BaseCombatEntity target = null;
                if (IsValid() && !owner.InSafeZone())
                {
                    if (owner.Data != null && owner.Data.BridgeRetaliationAnimalNetId != 0UL &&
                        UnityEngine.Time.realtimeSinceStartup < owner.Data.BridgeRetaliationExpireTime)
                    {
                        var ent = BaseNetworkable.serverEntities.Find(new NetworkableId(owner.Data.BridgeRetaliationAnimalNetId)) as
                            BaseCombatEntity;
                        if (ent == null || !ent.IsAlive())
                        {
                            var hadDefense = owner.Data.BridgeRetaliationAnimalNetId != 0UL ||
                                             owner.Data.BridgeRetaliationTargetUserId != 0UL;
                            owner.Data.BridgeRetaliationAnimalNetId = 0UL;
                            owner.Data.BridgeRetaliationTargetUserId = 0UL;
                            owner.Data.BridgeRetaliationExpireTime = 0f;
                            if (hadDefense && owner.Data.SpawnedFromMaxxInvadersBridge)
                                instance?.ScheduleResumeBridgeTaskAfterDefense(owner);
                        }
                        else if (!ent.InSafeZone() && CheckTarget(ent) && owner.Distance(ent) < 150f)
                            target = ent;
                    }

                    if (target == null)
                        target = brain.GetNearestEntity<BaseCombatEntity>(CheckTarget);
                    if (target != null && !IsAggressiveToOwner(target) && !owner.CanHunt() &&
                        !IsBridgeAnimalRetaliationTarget(target))
                        target = null;
                }

                if (owner.Data != null && UnityEngine.Time.realtimeSinceStartup >= owner.Data.BridgeRetaliationExpireTime)
                {
                    var hadDefense = owner.Data.BridgeRetaliationAnimalNetId != 0UL ||
                                     owner.Data.BridgeRetaliationTargetUserId != 0UL;
                    owner.Data.BridgeRetaliationAnimalNetId = 0UL;
                    owner.Data.BridgeRetaliationTargetUserId = 0UL;
                    if (hadDefense && owner.Data.SpawnedFromMaxxInvadersBridge)
                        instance?.ScheduleResumeBridgeTaskAfterDefense(owner);
                }

                SetTargetState<BaseCombatEntity>(target);
                return target != null;
            }
            protected override bool IsAggressiveToOwner(BaseCombatEntity entity)
            {
                return IsValid() && entity?.IsAlive() == true && entity?.InSafeZone() != true && entity switch
                {
                    null => false,
                    BaseAnimalNPC animalNPC => (animalNPC.brain.CurrentState is AnimalBrain.ChaseState || animalNPC.brain.CurrentState is AnimalBrain.AttackState) && animalNPC.brain.Events.Memory.Entity.Get(animalNPC.brain.Events.CurrentInputMemorySlot) == owner,
                    BaseNPC2 animalNPC => animalNPC.IsAnimal && animalNPC.TryGetComponent<SenseComponent>(out var sense) && sense.FindTarget(out var target) && target == owner,
                    _ => false,
                };
            }

            #region Coroutines
            private IEnumerator Job()
            {
                if (IsValid())
                {
                    yield return CoroutineEx.waitForSeconds(WaitBrain);
                    if (!IsValid()) yield break;

                    if (Target != null)
                    {
                        yield return Attacker(owner.PriorityMeleeHunting());
                    }

                    yield return CoroutineEx.waitForSeconds(WaitBrain);
                }
            }

            #endregion
        }

        public class AttackerState : BattleState<BasePlayer>
        {
            private TimeSince lastSeenTarget = 0f;
            private float targetMemoryDuration = 10f;

            protected override string phraseStartAttack => owner?.Data?.Setup?.Phrases?.AttackerPhrases?.PhrasesStartAttack.Phrase;
            protected override string phrasesNotVisibleTarget => owner?.Data?.Setup?.Phrases?.AttackerPhrases?.PhrasesNotVisibleTarget.Phrase;
            protected override string phrasesRunAway => owner?.Data?.Setup?.Phrases?.AttackerPhrases?.PhrasesRunAway.Phrase;
            public override float radiusWeaponAttacked => owner?.Data?.Setup?.BattleState?.RadiusWeaponAttacked ?? base.radiusWeaponAttacked;
            public override float radiusMeleeAttacked => owner?.Data?.Setup?.BattleState?.RadiusMeleeAttacked ?? base.radiusMeleeAttacked;
            protected override BasePlayer Target
            {
                get
                {
                    return IsValid() && GetTargetState<BasePlayer>() is BasePlayer player && player?.IsAlive() == true && player?.InSafeZone() != true && owner?.InSafeZone() != true ? player : null;
                }
                set
                {
                    if (value != null && value?.IsAlive() == true && !value.InSafeZone()) SetTargetState<BasePlayer>(value);
                    else SetTargetState<BasePlayer>(null);
                }

            }
            public override bool CanEnterState => Target != null;
            public override IEnumerator routine => Job();
            public override float ObstacleDistance => Random.Range(5f, 10f);

            public override void EnterPool()
            {
                lastSeenTarget = float.MaxValue; 
                base.EnterPool();
            }

            public override void LeavePool()
            {
                state = State.Battle;
                base.LeavePool();
            }

            public override void LeaveState(IBotState state)
            {
                lastSeenTarget = float.MaxValue;
                base.LeaveState(state);
            }

            protected override bool UpdateTarget()
            {
                BasePlayer target = null;
                BasePlayer current = Target;

                if (IsValid() && !owner.InSafeZone())
                {
                    if (owner.Data != null && IsBridgeRetaliationActive() && owner.Data.BridgeRetaliationTargetUserId != 0UL)
                    {
                        var retal = BasePlayer.FindByID(owner.Data.BridgeRetaliationTargetUserId);
                        if (retal != null && CheckTarget(retal))
                            target = retal;
                    }

                    if (target == null)
                        target = brain.GetNearestEntity<BasePlayer>(CheckTarget);

                    if (target != null) lastSeenTarget = 0f;
                }

                if (target == null && current != null)
                {
                    // MaxxInvaders: while streamer-defense retaliation is active, do not keep a stale non-attacker target.
                    if (owner.Data != null && IsBridgeRetaliationActive() &&
                        owner.Data.BridgeRetaliationTargetUserId != 0UL &&
                        current.userID != owner.Data.BridgeRetaliationTargetUserId)
                    {
                        /* drop current — let retaliation acquire the real attacker */
                    }
                    else if (IsAggressiveToOwner(current) || lastSeenTarget < targetMemoryDuration)
                    {
                        target = current;
                    }
                }

                if (owner.Data != null && !IsBridgeRetaliationActive())
                {
                    var hadDefense = owner.Data.BridgeRetaliationTargetUserId != 0UL ||
                                     owner.Data.BridgeRetaliationAnimalNetId != 0UL;
                    owner.Data.BridgeRetaliationTargetUserId = 0UL;
                    owner.Data.BridgeRetaliationAnimalNetId = 0UL;
                    if (hadDefense && owner.Data.SpawnedFromMaxxInvadersBridge)
                        instance?.ScheduleResumeBridgeTaskAfterDefense(owner);
                }

                if (target != null && owner.Distance(target) > 150f)
                {
                    RemoveTarget(target, true);
                    target = null;
                    lastSeenTarget = float.MaxValue;
                }
                else SetTargetState<BasePlayer>(target);

                return target != null;
            }

            private bool IsBridgeRetaliationActive()
            {
                return owner?.Data != null &&
                       UnityEngine.Time.realtimeSinceStartup < owner.Data.BridgeRetaliationExpireTime;
            }

            private bool CheckTarget(BasePlayer player)
            {
                if (owner?.Data == null)
                    return false;
                if (player == null || player.IsAlive() != true || player.InSafeZone())
                    return false;
                if (!(owner.IsVisible(player, layerVisible) || player.IsVisible(owner, layerVisible)))
                    return false;
                if ((owner?.Data?.Setup?.BattleState._ignoreSleepingPlayers ?? false) && player.IsSleeping())
                    return false;

                if (owner.Data.BridgeProtectAnchorUserId != 0UL &&
                    player.userID == owner.Data.BridgeProtectAnchorUserId)
                    return false;

                if (IsBridgeRetaliationActive() && player.userID == owner.Data.BridgeRetaliationTargetUserId)
                {
                    // Slightly looser than normal LOS so defense still engages near cover / doorways.
                    if (owner.IsVisible(player, layerVisible) || player.IsVisible(owner, layerVisible))
                        return true;
                    return owner.Distance(player) < 42f;
                }

                return IsAggressiveToOwner(player) || owner.GetPersonality() == PersonalityBot.Aggressive;
            }
            protected override bool IsAggressiveToOwner(BaseCombatEntity entity)
            {
                if (!IsValid() || entity == null) return false;
                if (entity is global::HumanNPC npc && npc && npc.IsTarget(owner)) return true;
                else if (entity is BasePlayer player && player.IsHostile()) return true;
                return false;
            }

            #region Coroutines
            private IEnumerator Job()
            {
                if (IsValid())
                {
                    yield return CoroutineEx.waitForSeconds(WaitBrain);
                    if (!IsValid()) yield break;

                    if (Target?.IsValid() == true)
                    {
                        var retaliate = owner.Data != null && IsBridgeRetaliationActive() &&
                                        Target.userID == owner.Data.BridgeRetaliationTargetUserId;
                        if (owner.GetPersonality() == PersonalityBot.Friendly && !retaliate)
                        {
                            // Friendly + MaxxInvaders bridge: old logic nulled target every tick, which blocked
                            // streamer defense (retaliation never kept a combat target). Skip wipe while defense is active.
                            if (owner.Data?.SpawnedFromMaxxInvadersBridge == true &&
                                owner.Data.BridgeProtectAnchorUserId != 0UL)
                            {
                                if (IsBridgeRetaliationActive())
                                    yield break;

                                SetTargetState<BasePlayer>(null);
                                yield break;
                            }

                            yield return RunAwayCoroutine();
                        }
                        else
                        {
                            yield return Attacker(false);
                        }
                    }

                    yield return CoroutineEx.waitForSeconds(WaitBrain);
                }
            }

            #endregion
        }
        public abstract class BattleState<T> : BotState where T : BaseCombatEntity
        {
            protected CustomPet.SlotItemWeapons slot;
            private AttackedForWeaponInfo currentAttaced;
            private TimeSince downTimer = 0f;
            private TimeSince cooldownTimer = 0f;
            private bool canDown => !owner.IsInvoking(OnDown) && cooldownTimer > 2f;
            private bool isDown => owner?.IsInvoking(OnDown) == true;
            private TimeSince reloadTimer;
            private TimeSince aimingTimer;
            private float radiusRunAway = 150f;
            protected bool canFire = false;
            private TimeSince lastSuccessfulEngagement = 0f;
            private float engagementTimeout => owner?.Data?.Setup?.BattleState?._forgetTimer ?? 20f;
            private T currentTrackedTarget = null;
            private float lastTargetHealth = 0f;
            public override float ThinkStateDelta => WaitBrain;
            public virtual float radiusWeaponAttacked => 30f;
            public virtual float radiusMeleeAttacked => 2f;
            protected bool canUseAmmo => owner?.Data?.Setup?.ItemsWeapon.CanUseAmmo ?? true;
            protected virtual string phrasesRunAway => "";
            protected virtual string phrasesNotVisibleTarget => "";
            protected virtual string phraseStartAttack => "";
            public override float TimerSuicideController => 0;
            protected abstract T Target { get; set; }
            protected int layerVisible = LayerMask.GetMask("Player (Server)", "World", "Terrain", "Construction", "Default", "Deployed", "AI", "Tree", "Vehicle Large", "Vehicle World");

            public override void EnterPool()
            {
                canFire = false;
                phraseTime = 0;
                lastSuccessfulEngagement = 0f;
                currentTrackedTarget = null;
                lastTargetHealth = 0f;
                currentAttaced = default;
                base.EnterPool();
            }
            public override void LeavePool()
            {
                canFire = false;
                phraseTime = 0;
                lastSuccessfulEngagement = 0f;
                currentTrackedTarget = null;
                lastTargetHealth = 0f;
                base.LeavePool();
            }
            public override void LeaveState(IBotState state)
            {
                canFire = false;
                lastSuccessfulEngagement = 0f;
                currentTrackedTarget = null;
                lastTargetHealth = 0f;
                owner.modelState.aiming = false;
                ToggleTool(owner?.GetHeldEntity(), false);
                RemoveTarget(Target, false);
                owner.SendNetworkUpdateImmediate();
                if(isDown) StopDown();
                base.LeaveState(state);
            }
            public override void EnterState()
            {
                owner.modelState.aiming = false;
                owner.SendNetworkUpdateImmediate();
                base.EnterState();
            }
            public override void ThinkUpdate()
            {
                UpdateTarget();
                CheckEngagementTimeout();
            }

            protected void CheckEngagementTimeout()
            {
                if (IsValid() && Target != null)
                {
                    if (currentTrackedTarget != Target)
                    {
                        currentTrackedTarget = Target;
                        lastSuccessfulEngagement = 0f;
                        lastTargetHealth = Target.Health();
                    }
                    else
                    {
                        float currentHealth = Target.Health();
                        if (currentHealth < lastTargetHealth)
                        {
                            lastSuccessfulEngagement = 0f;
                            lastTargetHealth = currentHealth;
                        }
                        else
                        {
                            lastTargetHealth = currentHealth;
                        }
                    }

                    if (lastSuccessfulEngagement > engagementTimeout)
                    {
                        RemoveTarget(Target, true);
                        currentTrackedTarget = null;
                        lastSuccessfulEngagement = 0f;
                        lastTargetHealth = 0f;
                    }
                }
            }

            protected bool IsReloadWeapon(BaseProjectile weapon)
            {
                return weapon.ServerIsReloading() || reloadTimer < GetTimerReload(weapon);
            }
            private float GetTimerReload(BaseProjectile weapon) => weapon switch
            {
                Speargun => 3f,
                CrossbowWeapon => 6f,
                MiniCrossbow => 10,
                CompoundBowWeapon => 4,
                BowWeapon => 2,
                _ => weapon.reloadTime,
            };
            /// <summary>Uses <see cref="SetupBattle.AimWindupSeconds"/> (default was hardcoded 1s — sluggish vs moving targets).</summary>
            protected float AimingWindupSeconds =>
                owner?.Data?.Setup?.BattleState?.AimWindupSeconds ?? 0.28f;

            protected bool IsAiming()
            {
                return aimingTimer < AimingWindupSeconds;
            }
            protected bool ActivateWeapon(BaseCombatEntity target, bool priorityMelee = false)
            {
                if (!IsValid() || target == null) return false;
                slot = priorityMelee ? CustomPet.SlotItemWeapons.Melee : CustomPet.SlotItemWeapons.Weapon;
                if (owner.ActivatedItem(slot)) return true;
                slot = slot == CustomPet.SlotItemWeapons.Weapon ? CustomPet.SlotItemWeapons.Melee : CustomPet.SlotItemWeapons.Weapon;
                return owner.ActivatedItem(slot);
            }
            protected void WeaponFire(BaseProjectile weapon, BaseCombatEntity target)
            {
                if (!IsValid()) return;
                if(weapon.MuzzlePoint == null) return;

                if (!canFire)
                {
                    if (weapon.primaryMagazine.contents <= 0) Reload(weapon);
                    else canFire = true;
                }
                else if (weapon.HasAttackCooldown())
                {
                    owner.SetAimDirectionWeapon(weapon, target);
                    return;
                }
                else if (IsAiming())
                {
                    // Previously no updates during wind-up — moving targets caused misses and wasted bursts.
                    owner.SetAimDirectionWeapon(weapon, target);
                    return;
                }
                else if (!IsReloadWeapon(weapon) && canFire && !IsAiming())
                {
                    owner.SetAimDirectionWeapon(weapon, target);
                    if (owner.modelState.aiming == false)
                    {
                        owner.modelState.aiming = true;
                        aimingTimer = 0;
                        owner.SendNetworkUpdateImmediate();
                        weapon.SendNetworkUpdateImmediate();
                        return;
                    }
                    canFire = false;
                    owner.WeaponFire(weapon);
                    owner.SendNetworkUpdateImmediate();
                    weapon.SendNetworkUpdateImmediate();
                    if (weapon is BowWeapon or CrossbowWeapon) Reload(weapon);
                }
            }
            protected bool Reload(BaseProjectile weapon)
            {
                if (!IsValid()) return false;
                if (canUseAmmo)
                {
                    if (!weapon.TryReloadMagazine(owner.inventory))
                    {
                        owner.SignalBroadcast(BaseEntity.Signal.DryFire);
                        owner.SendNetworkUpdateImmediate();
                        weapon.SendNetworkUpdateImmediate();
                        return false;
                    }
                }
                else
                {
                    weapon.SetAmmoCount(weapon.primaryMagazine.capacity);
                }
                if (weapon is CompoundBowWeapon compoundBow) compoundBow.SetFieldValue("stringHoldTimeStart", UnityEngine.Time.time);
                reloadTimer = 0;
                canFire = true;
                weapon.UpdateShieldState(true);
                owner.SignalBroadcast(weapon is BowWeapon ? BaseEntity.Signal.Attack : BaseEntity.Signal.Reload);
                owner.SendNetworkUpdateImmediate();
                weapon.SendNetworkUpdateImmediate();
                return true;
            }
            public void OnNpcTarget(BaseCombatEntity enemy)
            {
                // if (!IsValid()) return;
                // if (!IsAggressiveToOwner(Target)) SetTargetState<BasePlayer>(enemy);
            }
            protected override void RemoveTarget(BaseEntity target, bool hasIgnore)
            {
                base.RemoveTarget(target, hasIgnore);
                SetTargetState<BasePlayer>(null);
            }
            protected abstract bool IsAggressiveToOwner(BaseCombatEntity target);
            protected abstract bool UpdateTarget();
            private void OnDown()
            {
                if(downTimer > 1.5f || !currentAttaced.IsValid())
                {
                    StopDown();
                    return;
                }
                WeaponFire(currentAttaced.weapon, currentAttaced.enemy);
            }
            private void StartDown()
            {
                downTimer = 0f;
                owner.InvokeRepeating(OnDown, 0f, 0.03f);
            }
            private void StopDown()
            {
                cooldownTimer = 0f;
                owner.CancelInvoke(OnDown);
            }
            private IEnumerator Attacked(BaseCombatEntity target)
            {
                if(moveMode == MoveMode.NotFinish && target is global::HumanNPC)
                {
                    RemoveTarget(target, true);
                    yield break;
                }
                if (IsMoved() && owner.MoveController.HasTarget)
                {
                    if (!owner.MoveController.IsTarget(target))
                    {
                        owner.MoveController.SetTarget(target);
                    }
                }
                switch (slot)
                {
                    case CustomPet.SlotItemWeapons.Weapon:
                        {
                            Item weapon = owner.GetActiveItem();
                            BaseProjectile heldEntity = weapon?.GetHeldEntity() as BaseProjectile;
                            if (heldEntity != null && !weapon.isBroken)
                            {
                                if(currentAttaced.IsValid())
                                {
                                    if(currentAttaced.enemy != target || currentAttaced.weapon != heldEntity)
                                    {
                                        if(isDown) StopDown();
                                        currentAttaced = default;
                                    }
                                }
                                float distance = owner.Distance(target);
                                if (distance >= radiusWeaponAttacked)
                                {
                                    Vector3 position = target.transform.position;
                                    if (!IsMoved())
                                    {
                                        StartMove(target);
                                    }
                                    break;
                                }
                                if (!owner.CanSee(owner.CenterPoint(), target.CenterPoint()))
                                {
                                    if (!IsMoved())
                                    {
                                        StartMove(target);
                                    }
                                    yield return PhraseTo(phrasesNotVisibleTarget);
                                    yield break;
                                }
                                else
                                {
                                    if (distance < 5f)
                                    {
                                        if ((!canFire || IsReloadWeapon(heldEntity)) && !IsAiming())
                                        {
                                            Vector3 position = target.transform.position + (target.transform.position - owner.transform.position).normalized * -10f;
                                            HeightMap.ToGroundPoint(ref position);
                                            if (!IsMoved())
                                            {
                                                StartMove(position, true);
                                            }
                                            yield return PhraseTo(phraseStartAttack);
                                            // WeaponFire(heldEntity, target);
                                            if(canDown)
                                            {
                                                currentAttaced = new(target, heldEntity);
                                                StartDown();
                                            }
                                            yield break;
                                        }
                                    }
                                }
                                owner.SetAimDirectionWeapon(heldEntity, target);
                                StopMove();
                                yield return PhraseTo(phraseStartAttack);
                                // WeaponFire(heldEntity, target);
                                if(canDown)
                                {
                                    currentAttaced = new(target, heldEntity);
                                    StartDown();
                                }
                            }
                            break;
                        }
                    case CustomPet.SlotItemWeapons.Melee:
                        {
                            if(isDown)
                            {
                                StopDown();
                                currentAttaced = default;
                            }
                            Item weapon = owner.GetActiveItem();
                            BaseMelee heldEntity = weapon?.GetHeldEntity() as BaseMelee;
                            if (heldEntity != null)
                            {
                                float distance = owner.Distance(target);
                                if (distance > radiusMeleeAttacked)
                                {
                                    if (!IsMoved())
                                    {
                                        StartMove(target);
                                    }
                                    break;
                                }
                                if (!owner.CanSee(owner.CenterPoint(), target.CenterPoint()))
                                {
                                    if (!IsMoved())
                                    {
                                        StartMove(target);
                                    }
                                    yield return PhraseTo(phrasesNotVisibleTarget);
                                    break;
                                }
        
                                StopMove();
                                if (owner.Distance(target) <= radiusMeleeAttacked)
                                {
                                    yield return PhraseTo(phraseStartAttack);
                                    ToggleTool(heldEntity, true);
                                    owner.AttackMelee(heldEntity, target);
                                }

                            }
                            break;
                        }
                    default:
                        {
                            if(isDown)
                            {
                                StopDown();
                                currentAttaced = default;
                            }
                            break;
                        }
                }
                yield break;
            }

            protected IEnumerator Attacker(bool priorityMeleeHunting)
            {
                if (IsValid())
                {
                    yield return CoroutineEx.waitForSeconds(WaitBrain);
                    if (!IsValid()) yield break;

                    if (Target is BaseCombatEntity target && target.IsValid())
                    {
                        if (ActivateWeapon(target, priorityMeleeHunting))
                        {
                            yield return Attacked(target);
                        }
                        else
                        {
                            if (owner.Data?.SpawnedFromMaxxInvadersBridge == true &&
                                owner.Data.BridgeProtectAnchorUserId != 0UL)
                                yield break;
                            yield return RunAwayCoroutine();
                        }
                    }

                    yield return CoroutineEx.waitForSeconds(WaitBrain);
                }
            }

            protected IEnumerator RunAwayCoroutine()
            {
                if (IsValid())
                {
                    yield return CoroutineEx.waitForSeconds(WaitBrain);

                    if (Target is BaseCombatEntity target && target?.IsValid() == true)
                    {
                        if (owner.Distance(target) < radiusRunAway)
                        {
                            Vector3 position = target.transform.position + (target.transform.position - owner.transform.position).normalized * -(radiusRunAway + 5f);
                            HeightMap.ToGroundPoint(ref position);
                            if (!IsMoved())
                            {
                                StartMove(position);
                                yield return PhraseTo(phrasesRunAway);
                            }
                            else
                            {
                                owner.MoveController.ChangeEndPoint(position);
                                yield return PhraseTo(phrasesRunAway);
                            }
                        }
                        else RemoveTarget(target, true);
                    }
                }
            }

            public struct AttackedForWeaponInfo
            {
                public readonly BaseCombatEntity enemy;
                public readonly BaseProjectile weapon;
                private readonly BasePlayer owner;

                public AttackedForWeaponInfo(BaseCombatEntity enemy, BaseProjectile weapon)
                {
                    this.enemy = enemy;
                    this.weapon = weapon;
                    owner = weapon.GetOwnerPlayer();
                }

                public readonly bool IsValid()
                {
                    return owner.IsValid() && owner.IsAlive() && !owner.IsWounded() && !owner.IsIncapacitated() && enemy.IsValid() && enemy.IsAlive() && weapon.IsValid() && owner.GetHeldEntity() == weapon;
                }
            }
        }

        public class MedicalState : BotState
        {
            private Vector3 lastEscapeDirection;
            private TimeSince escapeUpdateDir;
            public override bool CanEnterState => !owner.InWaterState && owner.Health() < owner.MaxHealth() && owner.HasItem(CustomPet.SlotItemUseItems.Medical);
            public override IEnumerator routine => Job();

            private string phrase => owner?.Data?.Setup?.Phrases?.MedicalState.Phrase;

            public override void LeavePool()
            {
                state = State.Medical;
                lastEscapeDirection = Vector3.zero;
                base.LeavePool();
            }

            public override void Start()
            {
            }
            private IEnumerator Job()
            {
                if (IsValid())
                {
                    yield return CoroutineEx.waitForSeconds(WaitBrain);
                    if (!IsValid()) yield break;

                    if(escapeUpdateDir > 3f && TryGetFleePosition(out Vector3 pos))
                    {
                        escapeUpdateDir = 0;
                        StartMove(pos);
                    }

                    if (owner.HasUseItem(CustomPet.SlotItemUseItems.Medical, out (Item, ItemModConsume) component))
                    {
                        if (component.Item2 is ItemModConsume mod)
                        {
                            if (!owner.metabolism.CanConsume() && mod.CanDoAction(component.Item1, owner))
                            {
                                yield return PhraseTo(phrase);
                                mod.DoAction(component.Item1, owner);
                                yield return CoroutineEx.waitForSeconds(4f);
                            }
                        }
                    }
                    else
                    {
                        MedicalTool medical = IsValid() && owner.metabolism.CanConsume() && owner.ActivatedItem(CustomPet.SlotItemUseItems.Medical) && owner.GetActiveItem() is Item item && item.IsValid() && item.amount > 0 && item?.GetHeldEntity() is MedicalTool medicalTool && !medicalTool.HasAttackCooldown() ? medicalTool : null;

                        if (medical)
                        {
                            yield return PhraseTo(phrase);
                            medical.ServerUse();
                            yield return CoroutineEx.waitForSeconds(5f);
                        }
                    }

                    yield return CoroutineEx.waitForSeconds(WaitBrain);
                }
            }
            private bool TryGetFleePosition(out Vector3 position)
            {
                position = Vector3.zero;
                Vector3 dir = CalculateEscapeDirection();
                // Debug.LogTest($"TryGetFleePosition: {dir}");
                if(dir == Vector3.zero)
                {
                    lastEscapeDirection = dir;
                    return false;
                }
                if(lastEscapeDirection == dir) return false;
                
                position = owner.transform.position + dir * 300f;
                HeightMap.ToGroundPoint(ref position);
                if(owner.MoveController?.Navigator?.GetNearestNavmeshPosition(position, out var pos, 1f) == true) position = pos;
                lastEscapeDirection = dir;
                return true;
            }
            // Метод возвращает нормализованное направление для побега
            public Vector3 CalculateEscapeDirection()
            {
                Vector3 escapeDirection = Vector3.zero;
                Vector3 ownerPosition = owner.transform.position;

                foreach (BaseCombatEntity enemy in brain.GetTypeEntity<BaseCombatEntity>(CanEnemy))
                {
                    Vector3 directionToEnemy = enemy.transform.position - ownerPosition;
                    float distance = directionToEnemy.sqrMagnitude;

                    // Игнорируем слишком далёких врагов
                    if (distance > 2500f || distance == 0) continue;

                    // Чем ближе враг — тем сильнее отталкивание (обратная пропорция)
                    float weight = 1.0f / distance; // можно использовать 1/distance или 1/distance²
                    escapeDirection -= directionToEnemy.normalized * weight; // отталкивание = противоположно направлению к врагу
                }

                escapeDirection.y = 0; // игнорируем высоту
                escapeDirection.Normalize();

                return escapeDirection;
            }
            private bool CanEnemy(BaseCombatEntity entity)
            {
                if(!entity.IsAlive() || entity is not (BasePlayer or BaseNpc or BaseNPC2)) return false;
                return true;
            }
        }

        /// <summary>MaxxInvaders bridge: path to anchor and apply revive/full heal or partial heal when low.</summary>
        public class BridgeAnchorMedicState : BotState
        {
            public override bool CanEnterState
            {
                get
                {
                    if (owner?.Data?.SpawnedFromMaxxInvadersBridge != true) return false;
                    if (owner.Data.BridgeProtectAnchorUserId == 0UL) return false;
                    var setup = owner.Data.Setup?.BridgeMedic;
                    if (setup == null || !setup.Enable) return false;
                    var anchor = BasePlayer.FindByID(owner.Data.BridgeProtectAnchorUserId);
                    if (anchor == null || !anchor.IsAlive()) return false;
                    return AnchorNeedsHelp(anchor, setup);
                }
            }

            public override IEnumerator routine => Job();

            private static bool AnchorNeedsHelp(BasePlayer anchor, SetupBridgeMedic setup)
            {
                if (setup.ReviveWhenWounded &&
                    (anchor.IsWounded() || anchor.HasPlayerFlag(BasePlayer.PlayerFlags.Incapacitated)))
                    return true;
                float mh = anchor.MaxHealth();
                if (mh <= 0f) return false;
                return anchor.Health() / mh < Mathf.Clamp01(setup.HealBelowHealthFraction);
            }

            public override void LeavePool()
            {
                state = State.BridgeAnchorMedic;
                base.LeavePool();
            }

            public override void EnterPool()
            {
                state = State.BridgeAnchorMedic;
                base.EnterPool();
            }

            private IEnumerator Job()
            {
                while (IsValid())
                {
                    yield return CoroutineEx.waitForSeconds(WaitBrain);
                    if (!IsValid()) yield break;

                    var setup = owner.Data.Setup?.BridgeMedic;
                    if (setup == null || !setup.Enable) yield break;

                    var anchor = BasePlayer.FindByID(owner.Data.BridgeProtectAnchorUserId);
                    if (anchor == null || !anchor.IsAlive()) yield break;

                    if (!AnchorNeedsHelp(anchor, setup))
                        yield break;

                    bool urgent = setup.ReviveWhenWounded &&
                                  (anchor.IsWounded() ||
                                   anchor.HasPlayerFlag(BasePlayer.PlayerFlags.Incapacitated));
                    if (!urgent && owner.Data.BridgeMedicLastActionRealtime > 0f &&
                        UnityEngine.Time.realtimeSinceStartup <
                        owner.Data.BridgeMedicLastActionRealtime +
                        Mathf.Max(0.5f, setup.CooldownSeconds))
                        continue;

                    float actionDist = Mathf.Clamp(setup.ActionDistanceMeters, 1.5f, 12f);
                    if (owner.Distance(anchor) > actionDist)
                    {
                        StartMove(anchor);
                        yield return CoroutineEx.waitForSeconds(WaitBrain);
                        continue;
                    }

                    StopMove();

                    try
                    {
                        if (urgent)
                        {
                            bool down = anchor.IsWounded() ||
                                        anchor.HasPlayerFlag(BasePlayer.PlayerFlags.Incapacitated);
                            if (down)
                                anchor.RecoverFromWounded();
                            BridgeMedicHarmfulMetabolismReflectiveReset(anchor.metabolism);
                            anchor.Heal(99999f);
                            instance.BridgeMedicRegisterReviveStabilizeWindow(anchor);
                        }
                        else
                        {
                            float mh = anchor.MaxHealth();
                            float targetFrac = Mathf.Clamp01(setup.HealBelowHealthFraction + 0.08f);
                            float targetHp = mh * Mathf.Max(targetFrac, setup.HealBelowHealthFraction + 0.02f);
                            float need = Mathf.Clamp(targetHp - anchor.Health(), 8f, 150f);
                            if (need > 3f)
                                anchor.Heal(need);
                        }

                        owner.Data.BridgeMedicLastActionRealtime = UnityEngine.Time.realtimeSinceStartup;
                    }
                    catch (Exception ex)
                    {
                        Debug.LogWarning($"[RoamingNPCs] BridgeAnchorMedic: action failed: {ex.Message}");
                    }

                    yield return CoroutineEx.waitForSeconds(Mathf.Max(0.25f, WaitBrain * 0.5f));
                }
            }
        }

        public class DroppedState : BotState
        {
            private Vector3 positionStash = Vector3.zero;
            private int layer = LayerMask.GetMask("World", "Terrain", "Construction", "Default");
            private static readonly int PreventBuildingLayer = LayerMask.GetMask("Prevent Building");
            private static readonly int BuildingCheckLayers = LayerMask.GetMask("Default", "Construction", "Deployed");
            private static readonly int DeployedLayer = LayerMask.NameToLayer("Deployed");
            private bool hasPositionStash => positionStash != Vector3.zero;
            private string phrase => owner?.Data?.Setup?.Phrases?.FullState.Phrase;
            public override bool CanEnterState => owner.inventory.containerMain.IsFull();
            public override IEnumerator routine => Job1();
            public override float ObstacleDistance => Random.Range(10f, 20f);
            public Vector3 RandomDirectionHorizontal => new Vector3(Random.Range(-1f, 1f), 0f, Random.Range(-1f, 1f)).normalized;
            public override bool CanObstacle => false;
            protected override bool hasSuicideState => true;

            public override void EnterPool()
            {
                positionStash = Vector3.zero;
                base.EnterPool();
            }
            public override void LeavePool()
            {
                state = State.Dropped;
                base.LeavePool();
            }
            public override void Start()
            {
            }
            private bool CanBuild()
            {
                bool result = false;
                if (IsValid() && hasPositionStash)
                {
                    result = owner.CanBuild() && HeightMap.IsInTerrain(positionStash, 1f, 4f) && !instance.monuments.HasMonument(positionStash) && !CheckRoad(positionStash) && !WaterLevel.Test(positionStash, true, true);
                
                    if(result)
                    {
                        bool noMonuments = Physics.OverlapSphere(positionStash, 1f, PreventBuildingLayer).Length == 0;
                        bool noIceAndCliffs = true, noDeployedEntitiesAround = true, noCupboards = true;

                        if(noMonuments)
                        {
                            var ents = Physics.OverlapSphere(positionStash, 10f, BuildingCheckLayers);
                            noCupboards = ents.Where((x) => x?.ToBaseEntity() is BuildingPrivlidge).Count() == 0;

                            if(noCupboards)
                            {
                                foreach (var collider in ents)
                                {
                                    if (collider == null) continue;

                                    string colliderName = collider.name;

                                    if (colliderName.Contains("ice_sheet")
                                        || colliderName.Contains("iceberg")
                                            || colliderName.Contains("shore_ice")
                                                || colliderName.Contains("cliff")
                                                    || colliderName.Contains("rocks")
                                                            || colliderName.Contains("rock_formation"))
                                    {
                                        noIceAndCliffs = false;
                                        break;
                                    }

                                    if(noDeployedEntitiesAround)
                                    {
                                        if(collider.gameObject.layer == DeployedLayer)
                                        {
                                            noDeployedEntitiesAround = false;
                                            break;
                                        }
                                    }
                                }
                            }
                        }

                        if (!noMonuments || !noCupboards || !noIceAndCliffs || !noDeployedEntitiesAround) result = false;
                    }
                }
                if (!result && hasPositionStash) positionStash = Vector3.zero;
                return result;
            }
            private bool CheckPosition(Vector3 position)
            {
                if (!IsValid()) return false;
                if (HeightMap.IsInTerrain(position, 1f, 4f) && !instance.monuments.HasMonument(position) && !CheckRoad(position) && !WaterLevel.Test(position, true, true))
                {
                    if (Physics.Raycast(position + Vector3.up, Vector3.down, out var hit, 5f))
                    {
                        if(hit.collider.gameObject.layer != LayerMask.NameToLayer("Terrain"))
                        {
                            positionStash = Vector3.zero;
                            return false;
                        }
                    }

                    positionStash = position;
                    return true;
                }
                positionStash = Vector3.zero;
                return false;
            }
            private void EndFind()
            {
                positionStash = Vector3.zero;
            }
            
            private IEnumerator Job1()
            {
                if (IsValid())
                {
                    yield return CoroutineEx.waitForSeconds(WaitBrain);

                    if (!IsValid()) yield break;

                    if (owner.CanDroppedContainer())
                    {
                        if (CheckPosition(owner.transform.position) && CanBuild())
                        {
                            StopMove();
                            yield return DropItemsFromFullContainerCoroutine(owner.transform.position);
                        }
                        else if(CanSuicideState)
                        {
                            owner.TryDropNonKitLootFromMainToWorld();
                            if (!owner.inventory.containerMain.IsFull()) yield break;
                            owner.Suicide();
                        }
                        else if (moveMode != MoveMode.Moving)
                        {
                            Vector3 dir = new Vector3(Random.Range(-1f, 1f), 0f, Random.Range(-1f, 1f)).normalized;
                            if(CanUsePosition(dir, Random.Range(150f, 250f), out var pos))
                            {
                                StartMove(pos);
                            }
                        }
                    }
                    else
                    {
                        owner.TryDropNonKitLootFromMainToWorld();
                        if (!owner.inventory.containerMain.IsFull()) yield break;

                        owner.Suicide();
                    }
                }
                
                bool CanUsePosition(Vector3 direction, float distance, out Vector3 pos)
                {
                    pos = owner.transform.position + direction * distance;
                    HeightMap.SetHeight(ref pos, 0.1f, 200f, layer, QueryTriggerInteraction.Ignore);
                    if(WaterLevel.Test(pos, true, true)) return false;
                    if(owner?.MoveController?.Navigator?.GetNearestNavmeshPosition(pos, out pos, 1f) == true)
                    {
                        return true;
                    }
                    return false;
                }
            }
            private IEnumerator Job2()
            {
                if (IsValid())
                {
                    yield return CoroutineEx.waitForSeconds(WaitBrain);

                    if (!IsValid()) yield break;

                    if (owner.CanDroppedContainer())
                    {
                        if (moveMode == MoveMode.Idle)
                        {
                            positionStash = owner.transform.position;
                            HeightMap.SetHeight(ref positionStash, 0.1f, 200f, layer, QueryTriggerInteraction.Ignore);

                            if (CheckPosition(positionStash) && CanBuild())
                            {
                                yield return DropItemsFromFullContainerCoroutine(positionStash);
                            }
                            else
                            {
                                yield return FindIdealPositionMap(positionStash, 8f, CheckPositionAndBuild, EndFind);

                                if (IsValid())
                                {
                                    if (hasPositionStash) StartMove(positionStash);
                                    else
                                    {
                                        owner.TryDropNonKitLootFromMainToWorld();
                                        if (!owner.inventory.containerMain.IsFull()) yield break;
                                        owner.Suicide();
                                    }
                                }
                                else yield break;
                            }
                        }
                        else
                        {
                            if (moveMode == MoveMode.Finish)
                            {
                                yield return DropItemsFromFullContainerCoroutine(positionStash);
                            }
                            else if (moveMode == MoveMode.NotFinish)
                            {
                                positionStash = owner.transform.position;
                                HeightMap.SetHeight(ref positionStash, 0.1f, 200f, layer, QueryTriggerInteraction.Ignore);

                                if (CheckPosition(positionStash) && CanBuild())
                                {
                                    yield return DropItemsFromFullContainerCoroutine(positionStash);
                                }
                                else
                                {
                                    owner.TryDropNonKitLootFromMainToWorld();
                                    if (!owner.inventory.containerMain.IsFull()) yield break;
                                    owner.Suicide();
                                }
                            }
                        }
                    }
                    else
                    {
                        owner.TryDropNonKitLootFromMainToWorld();
                        if (!owner.inventory.containerMain.IsFull()) yield break;

                        owner.Suicide();
                    }
                }
            }

            private bool CheckPositionAndBuild(Vector3 candidatePosition)
            {
                HeightMap.SetHeight(ref candidatePosition, 0.1f, 200f, layer, QueryTriggerInteraction.Ignore);
                return CheckPosition(candidatePosition) && CanBuild();
            }
            
            private IEnumerator DropItemsFromFullContainerCoroutine(Vector3 position)
            {
                yield return PhraseTo(phrase);

                if (IsValid())
                {
#if DebugLog
                    Debug.Log<DroppedState>(RU ? $"Создан контейнер с ресурсами на позиции[{position}]" : $"Created container with resources at position[{position}]");
#endif
                    owner.DropItemsFromFullContainer(position);
                }

                yield return CoroutineEx.waitForSeconds(WaitBrain);
            }
        }

        public class ResearcherState : BotState
        {
            private List<MonumentInfo> interestMonuments;
            private List<MonumentInfo> visitedMonuments;
            private List<MonumentInfo> buffer;
            private MonumentInfo currentMonument => GetTargetState<MonumentInfo>();
            private List<Vector3> _path;
            private int currentIndex = 0;
            private float lastTimerUpdatePosition;
            private Vector3 lastUpdatePosition;
            private string phraseBeforeMove => owner?.Data?.Setup?.Phrases?.ResearcherPhrases?.PhrasesBeforeMove.Phrase;
            private string phraseAfterMove => owner?.Data?.Setup?.Phrases?.ResearcherPhrases?.PhrasesAfterMove.Phrase;
            public override bool CanEnterState =>
                currentMonument != null && !instance.ShouldDeferDroppedForBridgeAutoDeposit(owner);
            public override IEnumerator routine => Job();
            public override float ObstacleDistance => Random.Range(50f, 200f);
            protected override float TimerSuicideState => owner.Data?.Setup?.ResearcherState?.GetTimerSuicide() ?? 0f;
            protected override bool hasSuicideState => TimerSuicideState > 0;

            public override void EnterPool()
            {
                Pool.FreeUnmanaged(ref interestMonuments);
                Pool.FreeUnmanaged(ref visitedMonuments);
                Pool.FreeUnmanaged(ref buffer);
                Pool.FreeUnmanaged(ref _path);
                lastUpdatePosition = Vector3.zero;
                lastTimerUpdatePosition = 0;
                base.EnterPool();
            }
            public override void LeavePool()
            {
                state = State.Researcher;
                interestMonuments = Pool.Get<List<MonumentInfo>>();
                visitedMonuments = Pool.Get<List<MonumentInfo>>();
                buffer = Pool.Get<List<MonumentInfo>>();
                _path = Pool.Get<List<Vector3>>();
                currentIndex = 0;
                result = null;
                base.LeavePool();
            }
            protected override bool CanModifyPath(Vector3 position)
            {
                if (currentMonument is MonumentInfo monument)
                {
                    return instance.monuments.TryGetNearestMonument(position, out var _monument) && monument == _monument ? false : true;
                }
                return base.CanModifyPath(position);
            }


            public override void Start()
            {
                instance.monuments.GetMonuments(interestMonuments, CanAddMonument, false);
            }
            private bool CanAddMonument(MonumentInfo monument)
            {
                return owner?.Data?.Setup?.ResearcherState?.CanVisit(monument) ?? false;
            }
            private void FindPathMonument(MonumentInfo monument, List<Vector3> path)
            {
                if (monument != null)
                {
                    Vector3 center = monument.transform.position + monument.Bounds.center;
                    Vector3 size = monument.Bounds.size / 2;
                    int max = owner?.Data?.Setup?.ResearcherState?.MaxPointPathFromMonuments ?? 5;
                    max = max <= 0 ? 5 : Math.Min(max, 10);
                    for (int i = 0; i < max; i++)
                    {
                        Vector3 point = center + new Vector3(Random.Range(-size.x, size.x), center.y, Random.Range(-size.z, size.z));
                        point.y = TerrainMeta.HeightMap.GetHeight(point);
                        HeightMap.ToGroundPoint(ref point);
                        path.Add(point);
                    }
                }
            }
            private bool CanSuicide()
            {
                if(CanSuicideState) return true;
                if(lastUpdatePosition == Vector3.zero || lastTimerUpdatePosition < UnityEngine.Time.time)
                {
                    lastTimerUpdatePosition = UnityEngine.Time.time + 5;
                    if(Vector3.Distance(owner.transform.position, lastUpdatePosition) > 2f) ResetSuicideTimer();
                    lastUpdatePosition = owner.transform.position;
                }
                return false;
            }

            private IEnumerator Job()
            {
                if (IsValid())
                {
                    yield return CoroutineEx.waitForSeconds(WaitBrain);
                    if (!IsValid()) yield break;

                    if(CanSuicide())
                    {
                        owner.Suicide();
                        yield break;
                    }

                    if (currentMonument == null)
                    {
                        SetTargetState<MonumentInfo>(GetNextMonument(_path));
                    }
                    else
                    {
                        if (!visitedMonuments.Contains(currentMonument))
                        {
                            if (moveMode == MoveMode.Idle)
                            {
                                if (currentIndex < _path.Count)
                                {
                                    Vector3 position = _path[currentIndex];
                                    StartMove(position);
                                    currentIndex++;
                                }
                                else
                                {
                                    visitedMonuments.Add(currentMonument);
                                }
                            }
                            else if (!IsMoved())
                            {
                                if (moveMode == MoveMode.NotFinish)
                                {
                                    visitedMonuments.Add(currentMonument);
                                }
                                else
                                {
                                    yield return PhraseTo(phraseAfterMove);
                                }
                                StopMove();
                            }
                        }
                        else
                        {
                            yield return PhraseTo(phraseBeforeMove);
                            SetTargetState<MonumentInfo>(GetNextMonument(_path));
                        }

                    }
                }
            }
            MonumentInfo result = null;
            protected MonumentInfo GetNextMonument(List<Vector3> path)
            {
                currentIndex = 0;
                path.Clear();
                result = null;
                if (interestMonuments.Count == visitedMonuments.Count)
                {
                    if (interestMonuments.Count == 0)
                    {
                        SetTargetState<MonumentInfo>(result);
                    }
                    else
                    {
                        visitedMonuments.Clear();
                        result = interestMonuments.GetRandom();
                        FindPathMonument(result, path);
                        SetTargetState<MonumentInfo>(result);
                    }
                }
                else
                {
                    if (interestMonuments.Count > 0)
                    {
                        buffer.Clear();
                        foreach (var monument in interestMonuments) if (!visitedMonuments.Contains(monument)) buffer.Add(monument);
                        if (buffer.Count > 0)
                        {
                            result = buffer.GetRandom();
                            FindPathMonument(result, path);
                            SetTargetState<MonumentInfo>(result);
                        }
                        else
                        {
                            SetTargetState<MonumentInfo>(result);
                        }
                    }
                }
                return result;
            }

        }

        public abstract class BotState : BotComponent<CustomPet>, IBotState
        {
            protected State state = 0;
            private TimeSince timerSuicideState;
            private MonoBehaviour targetState;
            public abstract bool CanEnterState { get; }
            protected TimeSince phraseTime;
            protected Brain brain => owner != null ? owner.CustomBrain : null;
            public State NameState => state;
            public virtual float WaitBrain => owner != null ? owner.ThinkBrain : CustomPet.ThinkUpdate;
            private bool canUsePhrases => owner?.Data?.Setup?.Phrases?.Enabled ?? false;
            public virtual bool CanObstacle => true;
            public virtual float ObstacleDistance => Random.Range(10f, 50f);
            public virtual float TimerSuicideController => owner?.Data?.Setup?.Controller?.GetTimerSuicide() ?? 600f;
            protected virtual float TimerSuicideState => owner?.Data?.Setup?.Controller?.GetTimerSuicide() ?? 600f;
            private bool canPlayPhrase
            {
                get
                {
                    if (phraseTime < phraseTimer)
                    {
                        return false;
                    }
                    phraseTime = 0;
                    return true;
                }
            }
            protected virtual float phraseTimer => 5f;
            State IBotState.NameState => NameState;
            bool IBotState.HasTarget => CanEnterState;
            public abstract IEnumerator routine { get; }
            Vector3 IBotState.TargetPosition => targetState?.transform.position ?? Vector3.zero;
            protected MoveMode moveMode = MoveMode.Idle;
            protected virtual bool hasSuicideState => false;
            protected bool CanSuicideState => hasSuicideState && timerSuicideState > TimerSuicideState;

            #region PoolOverrides
            public override void EnterPool()
            {
                moveMode = MoveMode.Idle;
                targetState = null;
                base.EnterPool();
            }
            public override void LeavePool()
            {
                moveMode = MoveMode.Idle;
                targetState = null;
                base.LeavePool();
            }

            #endregion

            #region AbstractOverrides
            public override void Think(float delta)
            {
            }
            public override void ThinkUpdate()
            {
            }
            #endregion

            #region Methods
            protected void ResetSuicideTimer()
            {
                timerSuicideState = 0;
            }
            public bool IsMoved()
            {
                // if(moveMode == MoveMode.Moving && owner?.MoveController?.HasPath != true) moveMode = MoveMode.Idle;
                return moveMode == MoveMode.Moving;
            }
            public override bool IsValid()
            {
                return brain != null && !owner.IsWounded() && base.IsValid();
            }
            protected virtual void RemoveTarget(BaseEntity target, bool hasIgnore)
            {
                brain?.RemoveEntity(target, hasIgnore);
            }
            public virtual void LeaveState(IBotState state)
            {
                StopMove();
                if (IsValid())
                {
                    Interface.Oxide.CallHook("ResetMoveBuildController", owner);
#if DebugLog
                    Debug.Log<BotState>(RU ? $"{owner.displayName} вышел из состояние {this}" : $"{owner.displayName} left state {this}");
#endif
                }
            }
            public virtual void EnterState()
            {
                ResetSuicideTimer();
                if (IsValid())
                {
                    owner.Ducked = false;
#if DebugLog
                    Debug.Log<BotState>(RU ? $"{owner.displayName} изменил состояние на {this}" : $"{owner.displayName} changed state to {this}");
#endif
                }
            }
            public override string ToString()
            {
                string text = $"{NameState}[target: {(GetTargetState<MonumentInfo>() is MonumentInfo monument ? monument.displayPhrase.english : GetTargetState<BasePlayer>() is BasePlayer player ? player.displayName : GetTargetState<BaseEntity>() is BaseEntity entity ? entity.ShortPrefabName : "not target")}]   move mode[{moveMode}]";
                text += $"\nSuicide state: {(hasSuicideState ? (((float)timerSuicideState).ToString("0.0") + " / " + TimerSuicideController.ToString("0.0")) : "Disable")}";
                return text;
            }
            protected void MovedFinishCallback(bool isFinish)
            {
                if (owner?.Data?.BridgeDepositApproachActive == true)
                    return;
                if (isFinish)
                {
                    moveMode = MoveMode.Finish;
                    owner?.MoveController?.Reset();
                }
                else
                {
                    moveMode = MoveMode.NotFinish;
                    owner?.MoveController?.Reset();
                }
            }
            protected virtual bool CanModifyPath(Vector3 position) => true;
            protected void ToggleTool(HeldEntity tool, bool isEnable)
            {
                if (!tool) return;
                if (tool is Chainsaw chainsaw)
                {
                    if (isEnable && !chainsaw.HasFlag(BaseEntity.Flags.On)) chainsaw.SetEngineStatus(true);
                    else if (!isEnable && chainsaw.HasFlag(BaseEntity.Flags.On)) chainsaw.SetEngineStatus(false);
                    return;
                }
                BaseEntity.Flags flag = tool switch
                {
                    Jackhammer => BaseEntity.Flags.Reserved8,
                    _ => 0
                };
                if (flag > 0 && ((isEnable && !tool.HasFlag(flag)) || !isEnable)) tool.SetFlag(flag, isEnable);
            }
            public virtual T GetTargetState<T>() where T : MonoBehaviour
            {
                return targetState != null && targetState is T ? targetState as T : null;
            }
            public void SetTargetState<T>(MonoBehaviour target) where T : MonoBehaviour
            {
                targetState = target != null && target is T ? target : null;
            }
            public void StopMove()
            {
                if (owner?.Data?.BridgeDepositApproachActive == true)
                    return;
                owner?.MoveController?.Reset();
                moveMode = MoveMode.Idle;
            }
            protected void StartMove(BaseEntity target, bool faceMoveTowardsTarget = false)
            {
                if (owner?.Data?.BridgeDepositApproachActive == true)
                    return;
                if (IsValid() && owner?.MoveController?.IsValid() == true && target != null)
                {
                    moveMode = MoveMode.Moving;
                    if(Interface.Oxide.CallHook("IsMovedBuildController", owner, target.transform.position, new UnityAction<bool>(MovedFinishCallback)) == null)
                    {
                        owner.MoveController.SetDestination(target, MovedFinishCallback, faceMoveTowardsTarget);
                    }
                }
                else StopMove();
            }
            protected void StartMove(Vector3 target, bool faceMoveTowardsTarget = false)
            {
                if (owner?.Data?.BridgeDepositApproachActive == true)
                    return;
                if (IsValid() && target != Vector3.zero && owner?.MoveController?.IsValid() == true)
                {
                    moveMode = MoveMode.Moving;
                    if(Interface.Oxide.CallHook("IsMovedBuildController", owner, target, new UnityAction<bool>(MovedFinishCallback)) == null)
                    {
                        owner.MoveController.SetDestination(target, MovedFinishCallback, faceMoveTowardsTarget);
                    }
                }
                else StopMove();
            }
            #endregion

            #region Coroutines
            protected IEnumerator PhraseTo(string nameFile)
            {
                if (!IsValid() || !canUsePhrases || string.IsNullOrEmpty(nameFile)) yield break;
                if (canPlayPhrase) owner.CallVoiceToPosition(nameFile);
                yield return CoroutineEx.waitForSeconds(WaitBrain);
            }
            protected IEnumerator FindIdealPositionMap(Vector3 start, float step, Func<Vector3, bool> checkPosition, UnityAction endFind)
            {
                if (checkPosition != null && endFind != null)
                {
                    yield return CoroutineEx.waitForSeconds(WaitBrain);
                    if (IsValid())
                    {
                        HashSet<Vector2> openList = Pool.Get<HashSet<Vector2>>();
                        HashSet<Vector2> closedList = Pool.Get<HashSet<Vector2>>();
                        foreach (var position in NextPositionMap(start, step, openList, closedList))
                        {
                            yield return CoroutineEx.waitForSeconds(WaitBrain);
                            if (IsValid())
                            {
                                if (checkPosition.Invoke(position)) goto End;
                            }
                            else goto End;
                        }
                        endFind.Invoke();
                    End:
                        Pool.FreeUnmanaged(ref openList);
                        Pool.FreeUnmanaged(ref closedList);
                    }
                }
            }
            #endregion

            #region Enumerable
            public IEnumerable<Vector3> NextPositionMap(Vector3 startPosition, float step, HashSet<Vector2> openList, HashSet<Vector2> closeList)
            {
                float y = startPosition.y;
                openList.Clear();
                closeList.Clear();
                Vector2 currentPosition = new Vector2(startPosition.x, startPosition.z);
                openList.Add(currentPosition);
                Rect rect = new Rect(new Vector2(-TerrainMeta.Size.x / 2, -TerrainMeta.Size.z / 2), new Vector2(TerrainMeta.Size.x, TerrainMeta.Size.z));
                while (openList.Count > 0)
                {
                    closeList.Add(currentPosition);
                    openList.Remove(currentPosition);
                    Vector2 pos = Vector2.zero;
                    for (int i = 0; i < 8; i++)
                    {
                        pos = i switch
                        {
                            0 => new Vector2(currentPosition.x + step, currentPosition.y),
                            1 => new Vector2(currentPosition.x + step, currentPosition.y + step),
                            2 => new Vector2(currentPosition.x, currentPosition.y + step),
                            3 => new Vector2(currentPosition.x - step, currentPosition.y + step),
                            4 => new Vector2(currentPosition.x - step, currentPosition.y),
                            5 => new Vector2(currentPosition.x - step, currentPosition.y - step),
                            6 => new Vector2(currentPosition.x, currentPosition.y - step),
                            7 => new Vector2(currentPosition.x + step, currentPosition.y - step),
                            _ => Vector2.zero,
                        };
                        if (closeList.Contains(pos)) continue;
                        if (rect.Contains(pos) && !openList.Contains(pos)) openList.Add(pos);
                    }
                    using var enumerator = openList.GetEnumerator();
                    if (enumerator.MoveNext())
                    {
                        currentPosition = enumerator.Current;
                        Vector3 movePosition = new Vector3(currentPosition.x, y, currentPosition.y);
                        HeightMap.ToGroundPoint(ref movePosition);
                        yield return movePosition;
                        continue;
                    }
                }
                yield break;

            }

            #endregion

            public enum State
            {
                Miner = 1,
                Hunter,
                Battle,
                Researcher,
                Medical,
                Dropped,
                InitBuild,
                Build,
                DroppedLoot,
                AntiRaidBuild,
                BridgeAnchorMedic,
            }
            public enum MoveMode
            {
                Idle, Moving, Finish, NotFinish
            }
        }
        #endregion

        #region Classes
        public class Monuments
        {
            public readonly Dictionary<MonumentInfo, Collider> monumentsPreventBuilding = new();
            public readonly List<MonumentInfo> allMonuments = new();

            public Monuments()
            {
                if (TerrainMeta.Path.Monuments?.Count > 0) allMonuments.AddRange(TerrainMeta.Path.Monuments);
                var list = allMonuments.Where(x => x.GetComponentsInChildren<Collider>()?.Exists(y => y.IsOnLayer(Layer.Prevent_Building)) == true);
                foreach (var monument in list)
                {
                    foreach (var collider in monument.GetComponentsInChildren<Collider>())
                    {
                        if (collider.IsOnLayer(Layer.Prevent_Building))
                        {
                            if (monumentsPreventBuilding.TryGetValue(monument, out var _collider))
                            {
                                if (_collider.GetRadius(_collider.transform.localScale) < collider.GetRadius(collider.transform.localScale))
                                {
                                    monumentsPreventBuilding[monument] = collider;
                                }
                            }
                            else monumentsPreventBuilding.Add(monument, collider);
                        }
                    }
                }
            }

            public bool HasMonument(Vector3 position)
            {
                var colliders = Physics.OverlapSphere(position, 0.5f);
                foreach (var collider in colliders)
                {
                    if (collider.GetComponentInParent<MonumentInfo>() is MonumentInfo) return true;
                }
                return false;
            }
            public bool TryGetNearestMonument(Vector3 position, out MonumentInfo monument)
            {
                monument = null;
                List<MonumentInfo> list = Pool.Get<List<MonumentInfo>>();
                if (TryGetMonuments(position, list))
                {
                    float distance = float.MaxValue;
                    foreach (var _monument in list)
                    {
                        float d = Vector3.Distance(position, _monument.transform.position);
                        if (d < distance)
                        {
                            distance = d;
                            monument = _monument;
                        }
                    }
                }
                Pool.FreeUnmanaged(ref list);
                return monument != null;
            }
            public bool TryGetMonuments(Vector3 position, List<MonumentInfo> monuments)
            {
                if (monuments == null)
                {
                    throw new ArgumentNullException("list MonumentInfo");
                }
                monuments.Clear();
                foreach (var _monument in monumentsPreventBuilding)
                {
                    if (_monument.Value.ClosestPoint(position) == position)
                    {
                        monuments.Add(_monument.Key);
                    }
                }
                return monuments.Count > 0;
            }
            public void GetMonuments(List<MonumentInfo> interestMonuments, Func<MonumentInfo, bool> canAddMonument, bool isAll)
            {
                if (interestMonuments == null) return;
                if (isAll)
                {
                    foreach (var monument in allMonuments) if (canAddMonument?.Invoke(monument) == true && !interestMonuments.Contains(monument)) interestMonuments.Add(monument);
                }
                else
                {
                    foreach (var monument2 in monumentsPreventBuilding.Keys)
                    {
                        if (canAddMonument?.Invoke(monument2) == true && !interestMonuments.Contains(monument2)) interestMonuments.Add(monument2);
                    }
                }
            }
        }
        public class HeightMap
        {
            public static bool SetHeight(ref Vector3 position, float upHeight, float checkHeight, int layerMask, QueryTriggerInteraction queryTriggerInteraction)
            {
                if (Physics.Raycast(position + Vector3.up * upHeight, Vector3.down, out var hit, checkHeight, layerMask, queryTriggerInteraction))
                {
                    position = hit.point;
                    return true;
                }
                return false;
            }
            public static void ToGroundPoint(ref Vector3 position)
            {
                position.y = TerrainMeta.HeightMap.GetHeight(position);
                SetHeight(ref position, 200, 200, LayerMask.GetMask("Terrain", "World", "Default", "Construction"), QueryTriggerInteraction.Ignore);
            }
            public static bool IsInTerrain(Vector3 position, float radius, float distance = 3f)
            {
                List<RaycastHit> obj = Pool.Get<List<RaycastHit>>();
                GamePhysics.TraceAllUnordered(new Ray(position + Vector3.up * 1f, Vector3.down), radius, obj, distance, LayerMask.GetMask("Terrain", "World", "Default", "Construction", "Prevent Building"), QueryTriggerInteraction.Ignore);
                float terrain_y = -float.MaxValue;
                float col_y = -float.MaxValue;
                foreach (RaycastHit current in obj)
                {
                    if (current.GetCollider() is Collider collider)
                    {
                        if (collider.gameObject.HasCustomTag(GameObjectTag.BlockBarricadePlacement))
                        {
                            Pool.FreeUnmanaged(ref obj);
                            return false;
                        }

                        if (collider.gameObject.HasCustomTag(GameObjectTag.Road))
                        {
                            Pool.FreeUnmanaged(ref obj);
                            return false;
                        }

                        if (collider.CompareTag("Main Terrain"))
                        {
                            if (current.point.y > terrain_y) terrain_y = current.point.y;
                            continue;
                        }
                        if (current.point.y > col_y) col_y = current.point.y;

                    }
                }
                Pool.FreeUnmanaged(ref obj);
                return (position.y >= terrain_y - 0.1f) && (terrain_y > col_y + 3);
            }
        }
        public class CustomContractResolver : DefaultContractResolver
        {
            protected override JsonProperty CreateProperty(System.Reflection.MemberInfo member, MemberSerialization memberSerialization)
            {
                JsonProperty property = base.CreateProperty(member, memberSerialization);
                property.PropertyName = member.Name;

                return property;
            }
        }
        public class Debug
        {
            private static string NamePlugin => nameof(RoamingNPCs);
            public static void Log(string message, params object[] args) => LogMessage(NamePlugin, TypeDebug.Log, message, args);
            public static void Log<T>(string message, params object[] args) => LogMessage(typeof(T).FullName, TypeDebug.Log, message, args);
            public static void LogError(string message, params object[] args) => LogMessage(NamePlugin, TypeDebug.LogError, message, args);
            public static void LogError<T>(string message, params object[] args) => LogMessage(typeof(T).FullName, TypeDebug.LogError, message, args);
            public static void LogWarning(string message, params object[] args) => LogMessage(NamePlugin, TypeDebug.LogWarning, message, args);
            public static void LogWarning<T>(string message, params object[] args) => LogMessage(typeof(T).FullName, TypeDebug.LogWarning, message, args);
            public static void LogTest(string message, params object[] args) => LogMessage(NamePlugin, TypeDebug.Test, message, args);
            public static void LogTest<T>(string message, params object[] args) => LogMessage(typeof(T).FullName, TypeDebug.Test, message, args);
            
            private static void LogMessage(string namePlugin, TypeDebug typeDebug, string message, params object[] args)
            {
                switch (typeDebug)
                {
                    case TypeDebug.Log: UnityEngine.Debug.Log($"[{namePlugin} Log]: " + string.Format(message, args)); break;
                    case TypeDebug.LogError: UnityEngine.Debug.LogError($"[{namePlugin} Error]: " + string.Format(message, args)); break;
                    case TypeDebug.LogWarning: UnityEngine.Debug.LogWarning($"[{namePlugin} Warning]: " + string.Format(message, args)); break;
                    case TypeDebug.Test: UnityEngine.Debug.LogWarning($"[{namePlugin} Test log]: " + string.Format(message, args)); break;
                }
            }

            #region Visualization Methods (3D Debug Drawing)
            
            /// <summary>
            /// Очистить все отрисованные примитивы для игрока
            /// </summary>
            public static void DrawClear(BasePlayer player) => player?.SendConsoleCommand("ddraw.clear");
            
            /// <summary>
            /// Отрисовать текст в 3D пространстве
            /// </summary>
            /// <param name="duration">Время отображения в секундах</param>
            /// <param name="color">Цвет текста</param>
            /// <param name="position">Позиция в мире</param>
            /// <param name="text">Текст для отображения</param>
            /// <param name="distanceFade">Расстояние, после которого текст исчезает</param>
            public static void DrawText(BasePlayer player, float duration, Color color, Vector3 position, string text, float distanceFade = 0) =>
                player?.SendConsoleCommand("ddraw.text", duration, color, position, text, distanceFade);
            
            /// <summary>
            /// Отрисовать стрелку
            /// </summary>
            public static void DrawArrow(BasePlayer player, float duration, Color color, Vector3 start, Vector3 end, float radius = 0.5f, float distanceFade = 0) =>
                player?.SendConsoleCommand("ddraw.arrow", duration, color, start, end, radius, distanceFade);
            
            /// <summary>
            /// Отрисовать линию
            /// </summary>
            public static void DrawLine(BasePlayer player, float duration, Color color, Vector3 start, Vector3 end, float distanceFade = 0, bool zTest = false) =>
                player?.SendConsoleCommand("ddraw.line", duration, color, start, end, distanceFade, zTest);
            
            /// <summary>
            /// Отрисовать сферу
            /// </summary>
            public static void DrawSphere(BasePlayer player, float duration, Color color, Vector3 position, float radius = 0.5f, float distanceFade = 0) =>
                player?.SendConsoleCommand("ddraw.sphere", duration, color, position, radius, distanceFade);
            
            /// <summary>
            /// Отрисовать капсулу
            /// </summary>
            public static void DrawCapsule(BasePlayer player, float duration, Color color, Vector3 position, Vector3 rotation, float radius = 0.5f, float height = 2f, float distanceFade = 0) =>
                player?.SendConsoleCommand("ddraw.capsule", duration, color, position, rotation, radius, height, distanceFade);
            
            /// <summary>
            /// Отрисовать куб
            /// </summary>
            public static void DrawBox(BasePlayer player, float duration, Color color, Vector3 position, Vector3 size, Vector3 rotation, float distanceFade = 0, bool zTest = false) =>
                player?.SendConsoleCommand("ddraw.box", duration, color, position, size, rotation, distanceFade, zTest);
            
            #endregion

            private enum TypeDebug
            {
                Log, LogError, LogWarning, Test
            }
        }
        public struct TimerSince
        {
            public DateTime dateTime;
            
            public readonly float TotalSeconds => (float)TimeSpan.TotalSeconds;
            public readonly float TotalMilliseconds => (float)TimeSpan.TotalMilliseconds;
            public readonly TimeSpan TimeSpan => DateTime.Now - dateTime;
            
            public static implicit operator TimerSince(float second)
            {
                return new TimerSince() { dateTime = DateTime.Now - TimeSpan.FromSeconds(second) };
            }
        }
        public class BotIdGenerator
        {
            private static HashSet<ulong> _usedIds;

            public static ulong GenerateBotId(string steamIdOwner, int maxDigits)
            {
                ulong maxValue = (ulong)Math.Pow(10, maxDigits);
                ulong botId = CheckAndConvert(steamIdOwner, maxDigits);

                ulong attempts = 1;
                while (_usedIds.Contains(botId) && attempts < 100)
                {
                    botId = (botId + 1) % maxValue;
                    if (botId == 0) botId = 1;

                    string substring = botId.ToString();

                    while (substring.Length < maxDigits) substring += "0";
                    botId = ulong.Parse(substring);
                    attempts++;
                }

                return botId;
            }

            public static ulong CheckAndConvert(string stringId, int maxDigits)
            {
                stringId = stringId.TrimStart('-');
                int length = Math.Min(stringId.Length, maxDigits);
                string substring = stringId.Substring(0, length);

                substring = substring.TrimStart('0');
                if (substring.Length == 0) substring = "1";
                while (substring.Length < maxDigits)
                {
                    substring += "0";
                }
                Debug.Log<BotIdGenerator>($"Generate id: {substring}");

                return ulong.Parse(substring);
            }
            public static ulong GenerateBotIdOld(string steamIdOwner, int maxDigits)
            {
                using (System.Security.Cryptography.SHA256 sha256 = System.Security.Cryptography.SHA256.Create())
                {
                    byte[] hashBytes = sha256.ComputeHash(System.Text.Encoding.UTF8.GetBytes(steamIdOwner));

                    byte[] ulongBytes = new byte[8];
                    Array.Copy(hashBytes, ulongBytes, 8);
                    ulong maxValue = (ulong)Math.Pow(10, maxDigits);
                    ulong botId = BitConverter.ToUInt64(ulongBytes, 0) % maxValue;

                    int attempts = 0;
                    while (_usedIds.Contains(botId) && attempts < 100)
                    {
                        botId = (botId + 1) % maxValue;
                        attempts++;
                    }

                    if (!_usedIds.Contains(botId)) _usedIds.Add(botId);

                    return botId;
                }
            }
            public static void InitPlugin()
            {
                _usedIds = new HashSet<ulong>();
            }
            public static void UnloadPlugin()
            {
                _usedIds = null;
            }

            public static void AddID(ulong farmerId)
            {
                if (!_usedIds.Contains(farmerId))
                {
                    _usedIds.Add(farmerId);
                }
            }

            public static bool ContainsID(ulong id) => _usedIds.Contains(id);

            public static void RemoveID(ulong id) => _usedIds.Remove(id);

        }
        public class CollectibleHelper
        {
            public static CollectibleHelper Instance;
            private readonly HashSet<BaseEntity> _collectibleEntities;

            private CollectibleHelper()
            {
                try
                {
                    _collectibleEntities = new(BaseNetworkable.serverEntities.OfType<CollectibleEntity>());
                }
                finally
                {
                    _collectibleEntities ??= new();
                }
            }
            /// <summary>
            /// необходимо вызывать в хуке void OnServerInitialized()
            /// </summary>
            public static void InitPlugin()
            {
                Instance = new();
            }
            /// <summary>
            /// необходимо вызывать в хуке void Unload() 
            /// </summary>
            public static void UnloadPlugin()
            {
                Instance = null;
            }

            #region Methods
            /// <summary>
            /// Возвращает перечислитель содержащий все CollectibleEntity в радиусе
            /// </summary>
            /// <param name="position">Центральная позиция поиска</param>
            /// <param name="radius">Радиус поиска</param>
            /// <returns>Перечислитель содержащий все найденые CollectibleEntity в радиусе</returns>
            public IEnumerable<CollectibleEntity> GetCollectibleEntity(Vector3 position, float radius)
            {
                if(_collectibleEntities != null && radius > 0)
                {
                    float num = radius * radius;
                    foreach(var entity in _collectibleEntities)
                    {
                        if(entity.IsValid() && entity is CollectibleEntity collectible && (position - collectible.transform.position).sqrMagnitude < num) yield return collectible;
                    }
                }
            }
            /// <summary>
            /// Возвращает первый попавшийся CollectibleEntity в радиусе
            /// </summary>
            /// <param name="position">Центральная позиция поиска</param>
            /// <param name="radius">Радиус поиска</param>
            /// <returns>Возвращает первый попавшийся CollectibleEntity в радиусе</returns>
            public CollectibleEntity GetFirstCollectibleEntity(Vector3 position, float radius)
            {
                if(_collectibleEntities != null && radius > 0)
                {
                    float num = radius * radius;
                    foreach(var entity in _collectibleEntities)
                    {
                        if(entity.IsValid() && entity is CollectibleEntity collectible && (position - collectible.transform.position).sqrMagnitude < num) return collectible;
                    }
                }
                return null;
            }
            /// <summary>
            /// Необходимо вызывать в хуке object OnEntitySpawned(CollectibleEntity entity)
            /// </summary>
            /// <param name="entity"></param>
            public static void OnEntitySpawned(CollectibleEntity entity)
            {
                Instance?._collectibleEntities?.Add(entity);
            }
            /// <summary>
            /// Необходимо вызывать в хуке object OnEntityKill(CollectibleEntity entity)
            /// </summary>
            /// <param name="entity"></param>
            public static void OnEntityKill(CollectibleEntity entity)
            {
                Instance?._collectibleEntities?.Remove(entity);
            }
            #endregion
        }
        #endregion

        #region MaxxInvadersBridgeApi
        private static readonly JsonSerializerSettings BridgeBoolJsonSettings = new JsonSerializerSettings
        {
            ContractResolver = new CamelCasePropertyNamesContractResolver(),
        };

        /// <summary>Resolve dictionary key (case-sensitive storage; GUI may pass different casing).</summary>
        private bool TryResolveBotConfigKey(string templateKey, out string canonicalKey, out BotSetup setup)
        {
            canonicalKey = null;
            setup = null;
            if (string.IsNullOrWhiteSpace(templateKey) || config?.bots == null)
                return false;
            var key = templateKey.Trim();
            if (config.bots.TryGetValue(key, out setup) && setup != null)
            {
                canonicalKey = key;
                return true;
            }

            foreach (var kv in config.bots)
            {
                if (string.Equals(kv.Key, key, StringComparison.OrdinalIgnoreCase) && kv.Value != null)
                {
                    canonicalKey = kv.Key;
                    setup = kv.Value;
                    return true;
                }
            }

            return false;
        }

        /// <summary>MaxxInvaders bridge: optional pipe-separated item shortnames replace Wear only (e.g. bunny onesie|ears).</summary>
        private static void ApplyWearOverridePipe(BotSetup setup, string pipeSeparatedShortnames)
        {
            if (setup == null || string.IsNullOrWhiteSpace(pipeSeparatedShortnames)) return;
            string[] seg = pipeSeparatedShortnames.Split(new[] { '|' }, StringSplitOptions.RemoveEmptyEntries);
            if (seg.Length == 0) return;
            if (setup.Wear == null) setup.Wear = new WearSetup();
            setup.Wear.items = new List<ItemSetup>();
            foreach (string s in seg)
            {
                string t = s.Trim();
                if (t.Length == 0) continue;
                setup.Wear.items.Add(new ItemSetup(t, 0UL));
            }
        }

        [HookMethod("SpawnFromTemplateForBridge")]
        public object SpawnFromTemplateForBridge(string templateKey, string displayName, string uniqueSuffix,
            ulong anchorSteamIdToProtect = 0, string wearOverridePipeSeparated = null)
        {
            if (string.IsNullOrWhiteSpace(templateKey) || config?.bots == null)
                return null;
            if (!TryResolveBotConfigKey(templateKey, out string key, out BotSetup baseSetup) || baseSetup == null ||
                !baseSetup.Enable)
                return null;

            string suffix = string.IsNullOrWhiteSpace(uniqueSuffix)
                ? $"{DateTime.UtcNow.Ticks}_{UnityEngine.Random.Range(1000, 9999)}"
                : uniqueSuffix.Trim();
            string safe = SanitizeBridgeDisplayName(displayName, suffix);
            if (string.IsNullOrEmpty(safe))
                return null;

            BotSetup setup;
            try
            {
                setup = JsonConvert.DeserializeObject<BotSetup>(JsonConvert.SerializeObject(baseSetup));
            }
            catch
            {
                return null;
            }

            if (setup == null)
                return null;

            ApplyWearOverridePipe(setup, wearOverridePipeSeparated);

            setup.Init();
            setup.Amount = 1;
            setup.Name = safe;

            // MaxxInvaders bridge: when anchor Steam is set, always bind RoamingNPCs patrol/protection to that player.
            // Older logic only set BridgeProtectAnchorUserId if BridgePatrol.Enable or _protectBridgeAnchorPlayer —
            // templates missing those flags left BridgeProtectAnchorUserId=0 so the bot used full map roam AI ("runs away").
            if (anchorSteamIdToProtect != 0UL)
            {
                setup.BridgePatrol ??= new SetupBridgePatrol();
                if (!setup.BridgePatrol.Enable)
                {
                    setup.BridgePatrol.Enable = true;
                    if (setup.BridgePatrol.RadiusMeters < 8f) setup.BridgePatrol.RadiusMeters = 12f;
                }

                setup.BattleState ??= new SetupBattle();
                if (!setup.BattleState._protectBridgeAnchorPlayer) setup.BattleState._protectBridgeAnchorPlayer = true;
                // Fight world NPCs (scientists, etc.); never other Roaming CustomPet or PersonalNPC companions.
                setup.BattleState._ignoreNPCs = false;
                setup.BattleState._ignoreRNPC = true;
                setup.BattleState._ignorePersonalNpcBots = true;
            }

            string uniqueKey = $"{key}_{suffix}";

            var data = new DataBot(uniqueKey, setup);
            data.DisplayName = safe;
            data.SpawnedFromMaxxInvadersBridge = true;
            if (anchorSteamIdToProtect != 0UL) data.BridgeProtectAnchorUserId = anchorSteamIdToProtect;

            try
            {
                return Respawn(data);
            }
            catch (Exception ex)
            {
                PrintError($"[RoamingNPCs] MaxxInvaders bridge Respawn failed: {ex}");
                return null;
            }
        }

        /// <summary>
        /// MaxxInvaders / plugin despawn: use <see cref="CustomPet.AdminKill"/> so <see cref="DataBots.RemoveBot"/> runs before death.
        /// Plain <see cref="BaseCombatEntity.Kill"/> triggers <see cref="CustomPet.OnDied"/> which always schedules respawn (min 3s via <see cref="BotSetup.GetTimerRespawn"/>), resurrecting viewer bots after lifetime/GUI despawn.
        /// </summary>
        [HookMethod("DespawnBridgeNpc")]
        public object DespawnBridgeNpc(BasePlayer npc)
        {
            if (npc == null || npc.IsDestroyed || listNpcPlayers == null) return false;
            if (!listNpcPlayers.TryGetValue(npc.net.ID.Value, out var pet) || pet == null || pet.IsDestroyed)
                return false;
            try
            {
                pet.AdminKill();
                return true;
            }
            catch (Exception ex)
            {
                PrintError($"[RoamingNPCs] DespawnBridgeNpc: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// MaxxInvaders: align bridge anchor and enable companion behavior (protect anchor player, gather/loot, deposit to anchor-owned storage) on an already-spawned bot.
        /// Runtime-only; does not write JSON. Vanilla ScientistNPC spawns are not tracked here — returns false.
        /// </summary>
        [HookMethod("ApplySquadCompanionMode")]
        public object ApplySquadCompanionMode(ulong entityNetId, ulong anchorSteamId, bool enableGatherProtectDeposit)
        {
            try
            {
                if (listNpcPlayers == null || !listNpcPlayers.TryGetValue(entityNetId, out var pet) || pet == null ||
                    pet.IsDestroyed)
                    return false;
                if (pet.Data?.Setup == null) return false;

                pet.Data.SpawnedFromMaxxInvadersBridge = true;
                pet.Data.BridgeProtectAnchorUserId = anchorSteamId;

                // Friendly personality keeps bots passive (run away / no combat). MaxxInvaders bridge bodyguards need Defensive.
                if (anchorSteamId != 0UL)
                {
                    pet.Data.Setup.EnableRandomPersonality = false;
                    pet.Data.Setup.Personality = PersonalityBot.Defensive;
                }

                if (!enableGatherProtectDeposit)
                    return true;

                pet.Data.BridgeLastAppliedTask = "gather";

                if (pet.Data.Setup.BattleState != null)
                {
                    pet.Data.Setup.BattleState._protectBridgeAnchorPlayer = true;
                    pet.Data.Setup.BattleState._ignoreNPCs = false;
                    pet.Data.Setup.BattleState._ignoreRNPC = true;
                    pet.Data.Setup.BattleState._ignorePersonalNpcBots = true;
                }

                pet.Data.Setup.BridgePatrol ??= new SetupBridgePatrol();
                pet.Data.Setup.BridgePatrol.Enable = true;
                if (pet.Data.Setup.BridgePatrol.RadiusMeters < 8f) pet.Data.Setup.BridgePatrol.RadiusMeters = 12f;

                if (pet.Data.Setup.FullState != null)
                {
                    pet.Data.Setup.FullState.BridgeUseAnchorOwnedStorage = true;
                    if (pet.Data.Setup.FullState.BridgeAnchorStorageSearchRadius <= 0f)
                        pet.Data.Setup.FullState.BridgeAnchorStorageSearchRadius = 18f;
                }

                var miner = pet.Data.Setup.MinerState;
                if (miner != null)
                {
                    miner.CanMiningWood = true;
                    miner.CanMiningOre = true;
                    miner.CanFuelUseFromChainsaw = true;
                    miner.CanMiningBarrel = true;
                    miner.CanMiningRoadSign = true;
                    miner.CanPickupCollectibleItems = true;
                    miner.CanPickupDroppedItems = true;
                    miner.CanLootedContainer = true;
                    miner.CanLootedCorpse = true;
                }

                return true;
            }
            catch (Exception ex)
            {
                PrintError($"[RoamingNPCs] ApplySquadCompanionMode: {ex}");
                return false;
            }
        }

        /// <summary>
        /// MaxxInvaders: move items from the bot main inventory into anchor-owned <see cref="StorageContainer"/> (assigned box or nearest).
        /// If the bot is farther than ~2 m from the container, it paths to the box first; transfer runs when close (see <see cref="BridgeDepositApproachTick"/>).
        /// Returns stacks moved, -1 error, -2 no storage, -3 pathing to storage (transfer shortly).
        /// </summary>
        [HookMethod("DepositItemsToAnchorOwnedStorage")]
        public object DepositItemsToAnchorOwnedStorage(ulong entityNetId, ulong anchorSteamId)
        {
            try
            {
                if (listNpcPlayers == null || !listNpcPlayers.TryGetValue(entityNetId, out var pet) || pet == null ||
                    pet.IsDestroyed)
                    return -1;
                var setup = pet.Data?.Setup;
                if (setup?.FullState == null) return -1;

                if (anchorSteamId != 0UL)
                {
                    pet.Data.SpawnedFromMaxxInvadersBridge = true;
                    pet.Data.BridgeProtectAnchorUserId = anchorSteamId;
                    setup.FullState.BridgeUseAnchorOwnedStorage = true;
                    if (setup.FullState.BridgeAnchorStorageSearchRadius <= 0f)
                        setup.FullState.BridgeAnchorStorageSearchRadius = 18f;
                }

                if (!TryFindAnchorOwnedStorageForBridge(pet, out var container) || container == null)
                    return -2;

                if (pet.inventory?.containerMain == null) return -1;

                return TryBeginBridgeDepositApproach(pet, container);
            }
            catch (Exception ex)
            {
                PrintError($"[RoamingNPCs] DepositItemsToAnchorOwnedStorage: {ex}");
                return -1;
            }
        }

        /// <summary>
        /// MaxxInvaders: runtime task profile for bridge bots — wood, stone, cloth, hunt, follow, protect, guard, gather, mixed, idle.
        /// </summary>
        [HookMethod("ApplyBridgeTask")]
        public object ApplyBridgeTask(ulong entityNetId, ulong anchorSteamId, string taskName)
        {
            try
            {
                if (listNpcPlayers == null || !listNpcPlayers.TryGetValue(entityNetId, out var pet) || pet == null ||
                    pet.IsDestroyed)
                    return false;
                if (pet.Data?.Setup == null) return false;

                pet.Data.SpawnedFromMaxxInvadersBridge = true;
                if (anchorSteamId != 0UL)
                    pet.Data.BridgeProtectAnchorUserId = anchorSteamId;

                var setup = pet.Data.Setup;
                setup.MinerState ??= new SetupMining();
                setup.HunterState ??= new SetupHunting();
                setup.BattleState ??= new SetupBattle();
                setup.BridgePatrol ??= new SetupBridgePatrol();
                setup.FullState ??= new SetupFullInventory();

                void MinerOff()
                {
                    var m = setup.MinerState;
                    m.CanMiningWood = false;
                    m.CanFuelUseFromChainsaw = false;
                    m.CanMiningOre = false;
                    m.CanMiningBarrel = false;
                    m.CanMiningRoadSign = false;
                    m.CanPickupCollectibleItems = false;
                    m.CanPickupDroppedItems = false;
                    m.CanLootedContainer = false;
                    m.CanLootedCorpse = false;
                    m.CanButcherCorpse = false;
                }

                void MinerGatherAll()
                {
                    var m = setup.MinerState;
                    m.CanMiningWood = true;
                    m.CanFuelUseFromChainsaw = true;
                    m.CanMiningOre = true;
                    m.CanMiningBarrel = true;
                    m.CanMiningRoadSign = true;
                    m.CanPickupCollectibleItems = true;
                    m.CanPickupDroppedItems = true;
                    m.CanLootedContainer = true;
                    m.CanLootedCorpse = true;
                    m.CanButcherCorpse = true;
                }

                /// <summary>Wider Vis/collectible scan so bridge bots notice ground loot and resources.</summary>
                void BridgeBoostFindRadius()
                {
                    setup.Controller ??= new ControllerSetup();
                    if (setup.Controller.RadiusFindEntity < BridgeTaskMinFindRadius)
                        setup.Controller.RadiusFindEntity = BridgeTaskMinFindRadius;
                    setup.Controller.BridgeBoostScanTimers();
                }

                /// <summary>Protect: stay near streamer — do not use 72m scan (that causes roam-then-MaxxInvaders snap).</summary>
                void BridgeProtectTightAnchorLeash()
                {
                    setup.Controller ??= new ControllerSetup();
                    const float protectScanMeters = 24f;
                    setup.Controller.RadiusFindEntity = protectScanMeters;
                    setup.Controller.BridgeBoostScanTimers();
                    setup.Controller.SetEscortMovementSpeedMax();
                    setup.BridgePatrol ??= new SetupBridgePatrol();
                    // Default JSON uses 5–11s between patrol points — far too slow to follow a sprinting / mounted streamer.
                    setup.BridgePatrol.MinMoveIntervalSeconds = 0.38f;
                    setup.BridgePatrol.MaxMoveIntervalSeconds = 0.95f;
                }

                /// <summary>When a home TC is set, re-enable far patrol + wide scan after task switches that strip companion patrol.</summary>
                void EnsureHomeBridgePatrolAfterTask()
                {
                    if (pet.Data.BridgeHomeCupboardNetId == 0UL) return;
                    setup.BridgePatrol ??= new SetupBridgePatrol();
                    setup.BridgePatrol.Enable = true;
                    if (setup.BridgePatrol.RadiusMeters < 40f) setup.BridgePatrol.RadiusMeters = 40f;
                    setup.Controller ??= new ControllerSetup();
                    if (setup.Controller.RadiusFindEntity < BridgeHomeRoamMinFindRadius)
                        setup.Controller.RadiusFindEntity = BridgeHomeRoamMinFindRadius;
                    setup.Controller.BridgeBoostScanTimers();
                }

                /// <summary>Clear gather/protect patrol so switching wood/stone/etc. does not leave conflicting FSM goals.</summary>
                void StripCompanionPatrolAndProtect()
                {
                    setup.BattleState ??= new SetupBattle();
                    setup.BridgePatrol ??= new SetupBridgePatrol();
                    setup.BattleState._protectBridgeAnchorPlayer = false;
                    setup.BridgePatrol.Enable = false;
                }

                /// <summary>Allow fighting back vs NPCs/players (except hunt-only keeps real players ignored).</summary>
                void BridgeBattleDefenseBaseline(bool ignoreRealPlayersForAnimalHunt)
                {
                    setup.BattleState ??= new SetupBattle();
                    setup.BattleState._ignoreNPCs = false;
                    setup.BattleState._ignoreRNPC = true;
                    setup.BattleState._ignorePersonalNpcBots = true;
                    setup.BattleState._ignoreRealPlayers = ignoreRealPlayersForAnimalHunt;
                    setup.Controller ??= new ControllerSetup();
                    setup.Controller.SetSharperShootingBridge();
                    // Snap faster shots on bridge tasks unless explicitly tuned slower.
                    if (setup.BattleState._aimWindupSeconds <= 0.001f || setup.BattleState._aimWindupSeconds > 0.42f)
                        setup.BattleState._aimWindupSeconds = 0.26f;
                }

                var t = (taskName ?? "").Trim().ToLowerInvariant();
                switch (t)
                {
                    case "wood":
                        StripCompanionPatrolAndProtect();
                        BridgeBoostFindRadius();
                        BridgeBattleDefenseBaseline(false);
                        MinerOff();
                        setup.MinerState.CanMiningWood = true;
                        setup.MinerState.CanFuelUseFromChainsaw = true;
                        setup.MinerState.CanPickupDroppedItems = true;
                        setup.HunterState.CanHunt = false;
                        setup.EnableRandomPersonality = false;
                        setup.Personality = PersonalityBot.Defensive;
                        break;
                    case "stone":
                        StripCompanionPatrolAndProtect();
                        BridgeBoostFindRadius();
                        BridgeBattleDefenseBaseline(false);
                        MinerOff();
                        setup.MinerState.CanMiningOre = true;
                        setup.MinerState.CanPickupDroppedItems = true;
                        setup.HunterState.CanHunt = false;
                        setup.EnableRandomPersonality = false;
                        setup.Personality = PersonalityBot.Defensive;
                        break;
                    case "cloth":
                        StripCompanionPatrolAndProtect();
                        BridgeBoostFindRadius();
                        BridgeBattleDefenseBaseline(false);
                        MinerOff();
                        setup.MinerState.CanPickupCollectibleItems = true;
                        setup.MinerState.CanPickupDroppedItems = true;
                        setup.HunterState.CanHunt = false;
                        setup.EnableRandomPersonality = false;
                        setup.Personality = PersonalityBot.Defensive;
                        break;
                    case "hunt":
                        StripCompanionPatrolAndProtect();
                        BridgeBoostFindRadius();
                        BridgeBattleDefenseBaseline(true);
                        MinerOff();
                        setup.HunterState.CanHunt = true;
                        setup.MinerState.CanPickupDroppedItems = true;
                        setup.EnableRandomPersonality = false;
                        setup.Personality = PersonalityBot.Defensive;
                        break;
                    case "follow":
                    case "protect":
                        BridgeProtectTightAnchorLeash();
                        BridgeBattleDefenseBaseline(false);
                        MinerOff();
                        setup.MinerState.CanPickupDroppedItems = true;
                        setup.HunterState.CanHunt = false;
                        setup.EnableRandomPersonality = false;
                        setup.Personality = PersonalityBot.Defensive;
                        setup.BattleState._protectBridgeAnchorPlayer = true;
                        setup.BridgePatrol.Enable = true;
                        // Streamer escort: stay within ~10 m; patrol pulls inward when beyond the ring.
                        setup.BridgePatrol.RadiusMeters = 10f;
                        break;
                    case "guard":
                        BridgeBattleDefenseBaseline(false);
                        MinerOff();
                        setup.MinerState.CanPickupDroppedItems = true;
                        setup.HunterState.CanHunt = false;
                        setup.EnableRandomPersonality = false;
                        setup.Personality = PersonalityBot.Defensive;
                        setup.BattleState._protectBridgeAnchorPlayer = true;
                        setup.BridgePatrol.Enable = true;
                        setup.Controller ??= new ControllerSetup();
                        setup.Controller.RadiusFindEntity = 40f;
                        setup.Controller.BridgeBoostScanTimers();
                        setup.BridgePatrol.RadiusMeters = 28f;
                        break;
                    case "gather":
                    case "all":
                        BridgeBoostFindRadius();
                        BridgeBattleDefenseBaseline(false);
                        MinerGatherAll();
                        setup.HunterState.CanHunt = false;
                        setup.EnableRandomPersonality = false;
                        setup.Personality = PersonalityBot.Defensive;
                        setup.BattleState._protectBridgeAnchorPlayer = true;
                        setup.BridgePatrol.Enable = true;
                        if (setup.BridgePatrol.RadiusMeters < 8f) setup.BridgePatrol.RadiusMeters = 28f;
                        setup.FullState.BridgeUseAnchorOwnedStorage = true;
                        if (setup.FullState.BridgeAnchorStorageSearchRadius <= 0f)
                            setup.FullState.BridgeAnchorStorageSearchRadius = 18f;
                        break;
                    case "idle":
                        StripCompanionPatrolAndProtect();
                        BridgeBoostFindRadius();
                        BridgeBattleDefenseBaseline(false);
                        MinerOff();
                        setup.MinerState.CanPickupDroppedItems = true;
                        setup.HunterState.CanHunt = false;
                        setup.EnableRandomPersonality = false;
                        setup.Personality = PersonalityBot.Defensive;
                        break;
                    // Wood + stone + cloth + hunt + loot + defense — no anchor patrol / forced deposit (unlike gather).
                    case "mixed":
                        StripCompanionPatrolAndProtect();
                        BridgeBoostFindRadius();
                        BridgeBattleDefenseBaseline(false);
                        MinerGatherAll();
                        setup.HunterState.CanHunt = true;
                        setup.EnableRandomPersonality = false;
                        setup.Personality = PersonalityBot.Defensive;
                        setup.Controller ??= new ControllerSetup();
                        if (setup.Controller.RadiusFindEntity < BridgeMixedTaskMinFindRadius)
                            setup.Controller.RadiusFindEntity = BridgeMixedTaskMinFindRadius;
                        setup.Controller.BridgeBoostScanTimers();
                        break;
                    default:
                        return false;
                }

                // Do not re-apply far home-roam (40m patrol + 110m scan) after follow/protect/guard — that undoes anchor leash.
                // Tasks that call StripCompanionPatrolAndProtect() must NOT get home-TC patrol re-enabled here — it fights
                // MinerState pathing (bot stands near base instead of scanning for wood/stone/etc.).
                var skipHomeTcPatrolRestore =
                    string.Equals(t, "wood", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(t, "stone", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(t, "cloth", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(t, "hunt", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(t, "mixed", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(t, "idle", StringComparison.OrdinalIgnoreCase);

                if (!skipHomeTcPatrolRestore &&
                    !string.Equals(t, "follow", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(t, "protect", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(t, "guard", StringComparison.OrdinalIgnoreCase))
                    EnsureHomeBridgePatrolAfterTask();
                pet.Data.BridgeLastAppliedTask = t == "all" ? "gather" : t;
                pet.CustomBrain?.ChangeState(null);
                return true;
            }
            catch (Exception ex)
            {
                PrintError($"[RoamingNPCs] ApplyBridgeTask: {ex}");
                return false;
            }
        }

        private static string InferBridgeTaskLabel(BotSetup setup)
        {
            if (setup?.MinerState == null) return "";
            var m = setup.MinerState;
            var h = setup.HunterState;
            var b = setup.BattleState;
            var bp = setup.BridgePatrol;
            var fs = setup.FullState;

            /// <summary>Core gather off; dropped items allowed (bridge tasks use ground loot alongside main job).</summary>
            bool MinerCoreOffDroppedOk()
            {
                return !m.CanMiningWood && !m.CanFuelUseFromChainsaw && !m.CanMiningOre && !m.CanMiningBarrel &&
                       !m.CanMiningRoadSign && !m.CanPickupCollectibleItems &&
                       !m.CanLootedContainer && !m.CanLootedCorpse && !m.CanButcherCorpse;
            }

            bool MinerGatherAll()
            {
                return m.CanMiningWood && m.CanFuelUseFromChainsaw && m.CanMiningOre && m.CanMiningBarrel &&
                       m.CanMiningRoadSign && m.CanPickupCollectibleItems && m.CanPickupDroppedItems &&
                       m.CanLootedContainer && m.CanLootedCorpse && m.CanButcherCorpse;
            }

            var hunt = h != null && h.CanHunt;
            var prot = b != null && b._protectBridgeAnchorPlayer;
            var patrol = bp != null && bp.Enable;
            var stor = fs != null && fs.BridgeUseAnchorOwnedStorage;

            if (hunt && MinerCoreOffDroppedOk()) return "hunt";
            if (MinerGatherAll() && prot && patrol && stor) return "gather";
            if (MinerGatherAll() && hunt && !prot && !patrol) return "mixed";
            if (MinerCoreOffDroppedOk() && !hunt && prot && patrol)
            {
                var r = bp?.RadiusMeters ?? 0f;
                // Tight escort (ApplyBridgeTask "protect") vs wider ring ("guard") — radius is the differentiator when hint is empty.
                if (r >= 18f) return "guard";
                return "protect";
            }
            if (m.CanMiningWood && m.CanFuelUseFromChainsaw && !m.CanMiningOre && !m.CanMiningBarrel &&
                !m.CanMiningRoadSign && !m.CanPickupCollectibleItems &&
                !m.CanLootedContainer && !m.CanLootedCorpse && !m.CanButcherCorpse)
                return "wood";
            if (!m.CanMiningWood && !m.CanFuelUseFromChainsaw && m.CanMiningOre && !m.CanMiningBarrel &&
                !m.CanMiningRoadSign && !m.CanPickupCollectibleItems &&
                !m.CanLootedContainer && !m.CanLootedCorpse && !m.CanButcherCorpse)
                return "stone";
            if (!m.CanMiningWood && !m.CanFuelUseFromChainsaw && !m.CanMiningOre && !m.CanMiningBarrel &&
                !m.CanMiningRoadSign && m.CanPickupCollectibleItems &&
                !m.CanLootedContainer && !m.CanLootedCorpse && !m.CanButcherCorpse)
                return "cloth";
            if (MinerCoreOffDroppedOk() && !hunt && !prot && !patrol) return "idle";
            return "mixed";
        }

        /// <summary>MaxxInvaders: human-readable bridge task (last applied or inferred from miner/hunter flags).</summary>
        [HookMethod("GetBridgeTaskLabel")]
        public object GetBridgeTaskLabel(ulong petEntityNetId)
        {
            try
            {
                if (listNpcPlayers == null || !listNpcPlayers.TryGetValue(petEntityNetId, out var pet) || pet == null ||
                    pet.IsDestroyed)
                    return "";
                if (pet.Data?.BridgeDepositApproachActive == true)
                    return "deposit";
                var hint = pet.Data?.BridgeLastAppliedTask?.Trim();
                if (!string.IsNullOrEmpty(hint)) return hint;
                return InferBridgeTaskLabel(pet.Data?.Setup);
            }
            catch (Exception ex)
            {
                PrintError($"[RoamingNPCs] GetBridgeTaskLabel: {ex}");
                return "";
            }
        }

        /// <summary>BaseBotch: bridge streamer Steam64 for storage OwnerID matching (0 if not tracked / not bridge).</summary>
        [HookMethod("GetBridgeProtectAnchorUserId")]
        public object GetBridgeProtectAnchorUserId(ulong petEntityNetId)
        {
            try
            {
                if (listNpcPlayers == null || !listNpcPlayers.TryGetValue(petEntityNetId, out var pet) || pet == null ||
                    pet.IsDestroyed)
                    return 0UL;
                return pet.Data?.BridgeProtectAnchorUserId ?? 0UL;
            }
            catch (Exception ex)
            {
                PrintError($"[RoamingNPCs] GetBridgeProtectAnchorUserId: {ex}");
                return 0UL;
            }
        }

        /// <summary>MaxxInvaders: while this player has bridge NPC inventory open, returns that bot's entity net id; else 0.</summary>
        [HookMethod("GetBridgeLootPetNetIdForPlayer")]
        public object GetBridgeLootPetNetIdForPlayer(ulong looterUserId)
        {
            try
            {
                if (_bridgeLootPetNetByLooter != null &&
                    _bridgeLootPetNetByLooter.TryGetValue(looterUserId, out var id))
                    return id;
                return 0UL;
            }
            catch (Exception ex)
            {
                PrintError($"[RoamingNPCs] GetBridgeLootPetNetIdForPlayer: {ex}");
                return 0UL;
            }
        }

        /// <summary>MaxxInvaders: clear looter→pet map when loot UI closes (see poll in MaxxInvaders).</summary>
        [HookMethod("ClearBridgeLootMappingForPlayer")]
        public object ClearBridgeLootMappingForPlayer(ulong looterUserId)
        {
            try
            {
                _bridgeLootPetNetByLooter?.Remove(looterUserId);
                return true;
            }
            catch (Exception ex)
            {
                PrintError($"[RoamingNPCs] ClearBridgeLootMappingForPlayer: {ex}");
                return false;
            }
        }

        /// <summary>MaxxInvaders: pin deposit target to a <see cref="StorageContainer"/> net ID (OwnerID = anchor), or 0 to clear.</summary>
        [HookMethod("SetBridgeDepositBox")]
        public object SetBridgeDepositBox(ulong petEntityNetId, ulong anchorSteamId, ulong boxNetId)
        {
            try
            {
                if (listNpcPlayers == null || !listNpcPlayers.TryGetValue(petEntityNetId, out var pet) || pet == null ||
                    pet.IsDestroyed)
                    return false;
                if (pet.Data?.Setup?.FullState == null) return false;

                pet.Data.SpawnedFromMaxxInvadersBridge = true;
                if (anchorSteamId != 0UL)
                    pet.Data.BridgeProtectAnchorUserId = anchorSteamId;

                if (boxNetId == 0UL)
                {
                    pet.Data.BridgeDepositContainerNetId = 0UL;
                    return true;
                }

                var ent = BaseNetworkable.serverEntities.Find(new NetworkableId(boxNetId)) as BaseEntity;
                if (ent == null || ent.IsDestroyed || ent is not StorageContainer) return false;
                if (anchorSteamId != 0UL && ent.OwnerID != anchorSteamId) return false;

                pet.Data.BridgeDepositContainerNetId = boxNetId;
                pet.Data.Setup.FullState.BridgeUseAnchorOwnedStorage = true;
                if (pet.Data.Setup.FullState.BridgeAnchorStorageSearchRadius <= 0f)
                    pet.Data.Setup.FullState.BridgeAnchorStorageSearchRadius = 18f;
                return true;
            }
            catch (Exception ex)
            {
                PrintError($"[RoamingNPCs] SetBridgeDepositBox: {ex}");
                return false;
            }
        }

        /// <summary>MaxxInvaders: pin home tool cupboard (<see cref="BuildingPrivlidge"/>) for far roam from base; 0 clears.</summary>
        [HookMethod("SetBridgeHomeCupboard")]
        public object SetBridgeHomeCupboard(ulong petEntityNetId, ulong anchorSteamId, ulong cupboardNetId)
        {
            try
            {
                if (listNpcPlayers == null || !listNpcPlayers.TryGetValue(petEntityNetId, out var pet) || pet == null ||
                    pet.IsDestroyed)
                    return false;
                if (pet.Data?.Setup == null) return false;

                pet.Data.SpawnedFromMaxxInvadersBridge = true;
                if (anchorSteamId != 0UL)
                    pet.Data.BridgeProtectAnchorUserId = anchorSteamId;

                if (cupboardNetId == 0UL)
                {
                    pet.Data.BridgeHomeCupboardNetId = 0UL;
                    return true;
                }

                var ent = BaseNetworkable.serverEntities.Find(new NetworkableId(cupboardNetId)) as BaseEntity;
                if (ent == null || ent.IsDestroyed || ent is not BuildingPrivlidge) return false;
                if (anchorSteamId != 0UL && ent.OwnerID != anchorSteamId) return false;

                pet.Data.BridgeHomeCupboardNetId = cupboardNetId;
                pet.Data.Setup.BridgePatrol ??= new SetupBridgePatrol();
                pet.Data.Setup.BridgePatrol.Enable = true;
                if (pet.Data.Setup.BridgePatrol.RadiusMeters < 40f) pet.Data.Setup.BridgePatrol.RadiusMeters = 40f;
                pet.Data.Setup.Controller ??= new ControllerSetup();
                if (pet.Data.Setup.Controller.RadiusFindEntity < BridgeHomeRoamMinFindRadius)
                    pet.Data.Setup.Controller.RadiusFindEntity = BridgeHomeRoamMinFindRadius;
                pet.Data.Setup.Controller.BridgeBoostScanTimers();
                return true;
            }
            catch (Exception ex)
            {
                PrintError($"[RoamingNPCs] SetBridgeHomeCupboard: {ex}");
                return false;
            }
        }

        [HookMethod("IsBridgeTemplateReady")]
        public object IsBridgeTemplateReady(string templateKey)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(templateKey) || config?.bots == null)
                    return "no_config";
                if (!TryResolveBotConfigKey(templateKey, out _, out BotSetup baseSetup) || baseSetup == null)
                    return "missing";
                if (!baseSetup.Enable)
                    return "disabled";
                return "ok";
            }
            catch (Exception ex)
            {
                return "error:" + ex.Message;
            }
        }

        [HookMethod("GetMaxxInvadersGuiSummary")]
        public object GetMaxxInvadersGuiSummary()
        {
            var sb = new StringBuilder();
            try
            {
                sb.AppendLine("<b>RoamingNPCs</b>  oxide/config/RoamingNPCs.json");
                sb.AppendLine();
                sb.AppendLine($"Version: {Version}");
                sb.AppendLine(
                    "Bridge API: SpawnFromTemplateForBridge, ApplySquadCompanionMode, DepositItemsToAnchorOwnedStorage, ApplyBridgeTask, SetBridgeDepositBox, SetBridgeHomeCupboard, GetBridgeTaskLabel, GetBridgeLootPetNetIdForPlayer, ClearBridgeLootMappingForPlayer, IsBridgeTemplateReady, GetMaxxInvadersGuiSummary");
                sb.AppendLine();
                if (config?.bots == null)
                {
                    sb.AppendLine("Bots settings: (none — config not loaded)");
                    return sb.ToString();
                }

                var total = 0;
                var enabled = 0;
                foreach (var kv in config.bots)
                {
                    total++;
                    if (kv.Value != null && kv.Value.Enable) enabled++;
                }

                sb.AppendLine($"Bots in config: {total} total, {enabled} with Enable bot? on");
                sb.AppendLine($"Tracked roaming NPCs (active): {listNpcPlayers?.Count ?? 0}");
                sb.AppendLine();
                sb.AppendLine("Template keys (must match MaxxInvaders DefaultRoamingTemplateKey / tier RoamingTemplateKey):");
                var i = 0;
                foreach (var kv in config.bots.OrderBy(x => x.Key))
                {
                    if (i++ >= 36)
                    {
                        sb.AppendLine($"  … +{config.bots.Count - 36} more keys");
                        break;
                    }

                    var st = kv.Value == null ? "?" : kv.Value.Enable ? "on" : "off";
                    sb.AppendLine($"  • {kv.Key}  [{st}]");
                }

                sb.AppendLine();
                sb.AppendLine("Notes: disabled bots cannot be used by the bridge.");
                sb.AppendLine("Display names: max 24 chars, no angle brackets; emoji-only names become Viewer_ + viewer id digits.");
            }
            catch (Exception ex)
            {
                sb.AppendLine($"Summary error: {ex.Message}");
            }

            return sb.ToString();
        }

        [HookMethod("GetBridgeBotKeysCsv")]
        public object GetBridgeBotKeysCsv()
        {
            if (config?.bots == null || config.bots.Count == 0)
                return "";
            return string.Join(",", config.bots.Keys.OrderBy(x => x));
        }

        [HookMethod("ToggleBridgeBotEnabled")]
        public object ToggleBridgeBotEnabled(string templateKey)
        {
            if (string.IsNullOrWhiteSpace(templateKey) || config?.bots == null)
                return false;
            if (!TryResolveBotConfigKey(templateKey, out _, out var s) || s == null)
                return false;
            s.Enable = !s.Enable;
            SaveConfig();
            return true;
        }

        private sealed class BridgeBoolEntry
        {
            public string Path;
            public string Label;
            public bool Value;
        }

        /// <summary>All public bool fields on <see cref="BotSetup"/> (nested classes only; skips lists/arrays).</summary>
        [HookMethod("GetBridgeBotBoolTogglesJson")]
        public object GetBridgeBotBoolTogglesJson(string templateKey)
        {
            try
            {
                var list = GetBridgeBoolListInternal(templateKey);
                return list == null ? "[]" : JsonConvert.SerializeObject(list, BridgeBoolJsonSettings);
            }
            catch (Exception ex)
            {
                PrintWarning($"[RoamingNPCs] GetBridgeBotBoolTogglesJson: {ex.Message}");
                return "[]";
            }
        }

        [HookMethod("ToggleBridgeBotBoolByIndex")]
        public object ToggleBridgeBotBoolByIndex(string templateKey, int index)
        {
            try
            {
                var list = GetBridgeBoolListInternal(templateKey);
                if (list == null || index < 0 || index >= list.Count)
                    return false;
                return ToggleBridgeBotBoolByPath(templateKey, list[index].Path);
            }
            catch (Exception ex)
            {
                PrintWarning($"[RoamingNPCs] ToggleBridgeBotBoolByIndex: {ex.Message}");
                return false;
            }
        }

        [HookMethod("ToggleBridgeBotBoolByPath")]
        public object ToggleBridgeBotBoolByPath(string templateKey, string path)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(templateKey) || string.IsNullOrWhiteSpace(path) || config?.bots == null)
                    return false;
                if (!TryResolveBotConfigKey(templateKey, out _, out var root) || root == null)
                    return false;
                var parts = path.Split('.');
                if (parts.Length == 0)
                    return false;
                object cur = root;
                for (var i = 0; i < parts.Length - 1; i++)
                {
                    var fi = cur.GetType().GetField(parts[i], BindingFlags.Instance | BindingFlags.Public);
                    if (fi == null)
                        return false;
                    cur = fi.GetValue(cur);
                    if (cur == null)
                        return false;
                }

                var lastFi =
                    cur.GetType().GetField(parts[parts.Length - 1], BindingFlags.Instance | BindingFlags.Public);
                if (lastFi == null || lastFi.FieldType != typeof(bool))
                    return false;
                lastFi.SetValue(cur, !(bool)lastFi.GetValue(cur));
                SaveConfig();
                return true;
            }
            catch (Exception ex)
            {
                PrintWarning($"[RoamingNPCs] ToggleBridgeBotBoolByPath: {ex.Message}");
                return false;
            }
        }

        private List<BridgeBoolEntry> GetBridgeBoolListInternal(string templateKey)
        {
            if (string.IsNullOrWhiteSpace(templateKey) || config?.bots == null)
                return null;
            if (!TryResolveBotConfigKey(templateKey, out _, out var setup) || setup == null)
                return null;
            var list = new List<BridgeBoolEntry>();
            CollectBridgeBoolFields(setup, "", list, 0);
            list.Sort((a, b) => string.CompareOrdinal(a.Path, b.Path));
            return list;
        }

        private static void CollectBridgeBoolFields(object obj, string pathPrefix, List<BridgeBoolEntry> list, int depth)
        {
            if (obj == null || depth > 16)
                return;
            var t = obj.GetType();
            foreach (var fi in t.GetFields(BindingFlags.Instance | BindingFlags.Public))
            {
                if (fi.GetCustomAttribute<JsonIgnoreAttribute>() != null)
                    continue;
                var segment = fi.Name;
                var fp = string.IsNullOrEmpty(pathPrefix) ? segment : pathPrefix + "." + segment;
                if (fi.FieldType == typeof(bool))
                {
                    var jp = fi.GetCustomAttribute<JsonPropertyAttribute>();
                    var label = jp != null && !string.IsNullOrEmpty(jp.PropertyName) ? jp.PropertyName : segment;
                    list.Add(new BridgeBoolEntry
                    {
                        Path = fp,
                        Label = label,
                        Value = (bool)fi.GetValue(obj),
                    });
                }
                else if (ShouldRecurseIntoBridgeFieldType(fi.FieldType))
                {
                    var nest = fi.GetValue(obj);
                    if (nest != null)
                        CollectBridgeBoolFields(nest, fp, list, depth + 1);
                }
            }
        }

        private static bool ShouldRecurseIntoBridgeFieldType(Type t)
        {
            if (t == null || t == typeof(string))
                return false;
            if (!t.IsClass)
                return false;
            if (typeof(IEnumerable).IsAssignableFrom(t))
                return false;
            if (t.Namespace != null &&
                (t.Namespace.StartsWith("UnityEngine", StringComparison.Ordinal) ||
                 t.Namespace.StartsWith("System.Reflection", StringComparison.Ordinal)))
                return false;
            return true;
        }

        private static bool IsAnonymousBridgeDisplayLabel(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return true;
            var t = s.Trim();
            if (t.Length <= 1) return true;
            if (string.Equals(t, "Viewer", StringComparison.OrdinalIgnoreCase)) return true;
            if (string.Equals(t, "DemoViewer", StringComparison.OrdinalIgnoreCase)) return true;
            if (string.Equals(t, "User", StringComparison.OrdinalIgnoreCase)) return true;
            if (string.Equals(t, "Player", StringComparison.OrdinalIgnoreCase)) return true;
            if (string.Equals(t, "Test", StringComparison.OrdinalIgnoreCase)) return true;
            if (t.StartsWith("Test", StringComparison.OrdinalIgnoreCase)) return true;
            if (t.StartsWith("Viewer_", StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        private static string BridgeRandomCallsignFromSuffix(string uniqueSuffixForFallback)
        {
            string[] a =
            {
                "Rust", "Grit", "Viper", "Scrap", "Feral", "Dusk", "Iron", "Oak", "Ash", "Rogue", "Nova", "Brick"
            };
            string[] b =
            {
                "Fang", "Echo", "Jack", "Bolt", "Grim", "Crow", "Stag", "Wolf", "Fox", "Rook", "Mesa", "Drift"
            };
            var tag = $"{a[UnityEngine.Random.Range(0, a.Length)]}{b[UnityEngine.Random.Range(0, b.Length)]}";
            var id = string.IsNullOrWhiteSpace(uniqueSuffixForFallback) ? "x" : uniqueSuffixForFallback.Trim();
            var digits = new string(id.Where(char.IsDigit).ToArray());
            if (digits.Length > 6)
                digits = digits.Substring(digits.Length - 6);
            if (string.IsNullOrEmpty(digits))
                digits = UnityEngine.Random.Range(100, 999).ToString();
            var name = $"{tag}{digits}";
            return name.Length > 24 ? name.Substring(0, 24) : name;
        }

        /// <summary>Strip Rich Text / length; TikFinity placeholders (Viewer, Test…) become a random callsign instead of Viewer_ digits.</summary>
        private static string SanitizeBridgeDisplayName(string raw, string uniqueSuffixForFallback)
        {
            string s = null;
            if (!string.IsNullOrWhiteSpace(raw))
            {
                s = raw.Trim();
                if (s.Length > 24)
                    s = s.Substring(0, 24);
                s = s.Replace("<", "").Replace(">", "").Trim();
            }

            if (!string.IsNullOrEmpty(s) && !IsAnonymousBridgeDisplayLabel(s))
                return s;

            return BridgeRandomCallsignFromSuffix(uniqueSuffixForFallback);
        }
        #endregion
    }

    #region SoundVoiceData
    public partial class RoamingNPCs
    {
        private Dictionary<ulong, SoundVoice> recordedPlayers = new Dictionary<ulong, SoundVoice>();

        #region Localization
        protected override void LoadDefaultMessages()
        {
            Dictionary<string, string> ru = new Dictionary<string, string>
            {
                ["record_start"] = "Запись началась",
                ["record"] = "Вы уже начали запись",
                ["record_stop"] = "Запись остановлена, можете прослушать запись (/rnpc recvoice replay), сохранить (/rnpc recvoice save <name_file>) или удалить (/rnpc recvoice remove)",
                ["record_stopped"] = "Запись остановлена.",
                ["not_record"] = "Вы не начинали запись",
                ["contents_current_voices"] = "У Вас есть не сохраненная запись, можете прослушать запись (/rnpc recvoice replay), сохранить (/rnpc recvoice save <name_file>) или удалить (/rnpc recvoice remove)",
                ["not_recorded_voices"] = "Нет записанного голоса",
                ["play_current_voices"] = "Включаю текущую запись, не забудьте сохранить ее (/rnpc recvoice save <name_file>)",
                ["play_name_voices"] = "Включаю запись голоса из файла - {0}",
                ["not_name_file"] = "Не найден файл записи голоса - {0}",
                ["save_name_voices"] = "Запись голоса сохранена в файл - {0}",
                ["exists_name_file"] = "Такой файл уже существует - {0}",
                ["delete_name_voices"] = "Файл [{0}] записи голоса - удален",
                ["clear_record"] = "Текущая запись стерта",
                ["remove_current_voices"] = "Текущая запись удалена из памяти",
                ["load_name_voices"] = "Загружен файл записи - {0}",
                ["not_recorded_voices"] = "Не удалось загрузить файл записи - {0}",
                ["args_error"] = "Не определены аргументы команды",
            };
            Dictionary<string, string> en = new Dictionary<string, string>
            {
                ["record_start"] = "Recording started",
                ["record"] = "You have already started recording",
                ["record_stop"] = "Recording stopped, you can replay (/rnpc recvoice replay), save (/rnpc recvoice save <name_file>) or delete (/rnpc recvoice remove)",
                ["record_stopped"] = "Recording stopped.",
                ["not_record"] = "You didn't start the recording",
                ["contents_current_voices"] = "You have unsaved recording, you can replay (/rnpc recvoice replay), save (/rnpc recvoice save <name_file>) or remove (/rnpc recvoice remove)",
                ["not_recorded_voices"] = "No recoreded voice",
                ["play_current_voices"] = "Playing current recording, don't forget to save it (/rnpc recvoice save <name_file>)",
                ["play_name_voices"] = "Playing voice recording from file - {0}",
                ["not_name_file"] = "Recording file not found - {0}",
                ["save_name_voices"] = "Voice recording saved to file - {0}",
                ["exists_name_file"] = "Such file already exists - {0}",
                ["delete_name_voices"] = "File [{0}] is deleted",
                ["clear_record"] = "Current recording is cleared",
                ["remove_current_voices"] = "Current recording is deleted",
                ["load_name_voices"] = "Loaded recording file - {0}",
                ["not_recorded_voices"] = "Couldn't load recording file - {0}",
                ["args_error"] = "Command arguments error",
            };
            lang.RegisterMessages(ru, this, "ru");
            lang.RegisterMessages(en, this, "en");
        }
        public string GetLangText(string userID, string key, params object[] args) => string.Format(lang.GetMessage(key, this, userID), args);
        public void ChatMessage(BasePlayer initiator,
                                string key,
                                params object[] args) => initiator?.ChatMessage(string.Format(lang.GetMessage(key, this, initiator.UserIDString), args));
        public void ConsoleMessage(BasePlayer initiator,
                                string key,
                                params object[] args) => initiator?.ConsoleMessage(string.Format(lang.GetMessage(key, this, initiator.UserIDString), args));

        #endregion

        #region MethodsAPI

        public void PlayVoiceFile(BasePlayer initiator, BasePlayer target, string fileName)
        {
            if (TryLoadSoundFile(fileName, out var soundVoice))
            {
                soundVoice.PlaySounds(initiator, target);
            }
        }

        public void PlayVoiceFile(BasePlayer initiator, Vector3 position, float radius, string fileName)
        {
            if (TryLoadSoundFile(fileName, out var soundVoice))
            {
                soundVoice.PlaySounds(initiator, position, radius);
            }
        }

        #endregion

        #region Hooks
        private void OnPlayerVoice(BasePlayer player, byte[] data)
        {
            if (recordedPlayers.TryGetValue(player.userID, out var soundVoice) && soundVoice.IsRecord)
            {
                soundVoice.Sounds.Add(data);
            }
        }
        #endregion

        #region Commands
        
        public void Cmd_RecVoice(IPlayer pl, string command, string[] args)
        {
            if (pl.Object is BasePlayer player)
            {
                if (args?.Length is int length && length > 0)
                {
                    SoundVoice soundVoice;
                    switch (args[0].ToLower())
                    {
                        case "start":
                            {
                                if (!recordedPlayers.ContainsKey(player.userID)) recordedPlayers[player.userID] = new SoundVoice();
                                soundVoice = recordedPlayers[player.userID];

                                if (!soundVoice.IsRecord)
                                {
                                    soundVoice.IsRecord = true;
                                    pl.Reply(GetLangText(player.UserIDString, "record_start"));
                                }
                                else pl.Reply(GetLangText(player.UserIDString, "record"));
                                return;
                            }
                        case "stop":
                            {
                                if (recordedPlayers.ContainsKey(player.userID))
                                {
                                    soundVoice = recordedPlayers[player.userID];
                                    if (soundVoice.IsRecord)
                                    {
                                        pl.Reply(GetLangText(player.UserIDString, "record_stop"));
                                        soundVoice.IsRecord = false;
                                        return;
                                    }
                                }
                                pl.Reply(GetLangText(player.UserIDString, "not_record"));
                                return;
                            }
                        case "replay":
                            {
                                if (length == 1)
                                {
                                    if (recordedPlayers.ContainsKey(player.userID))
                                    {
                                        soundVoice = recordedPlayers[player.userID];
                                        if (soundVoice.IsRecord)
                                        {
                                            pl.Reply(GetLangText(player.UserIDString, "record_stop"));
                                            soundVoice.IsRecord = false;
                                        }
                                        if (soundVoice.HasSounds)
                                        {
                                            soundVoice.TestPlaySounds(player);
                                            pl.Reply(GetLangText(player.UserIDString, "play_current_voices"));
                                        }
                                        else
                                        {
                                            pl.Reply(GetLangText(player.UserIDString, "not_recorded_voices"));
                                        }
                                        return;
                                    }
                                    pl.Reply(GetLangText(player.UserIDString, "not_record"));
                                }
                                else if (length == 2)
                                {
                                    if (TryLoadSoundFile(args[1], out soundVoice))
                                    {
                                        soundVoice.TestPlaySounds(player);
                                        pl.Reply(GetLangText(player.UserIDString, "play_name_voices", args[1]));
                                    }
                                    else pl.Reply(GetLangText(player.UserIDString, "not_name_file", args[1]));
                                }
                                else pl.Reply(GetLangText(player.UserIDString, "args_error"));

                                return;
                            }
                        case "save":
                            {
                                if (length == 2)
                                {
                                    if (ExistsFile(args[1]))
                                    {
                                        ChatMessage(player, "exists_name_file", args[1]);
                                        return;
                                    }
                                    if (recordedPlayers.ContainsKey(player.userID))
                                    {
                                        soundVoice = recordedPlayers[player.userID];
                                        if (soundVoice.IsRecord)
                                        {
                                            soundVoice.IsRecord = false;
                                            pl.Reply(GetLangText(player.UserIDString, "record_stopped"));
                                        }
                                        if (soundVoice.HasSounds)
                                        {
                                            SaveSoundFile(args[1], soundVoice);
                                            pl.Reply(GetLangText(player.UserIDString, "save_name_voices", args[1]));
                                        }
                                        else
                                        {
                                            pl.Reply(GetLangText(player.UserIDString, "not_recorded_voices"));
                                            ChatMessage(player, "not_recorded_voices");
                                        }
                                        recordedPlayers.Remove(player.userID);
                                        return;
                                    }
                                    else pl.Reply(GetLangText(player.UserIDString, "not_record"));
                                }
                                else pl.Reply(GetLangText(player.UserIDString, "args_error"));

                                return;
                            }
                        case "clear":
                            {
                                if (recordedPlayers.ContainsKey(player.userID))
                                {
                                    soundVoice = recordedPlayers[player.userID];
                                    if (soundVoice.IsRecord)
                                    {
                                        pl.Reply(GetLangText(player.UserIDString, "record_stopped"));
                                        soundVoice.IsRecord = false;
                                    }
                                    soundVoice.Sounds.Clear();
                                    pl.Reply(GetLangText(player.UserIDString, "clear_record"));
                                }
                                else pl.Reply(GetLangText(player.UserIDString, "not_record"));
                                return;
                            }
                        case "remove":
                            {
                                if (recordedPlayers.ContainsKey(player.userID))
                                {
                                    soundVoice = recordedPlayers[player.userID];
                                    if (soundVoice.IsRecord)
                                    {
                                        pl.Reply(GetLangText(player.UserIDString, "record_stopped"));
                                        soundVoice.IsRecord = false;
                                    }
                                    recordedPlayers.Remove(player.userID);
                                    pl.Reply(GetLangText(player.UserIDString, "remove_current_voices"));
                                }
                                return;
                            }
                        case "delete":
                            {
                                if (length == 2)
                                {
                                    if (ExistsFile(args[1]))
                                    {
                                        DeleteFile(args[1]);
                                        pl.Reply(GetLangText(player.UserIDString, "delete_name_voices", args[1]));
                                    }
                                    else pl.Reply(GetLangText(player.UserIDString, "not_name_file", args[1]));
                                }
                                else pl.Reply(GetLangText(player.UserIDString, "args_error"));
                                return;
                            }
                        case "load":
                            {
                                if (recordedPlayers.ContainsKey(player.userID))
                                {
                                    pl.Reply("contents_current_voices");
                                    return;
                                }
                                if (length == 2)
                                {
                                    if (ExistsFile(args[1]))
                                    {
                                        if (TryLoadSoundFile(args[1], out soundVoice))
                                        {
                                            recordedPlayers[player.userID] = soundVoice;
                                            pl.Reply(GetLangText(player.UserIDString, "load_name_voices", args[1]));
                                            goto case "start";
                                        }
                                        else
                                        {
                                            pl.Reply(GetLangText(player.UserIDString, "not_load_name_file", args[1]));
                                        }
                                    }
                                    else pl.Reply(GetLangText(player.UserIDString, "not_name_file", args[1]));
                                }
                                else pl.Reply(GetLangText(player.UserIDString, "args_error"));
                                return;
                            }
                        default:
                            {
                                Debug.LogWarning(RU ? "Команда не найдена [{0}]" : "Command not found [{0}]", args[0]);
                                return;
                            }
                    }
                }
                else
                {
                    Debug.LogWarning(RU ? "Недостаточно аргументов" : "Not enough arguments");
                }
            }
        }

        #endregion

        #region Data
        private string dataPath => $"{nameof(RoamingNPCs)}/Phrases/";
        protected bool ExistsFile(string name) => Interface.Oxide.DataFileSystem.ExistsDatafile(dataPath + name);
        protected void DeleteFile(string name)
        {
            if (ExistsFile(name)) Interface.Oxide.DataFileSystem.DeleteDataFile(dataPath + name);
        }
        protected bool TryLoadSoundFile(string name, out SoundVoice soundVoice)
        {
            soundVoice = null;
            try
            {
                if (ExistsFile(name))
                {
                    soundVoice = Interface.Oxide.DataFileSystem.ReadObject<SoundVoice>(dataPath + name);
#if DebugLog
                    Debug.Log(RU ? "Файл {0} загружен" : "File {0} loaded", name);
#endif
                }
            }
            catch (Exception ex)
            {
                Debug.LogError($"TryLoadSoundFile: {ex}");
            }
            return soundVoice != null;
        }
        protected void SaveSoundFile(string name, SoundVoice soundVoice)
        {
            Interface.Oxide.DataFileSystem.WriteObject(dataPath + name, soundVoice);
        }
        public class SoundVoice
        {
            private const string prefabPlayer = "assets/prefabs/player/player.prefab";
            private BasePlayer initiatorBotPlayer;
            public List<byte[]> Sounds = new List<byte[]>();
            [JsonIgnore] public bool IsRecord = false;

            public SoundVoice()
            {
                initiatorBotPlayer = null;
            }

            [JsonIgnore] public bool HasSounds => Sounds?.Count > 0;

            public void TestPlaySounds(BasePlayer target)
            {
                if (initiatorBotPlayer) initiatorBotPlayer.AdminKill();
                Vector3 pos = target.ServerPosition;
                pos.y = TerrainMeta.HeightMap.GetHeight(pos) - 3f;
                initiatorBotPlayer = GameManager.server.CreateEntity(prefabPlayer, pos) as BasePlayer;
                if (initiatorBotPlayer) initiatorBotPlayer.Spawn();
                PlaySounds(initiatorBotPlayer, target, Vector3.zero, 0, () => initiatorBotPlayer.Invoke(initiatorBotPlayer.AdminKill, 10f));
            }
            public void PlaySounds(BasePlayer initiator, BasePlayer target)
            {
                PlaySounds(initiator, target, Vector3.zero, 0, null);
            }
            public void PlaySounds(BasePlayer initiator, Vector3 position, float radius)
            {
                PlaySounds(initiator, null, position, radius, null);
            }
            private void PlaySounds(BasePlayer initiator, BasePlayer target, Vector3 position, float radius, UnityAction onSend)
            {
                if (HasSounds && initiator && !initiator.IsNpc)
                {
                    foreach (var sound in Sounds)
                    {
                        Send(initiator.net.ID, sound, target, position, radius);
                    }
                    onSend?.Invoke();
                }
            }
            private void Send(NetworkableId initiator, byte[] data, BasePlayer target, Vector3 position, float radius)
            {
                NetWrite netWrite = Net.sv.StartWrite();
                netWrite.PacketID(Message.Type.VoiceData);
                netWrite.EntityID(initiator);
                netWrite.BytesWithSize(data);
                if (target && !target.IsNpc && target.userID.IsSteamId() && target.IsConnected)
                {
                    netWrite.Send(new SendInfo(target.Connection)
                    {
                        priority = Priority.Immediate
                    });
                }
                else if (position != Vector3.zero && radius > 0)
                {
                    netWrite.Send(new SendInfo(BaseNetworkable.GetConnectionsWithin(position, radius, true, true))
                    {
                        priority = Priority.Immediate
                    });
                }
            }

        }
        #endregion

    }
    #endregion
}

namespace Oxide.Plugins.RoamingNPCex
{
    public static class PluginExtension
    {
        public static List<T> OrderBy<T>(this List<T> source, Func<T, string> keySelector)
            where T : class
        {
            source.Sort((a, b) => string.Compare(keySelector(a), keySelector(b), StringComparison.Ordinal));
            return source;
        }
        public static Dictionary<TKey, TVal> GetPoolNodes<TKey, TVal>(this Dictionary<TKey, TVal> dictionary) where TVal : class, Pool.IPooled, new()
        {
            if (dictionary == null) return Pool.Get<Dictionary<TKey, TVal>>();
            foreach (var item in dictionary.Values)
            {
                if (item != null)
                {
                    TVal val = item;
                    Pool.Free(ref val);
                }
            }
            dictionary.Clear();
            return dictionary;
        }
        public static bool ContainsVector3(this Rect rect, Vector3 point)
        {
            return point.x >= rect.xMin && point.x < rect.xMax && point.z >= rect.yMin && point.z < rect.yMax;
        }
        public static string FormatBytes(this long bytes)
        {
            if (bytes < (long)1024)
            {
                return string.Format("{0:0} B", bytes);
            }
            if (bytes < (long)1048576)
            {
                return string.Format("{0:0} KB", bytes / (long)1024);
            }
            if (bytes < (long)1073741824)
            {
                return string.Format("{0:0} MB", bytes / (long)1048576);
            }
            return string.Format("{0:0} GB", bytes / (long)1073741824);
        }
        public static string[] Skip(this string[] source, int count)
        {
            if (source.Length == 0) return Array.Empty<string>();
            string[] result = new string[source.Length - count];
            int n = 0;
            for (int i = 0; i < source.Length; i++)
            {
                if (i < count) continue;
                result[n] = source[i];
                n++;
            }
            return result;
        }
        public static void SetFieldValue(this object obj, string fieldName, object value)
        {
            if (obj == null) 
                throw new ArgumentNullException(nameof(obj));
            
            if (string.IsNullOrWhiteSpace(fieldName))
                throw new ArgumentException("Field can't be empty", nameof(fieldName));

            Type type = obj.GetType();
            BindingFlags bindingFlags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
            
            FieldInfo field = type.GetField(fieldName, bindingFlags);
            
            if (field == null)
                throw new InvalidOperationException($"Field '{fieldName}' is not found in type {type.FullName}");

            if (!field.IsInitOnly && !field.IsLiteral) 
            {
                field.SetValue(obj, value);
            }
            else
            {
                throw new InvalidOperationException($"Field '{fieldName}' is constant and have only initialization");
            }
        }
        public static bool IsVisible(this BasePlayer player, BasePlayer target, int layerMask)
        {
            try
            {                
                if (player == null || target == null) return false;
                if (player.eyes == null || target.eyes == null) return false;

                return player.CanSee(player.eyes.position, target.eyes.position) || player.CanSee(player.eyes.position, target.CenterPoint());
            }
            catch // for some reason still getting NREs even with all these checks
            {
                return false;
            }
        }
        public static bool CanSeeTarget(this BasePlayer player, BasePlayer target, int layerMask)
        {
            RaycastHit hitInfo;
            if (Physics.SphereCast(player.eyes.position, 0.1f, (target.CenterPoint() - player.eyes.position).normalized, out hitInfo, 150f, layerMask, QueryTriggerInteraction.Ignore) && hitInfo.GetEntity() == target) return true;
            // if (Physics.SphereCast(player.eyes.position, 0.1f, (target.transform.position - player.eyes.position).normalized, out hitInfo, 150f, layerMask, QueryTriggerInteraction.Ignore) && hitInfo.GetEntity() == target) return true;
            if (Physics.SphereCast(player.eyes.position, 0.1f, (target.eyes.position - player.eyes.position).normalized, out hitInfo, 150f, layerMask, QueryTriggerInteraction.Ignore) && hitInfo.GetEntity() == target) return true;
            return false;
        }
        public static Vector3 GetHeadRayToTarget(this BasePlayer player, BaseEntity target)
        {
            Vector3 pos = player.eyes.position;
            if (target is BasePlayer bp && bp != null && bp.IsValid() && bp.eyes != null)
                return (bp.eyes.position - pos).normalized;
            var to = target.CenterPoint() - pos;
            if (to.sqrMagnitude < 1e-8f) return player.eyes.BodyForward();
            return to.normalized;
        }
        public static float DistanceHorizontal(this BaseEntity source, Vector3 target)
        {
            return source.CenterPoint().DistanceHorizontal(target);
        }
        public static float DistanceHorizontal(this Vector3 source, Vector3 target)
        {
            source.y = 0; target.y = 0;
            return Vector3.Distance(source, target);
        }
        public static bool Exists<TSource>(this IEnumerable<TSource> source, Func<TSource, bool> predicate)
        {
            bool result = false;
            using (var enumerator = source.GetEnumerator()) while (enumerator.MoveNext()) if (predicate(enumerator.Current)) { result = true; break; }
            ;
            return result;
        }
        // Where/Count/OfType removed: they duplicated System.Linq.Enumerable and confused the Oxide compiler (ambiguous calls).
        public static BuildingPrivlidge GetBuildingPrivlidge(Vector3 pos)
        {
            OBB obb = new(pos, Vector3.one, Quaternion.identity);
            BuildingBlock other = null;
            BuildingPrivlidge buildingPrivlidge = null;
            List<BuildingBlock> obj2 = Pool.Get<List<BuildingBlock>>();
            Vis.Entities(obb.position, 16f + obb.extents.magnitude, obj2, 2097152);
            for (int i = 0; i < obj2.Count; i++)
            {
                BuildingBlock buildingBlock = obj2[i];
                if (!buildingBlock.IsOlderThan(other) || obb.Distance(buildingBlock.WorldSpaceBounds()) > 16f)
                {
                    continue;
                }

                BuildingManager.Building building = buildingBlock.GetBuilding();
                if (building != null)
                {
                    BuildingPrivlidge dominatingBuildingPrivilege = building.GetDominatingBuildingPrivilege();
                    if (dominatingBuildingPrivilege != null)
                    {
                        other = buildingBlock;
                        buildingPrivlidge = dominatingBuildingPrivilege;
                    }
                }
            }

            Pool.FreeUnmanaged(ref obj2);
            return buildingPrivlidge;
        }
    }
    public static class PooledCollection
    {
        public static void ClearAllPooledCollection<T>(this T plugin, out string response, bool ruResponse = false) where T : CovalencePlugin
        {
            var allNestedTypes = GetAllNestedTypes(plugin.GetType());

            response = ruResponse ? "Очистка пула от коллекций плагина:" : "Clearing pool from collections of plugin:";
            
            foreach (var type in allNestedTypes)
            {
                if (!type.IsClass || type.IsAbstract || !typeof(Pool.IPooled).IsAssignableFrom(type) || !type.IsNested || type.DeclaringType != typeof(T)) continue;

                bool remove = Pool.Directory.Remove(type, out var poolCollection);
                if (remove)
                {
                    poolCollection.Reset();
                }
                response += $"\n          {(ruResponse ? $"Коллекция[{type.Name}]: {(remove ? "удалена" : "не создана")}" : $"Collection[{type.Name}]: {(remove ? "removed" : "not created")}")}";
            }
        }
        private static IEnumerable<Type> GetAllNestedTypes(Type type)
        {
            List<Type> result = new();
            foreach (var nestedType in type.GetNestedTypes(
                BindingFlags.Public |
                BindingFlags.NonPublic |
                BindingFlags.DeclaredOnly))
            {
                result.Add(nestedType);
                result.AddRange(GetAllNestedTypes(nestedType)); 
            }
            return result;
        }
    }
    public static class PathUtils
    {
        /// <summary>
        /// Проверяет, что все точки из переданной коллекции находятся на расстоянии не меньше minDistance
        /// от всех узловых точек всех второстепенных дорог (TerrainMeta.Path.SideRoads).
        /// </summary>
        /// <param name="pointsToCheck">Коллекция точек для проверки.</param>
        /// <param name="minDistance">Минимально допустимое расстояние.</param>
        /// <returns>false, если хотя бы одна точка слишком близко к одной из дорог, иначе true.</returns>
        public static bool ArePointsFarEnoughFromRoads(IEnumerable<Vector3> pointsToCheck, float minDistance)
        {
            // Получаем список второстепенных дорог из TerrainMeta
            List<PathList> sideRoads = TerrainMeta.Path.Roads;
            if (sideRoads == null || sideRoads.Count == 0)
            {
                return true; // Нет дорог для проверки, значит, все точки "достаточно далеко".
            }

            // Используем квадрат расстояния для оптимизации (избегаем вычисления корня)
            float minDistanceSq = minDistance * minDistance;

            // Перебираем все дороги
            foreach (PathList road in sideRoads)
            {
                if (road?.Path?.Points == null)
                {
                    continue; // Пропускаем некорректные или пустые дороги
                }

                // Перебираем все узловые точки на текущей дороге
                foreach (Vector3 roadPoint in road.Path.Points)
                {
                    // Перебираем все точки, которые нужно проверить
                    foreach (Vector3 point in pointsToCheck)
                    {
                        // Если квадрат расстояния меньше минимального, значит точка слишком близко
                        if ((point - roadPoint).sqrMagnitude < minDistanceSq)
                        {
                            return false; // Найдена точка, которая находится слишком близко.
                        }
                    }
                }
            }

            // Если все точки всех дорог были проверены и ни одна не оказалась слишком близко, возвращаем true.
            return true;
        }
        public static bool AreFarEnoughFromRoads(Vector3 pointsToCheck, float minDistance)
        {
            // Получаем список второстепенных дорог из TerrainMeta
            List<PathList> sideRoads = TerrainMeta.Path.Roads;
            if (sideRoads == null || sideRoads.Count == 0)
            {
                return true; // Нет дорог для проверки, значит, все точки "достаточно далеко".
            }

            // Используем квадрат расстояния для оптимизации (избегаем вычисления корня)
            float minDistanceSq = minDistance * minDistance;

            // Перебираем все дороги
            foreach (PathList road in sideRoads)
            {
                if (road?.Path?.Points == null)
                {
                    continue; // Пропускаем некорректные или пустые дороги
                }

                // Перебираем все узловые точки на текущей дороге
                foreach (Vector3 roadPoint in road.Path.Points)
                {
                    // Если квадрат расстояния меньше минимального, значит точка слишком близко
                    if ((pointsToCheck - roadPoint).sqrMagnitude < minDistanceSq)
                    {
                        return false; // Найдена точка, которая находится слишком близко.
                    }
                }
            }

            // Если все точки всех дорог были проверены и ни одна не оказалась слишком близко, возвращаем true.
            return true;
        }
        /// <summary>
        /// Фильтрует список точек, оставляя только те, которые находятся на расстоянии не меньше minDistance от пути.
        /// </summary>
        public static List<Vector3> FilterPointsByMinDistance(PathList path, IEnumerable<Vector3> points, float minDistance)
        {
            var filteredPoints = new List<Vector3>();
            float minDistanceSq = minDistance * minDistance;

            foreach (var point in points)
            {
                Vector3 closestPointOnPath = GetClosestPointOnPath(path, point);
                if ((point - closestPointOnPath).sqrMagnitude >= minDistanceSq)
                {
                    filteredPoints.Add(point);
                }
            }
            return filteredPoints;
        }

        /// <summary>
        /// Находит ближайшую точку на центральной линии пути.
        /// </summary>
        public static Vector3 GetClosestPointOnPath(PathList path, Vector3 position)
        {
            Vector3 closestPoint = Vector3.zero;
            float minDistanceSq = float.MaxValue;

            Vector3[] pathPoints = path.Path.Points;
            if (pathPoints == null || pathPoints.Length < 2)
            {
                return path.Path.GetStartPoint();
            }

            for (int i = 0; i < pathPoints.Length - 1; i++)
            {
                Vector3 p1 = pathPoints[i];
                Vector3 p2 = pathPoints[i + 1];
                Vector3 closestOnSegment = GetClosestPointOnLineSegment(p1, p2, position);
                float distSq = (position - closestOnSegment).sqrMagnitude;

                if (distSq < minDistanceSq)
                {
                    minDistanceSq = distSq;
                    closestPoint = closestOnSegment;
                }
            }
            return closestPoint;
        }

        /// <summary>
        /// Вспомогательный метод для нахождения ближайшей точки на отрезке прямой.
        /// </summary>
        private static Vector3 GetClosestPointOnLineSegment(Vector3 segmentStart, Vector3 segmentEnd, Vector3 point)
        {
            Vector3 segmentDirection = segmentEnd - segmentStart;
            float segmentLengthSq = segmentDirection.sqrMagnitude;

            if (segmentLengthSq == 0.0f)
            {
                return segmentStart;
            }
            
            float t = Vector3.Dot(point - segmentStart, segmentDirection) / segmentLengthSq;
            t = Mathf.Clamp01(t);

            return segmentStart + t * segmentDirection;
        }
    }

    public static class Error
    {
        public static Exception ArgumentNull(string s)
        {
            return new ArgumentNullException(s);
        }
        public static Exception NoElements()
        {
            return new InvalidOperationException("Sequence contains no elements");
        }
        public static Exception OutOfRange()
        {
            return new InvalidOperationException("index out of range");
        }
    }

    /// <summary>Uses <see cref="FrankensteinPet"/> (not nested <c>RoamingNPCs.CustomPet</c>) so Oxide/uMod resolves the generic for UnityEvent.</summary>
    public class OnBotCreatedEvent : UnityEvent<FrankensteinPet> { }
}