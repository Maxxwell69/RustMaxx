using UnityEngine;
using System.Collections.Generic;
using Newtonsoft.Json;
using System.Collections;
using System;
using Oxide.Game.Rust.Cui;
using UnityEngine.Events;
using Oxide.Core.Plugins;
using Oxide.Core;
using UnityEngine.AI;
using Oxide.Plugins.PersonalNPCex;

namespace Oxide.Plugins
{
    [Info("PersonalNPC", "walkinrey", "2.0.5")] 
    public class PersonalNPC : RustPlugin 
    {
        public static PersonalNPC Instance;
        private const bool ru = false;

        [PluginReference] private Plugin ImageLibrary, VehicleDeployedLocks, PNPCAddonHeli, PNPCAddonBuilder, PNPCAddonHunter, ZoneManager, Friends, Clans, DeployableNature;

        private Dictionary<ulong, PlayerBotController> _existsControllers = new Dictionary<ulong, PlayerBotController>();
        private Dictionary<ulong, BotOwnerComponent> _existsBots = new Dictionary<ulong, BotOwnerComponent>();

        private List<string> _permissionKeys = new List<string>();
        private List<ulong> _pendingSpawnBots = new List<ulong>();

        private Dictionary<ulong, DateTime> _cooldownInfo = new Dictionary<ulong, DateTime>();

        private static string _noCooldownPermission = "personalnpc.nocooldown";

        public OnControllerCreatedEvent OnControllerCreated = new OnControllerCreatedEvent();

        #region Config

        private Configuration _config; 

        public class Configuration
        {
            [JsonProperty(!ru ? "Control setup" : "Настройки контроллера")]
            public ControlsSetup controls = new ControlsSetup();

            [JsonProperty(!ru ? "GUI customization" : "Настройки GUI")]
            public GUIOptions gui = new GUIOptions();

            [JsonProperty(!ru ? "Bot settings by permission" : "Настройки ботов по правам")]
            public Dictionary<string, BotSetup> permissionBot = new Dictionary<string, BotSetup>();

            [JsonProperty(!ru ? "Bot install by item" : "Установка ботов по предмету")]
            public List<ItemInfo> installItem = new List<ItemInfo>();

            [JsonProperty(!ru ? "How many seconds will the bot update the information? (affects the performance and operation of the bot)" : "Сколько секунд будет обновлять информацию бот? (влияет на производительность и работу бота)")]
            public float mainProcessTimer = 0.01f;

            [JsonProperty(!ru ? "Spawn a backpack with his items when a bot dies? (otherwise his corpse will spawn)" : "Создавать рюкзак с его предметами при смерти бота? (иначе его труп будет спавнить)")]
            public bool enableBackpackOnDeath = false;

            [JsonProperty(!ru ? "Disable bot's backpack/corpse despawn?" : "Отключить деспавн рюкзака/трупа бота?")]
            public bool disableBackpackDespawn = false;

            [JsonProperty(!ru ? "Despawn bot’s items when owner disconnects?" : "Деспавнить предметы бота при отключении владельца?")]
            public bool enableDespawnOnDisconnect = false;

            [JsonProperty(!ru ? "Enable ExtraSeating plugin support?" : "Включить поддержку плагина ExtraSeating?")]
            public bool enableExtraSeatingSupport = false;

            [JsonProperty(!ru ? "Clear console of 'ownerPlayer is not player' spam?" : "Очистить консоль от спама 'ownerPlayer is not player'?")]
            public bool clearConsoleOfSpam = true;

            [JsonProperty(!ru ? "Auto spawn first available bot on plugin load for every player?" : "Автоматически заспавнить первого доступного бота при загрузке плагина для всех игроков?")]
            public bool autoSpawnBot = false;

            [JsonProperty(!ru ? "List of prefabs that the bot can loot (useful if the bot attacks loot instead of looting it)" : "Список префабов, которые может собрать бот (полезно если бот атакует предметы вместо того, чтобы собирать их)")]
            public List<string> allowedLootPrefabs = new List<string>();

            public struct ItemInfo 
            {
                [JsonProperty(!ru ? "Item name" : "Название предмета")]
                public string name;

                [JsonProperty(!ru ? "Item shortname" : "Короткое название предмета")]
                public string shortname;

                [JsonProperty(!ru ? "Item skin" : "Скин предмета")]
                public ulong skin;

                [JsonProperty(!ru ? "Return item back if player have despawned the PersonalNPC via command or GUI?" : "Вернуть предмет обратно, если игрок отключил NPC через команду или GUI?")]
                public bool returnDespawn;

                [JsonProperty(!ru ? "Bot info" : "Информация о боте")]
                public BotSetup bot;
            }

            public class ControlsSetup
            {
                [JsonIgnore]
                public BUTTON controlButton = BUTTON.FIRE_THIRD;

                [JsonProperty(!ru ? "Which button will assign tasks to the bot, kill/get/collect, etc. (MIDDLE_MOUSE, SECOND_MOUSE, E, RELOAD, SPRINT)" : "Которую кнопку будет использовать бот для выполнения задач, убийства/вытягивания/сбора, и т.п. (MIDDLE_MOUSE, SECOND_MOUSE, E, RELOAD, SPRINT)")]
                public string mainControlButton = "MIDDLE_MOUSE"; 

                [JsonProperty(!ru ? "Use point gesture instead of button?" : "Использовать жест точки вместо кнопки?")]
                public bool usePointGesture = false;

                [JsonProperty(!ru ? "Range of the task assignment button" : "Расстояние кнопки задания задачи")]
                public float rayLength = 25f;

                [JsonProperty(!ru ? "Display 3D arrows over a target?" : "Отображать 3D стрелки над целью?")]
                public bool enableArrowView = true;

                [JsonProperty(!ru ? "Show 3D text if owner attacking his bot? (lang key is 'Bot_Notice_HitByOwner')" : "Отображать 3D текст, если владелец атакует своего бота? (ключ языка 'Bot_Notice_HitByOwner')")]
                public bool showTextOnHit = false; //

                [JsonProperty(!ru ? "Text display duration" : "Длительность отображения текста")]
                public int textViewDuration = 2;

                [JsonProperty(!ru ? "Arrow display duration" : "Длительность отображения стрелки")]
                public int arrowViewDuration = 2;

                [JsonProperty(!ru ? "Distance between owner and bot in follow state" : "Расстояние между владельцем и ботом в состоянии следования")]
                public float followDistance = 2f;

                [JsonProperty(!ru ? "Distance between owner and bot to recover" : "Расстояние между владельцем и ботом для восстановления")]
                public float recoverDistance = 3f;

                [JsonProperty(!ru ? "Distance between bot and collectable entity to pickup" : "Расстояние между ботом и подбираемой сущностью для поднятия")]
                public float collectableDistance = 2f;

                [JsonProperty(!ru ? "Distance between bot and item to pickup" : "Расстояние между ботом и предметом для поднятия")]
                public float itemPickupDistance = 2f;

                [JsonProperty(!ru ? "Distance between bot and loot container to loot" : "Расстояние между ботом и контейнером с лутом для поиска лута")]
                public float lootContainerDistance = 2f;

                [JsonProperty(!ru ? "Distance between bot and tree/ore to gather" : "Расстояние между ботом и деревом/руду для сбора")]
                public float gatherDistance = 3f;

                [JsonProperty(!ru ? "Distance between bot and seat to mount" : "Расстояние между ботом и сиденья для посадки")]
                public float mountDistance = 3f;

                [JsonProperty(!ru ? "Distance between bot and enemy" : "Расстояние между ботом и врагом")]
                public float enemyDistance = 3f;

                [JsonProperty(!ru ? "Maximum distance bot will remember target" : "Максимальное расстояние, которое бот помнит цель")]
                public float maxDistanceRemember = 30f;

                [JsonProperty(!ru ? "Spawn personal bot on player connect?" : "Создавать личного бота при подключении игрока?")]
                public bool spawnOnConnect = false;

                [JsonProperty(!ru ? "Block bot spawn in safezones" : "Заблокировать создание бота в безопасных зонах")]
                public bool blockBotSpawnSafezone = false;

                [JsonProperty(!ru ? "Cooldown on PNPC commands" : "Перезарядка на команды PNPC")]
                public float pnpcCommandsCooldown = 0.5f;

                [JsonProperty(!ru ? "Block bot spawn in ZoneManager zones (enter zone id belove)" : "Заблокировать создание бота в зонах ZoneManager (введите id зоны ниже)")]
                public List<string> blockBotZoneManager = new List<string>();

                [JsonProperty(!ru ? "Chat commands to execute on player connect (works only if you have enabled spawn personal bot on connect)" : "Команды чата для выполнения при подключении игрока (работает только если вы включили создание личного бота при подключении игрока)")]
                public List<string> chatCommandsOnConnect = new List<string>();

                [JsonProperty(!ru ? "Chat commands to execute on /pnpc (on personal npc spawn)" : "Команды чата для выполнения при /pnpc (при создании личного NPC)")]
                public List<string> chatCommandsOnSpawn = new List<string>();
            }

            public class GUIOptions 
            {
                [JsonProperty(!ru ? "How many seconds to update the GUI?" : "За сколько секунд обновлять GUI")]
                public float guiRefreshTime = 6f;

                [JsonProperty(!ru ? "Panel layer (Hud, Overlay, Overall, Hud.Menu, Under)" : "Слой панели (Hud, Overlay, Overall, Hud.Menu, Under)")]
                public string panelLayer = "Overlay";

                [JsonProperty(!ru ? "Send commands to local chat? (required for hardcore mode, where global chat is disabled)" : "Отправлять команды в локальный чат? (требуется для hardcore режима, где глобальный чат отключен)")]
                public bool useLocal = false;
            
                [JsonProperty(!ru ? "Panel position adjustment" : "Позиция панели корректировка")]
                public CuiRectTransformComponent panelPosition = new CuiRectTransformComponent();

                [JsonProperty(!ru ? "1 panel color" : "1 цвет панели")]
                public string panelColor1 = "#7f8c8d";

                [JsonProperty(!ru ? "2 panel color" : "2 цвет панели")]
                public string panelColor2 = "#bdc3c7";

                [JsonProperty(!ru ? "Health bar color" : "Цвет полосы здоровья")]
                public string panelHealthColor = "#2ecc71";

                [JsonProperty(!ru ? "Remove UI material" : "Удалить материал UI")]
                public bool removeUIMaterial = false;

                [JsonProperty(!ru ? "Show shortcut buttons when bot is spawned?" : "Отображать кнопки быстрого доступа при создании бота?")]
                public bool showShortcutButtons = false;

                [JsonProperty(!ru ? "Lock shortcut buttons?" : "Заблокировать кнопки быстрого доступа?")]
                public bool lockShortcutButtons = false;

                [JsonProperty(!ru ? "Hide (minimize) GUI on bot spawn?" : "Скрыть (минимизировать) GUI при создании бота?")]
                public bool autoMinimize = false;

                [JsonProperty(!ru ? "Shortcut buttons" : "Кнопки быстрого доступа")]
                public List<AccessButton> accessButtons = new List<AccessButton>();

                public class AccessButton
                {
                    [JsonProperty(!ru ? "Text on button" : "Текст на кнопке")]
                    public string text = "";

                    [JsonProperty(!ru ? "Executable chat commands" : "Выполняемые команды чата")]
                    public string[] commands = new string[] {};

                    public AccessButton(string btnText, string[] btnCommand)
                    {
                        text = btnText;
                        commands = btnCommand;
                    }
                }
            }

            public class BotSetup 
            {
                [JsonProperty(!ru ? "Bot spawn delay" : "Задержка создания бота")]
                public float cooldown = 300f;

                [JsonProperty(!ru ? "The name of the bot to be selected through the command when spawning" : "Имя бота для выбора через команду при создании")]
                public string spawnName = "bot1";

                [JsonProperty(!ru ? "Bot name" : "Имя бота")]
                public string name = "Personal Bot of player %OWNER_NAME%";

                [JsonProperty(!ru ? "Bot appearance (0 - random)" : "Внешний вид бота (0 - случайный)")]
                public ulong skin = 0;

                [JsonProperty(!ru ? "Maximum health" : "Максимальное здоровье")]
                public float maxHealth = 150f;

                [JsonProperty(!ru ? "Bot speed (slowest, slow, normal, fast)" : "Скорость бота (slowest, slow, normal, fast)")]
                public string speed = "normal";

                [JsonProperty(!ru ? "Enable infinite ammo for the bot?" : "Включить бесконечное количество патронов для бота?")]
                public bool infiniteAmmo = true;

                [JsonProperty(!ru ? "Disable item condition loss for weapons?" : "Отключить потерю состояния предметов для оружия?")]
                public bool disableWeaponConditionLoss = false;

                [JsonProperty(!ru ? "Enable display of the bot on the map? (frankenstein icon)" : "Включить отображение бота на карте? (икона франкенштейна)")]
                public bool enableMapView = true;

                [JsonProperty(!ru ? "Drop active item on death?" : "Сбросить активный предмет при смерти?")]
                public bool dropActiveItem = false;

                [JsonProperty(!ru ? "Can player open bot's inventory through '/pnpc inventory' command?" : "Может ли игрок открыть инвентарь бота через команду '/pnpc inventory'?")]
                public bool inventoryCommand = false;

                [JsonProperty(!ru ? "Can other players loot bot's corpse?" : "Может ли другой игрок забрать тело бота?")]
                public bool canLootCorpse = false;

                [JsonProperty(!ru ? "Lock bot's corpse main container?" : "Залочить основной контейнер тела бота?")]
                public bool lockCorpseMainContainer = false;

                [JsonProperty(!ru ? "Lock bot's corpse belt container?" : "Залочить контейнер пояса тела бота?")]
                public bool lockCorpseBeltContainer = false;

                [JsonProperty(!ru ? "Lock bot's corpse wear container?" : "Залочить контейнер одежды тела бота?")]
                public bool lockCorpseWearContainer = false;

                [JsonProperty(!ru ? "Exclude bot's main container from backpack on death?" : "Исключить основной контейнер бота из рюкзака при смерти?")]
                public bool excludeBackpackMainContainer = false;

                [JsonProperty(!ru ? "Exclude bot's belt container from backpack on death?" : "Исключить контейнер пояса тела бота из рюкзака при смерти?")]
                public bool excludeBackpackBeltContainer = false;

                [JsonProperty(!ru ? "Exclude bot's wear container from backpack on death?" : "Исключить контейнер одежды бота из рюкзака при смерти?")]
                public bool excludeBackpackWearContainer = false;

                [JsonProperty(!ru ? "Teleport bot to owner when clicking follow?" : "Телепортировать бота к владельцу при клике по следовать?")]
                public bool teleportFollow = false;

                [JsonProperty(!ru ? "Teleport bot to destination if no path is found?" : "Телепортировать бота к месту назначения, если нет пути?")]
                public bool teleportNoPath = false;

                [JsonProperty(!ru ? "Steam ID for chat icon (leave 0 if not needed)" : "Steam ID для иконки чата (оставьте 0, если не требуется)")]
                public string chatIconSteamID = "";

                [JsonProperty(!ru ? "Start kit" : "Начальный набор")]
                public List<ItemSetup> startKit = new List<ItemSetup>();

                [JsonProperty(!ru ? "Functions setup" : "Настройки функций")]
                public FunctionsSetup functions = new FunctionsSetup();

                [JsonProperty(!ru ? "Gather setup" : "Настройки сбора")]
                public GatherSetup gather = new GatherSetup();

                [JsonProperty(!ru ? "Damage and interactions setup" : "Настройки урона и взаимодействия")]
                public TargetSetup target = new TargetSetup();

                [JsonProperty(!ru ? "Death Marker (marker will be only visible for owner)" : "Маркер смерти (маркер будет виден только для владельца)")]
                public DeathMarkerSetup deathMarker = new DeathMarkerSetup();

                [JsonProperty(!ru ? "Black list of items that cannot be put into the inventory of the bot" : "Черный список предметов, которые не могут быть помещены в инвентарь бота")]
                public string[] itemBlacklist = {"rocket.launcher"};

                [JsonProperty(!ru ? "List of prefabs that the bot will ignore if they attack it" : "Список префабов, которые бот игнорирует, если они атакуют его")]
                public string[] attackIgnore = {"assets/prefabs/deployable/bear trap/beartrap.prefab"};

                public class DeathMarkerSetup 
                {
                    [JsonProperty(!ru ? "Show marker on bot's death position?" : "Показывать маркер на позиции смерти бота?")]
                    public bool enableMarker = false;

                    [JsonProperty(!ru ? "Display name on map" : "Отображать имя на карте")]
                    public string displayName = "Bot's death marker";

                    [JsonProperty(!ru ? "Marker radius" : "Радиус маркера")]
                    public float radius = 0.35f;
                    
                    [JsonProperty(!ru ? "Outline color (hex)" : "Цвет контура (хекс)")]
                    public string outline = "00FFFFFF";

                    [JsonProperty(!ru ? "Main color (hex)" : "Основной цвет (хекс)")]
                    public string main = "00FFFF";

                    [JsonProperty(!ru ? "Alpha" : "Альфа")]
                    public float alpha = 0.5f;

                    [JsonProperty(!ru ? "Duration" : "Длительность")]
                    public int duration = 20;
                }

                public class TargetSetup 
                {
                    [JsonProperty(!ru ? "Bot damage rate" : "Скорость урона бота")]
                    public float botDamageRate = 2f;

                    [JsonProperty(!ru ? "Bot recive damage rate" : "Скорость получения урона ботом")]
                    public float botHurtRate = 0.5f;

                    [JsonProperty(!ru ? "Fire spread rate (bot's accuracy when shooting, the lower is better)" : "Рейт разброса при стрельбе (точность бота при стрельбе, чем меньше тем лучше)")]
                    public float fireSpreadRate = 1f;

                    [JsonProperty(!ru ? "Can players damage the bot?" : "Могут ли игроки наносить урон боту?")]
                    public bool enablePlayerDamage = true;

                    [JsonProperty(!ru ? "Can the bot damage players?" : "Может ли бот наносить урон игрокам?")]
                    public bool enablePlayerHurt = true;

                    [JsonProperty(!ru ? "Can bot damage other personal npc bots?" : "Может ли бот наносить урон другим персональным NPC ботам?")]
                    public bool enablePersonalBotHurt = false;

                    [JsonProperty(!ru ? "Enable no damage to bot's clothes & armor?" : "Включить защиту от урона боту одежды и брони?")]
                    public bool enableProtectedClothesDamage = false;

                    [JsonProperty(!ru ? "Can turrets target and kill a bot? (all turrets will not be able to damage the bot)" : "Могут ли турели атаковать и убить бота? (все турели не смогут нанести урон боту)")]
                    public bool enableTurretTargeting = false;

                    [JsonProperty(!ru ? "Can BradleyAPC target bot?" : "Может ли Брэдли APC атаковать бота?")]
                    public bool enableBradleyTargeting = true;

                    [JsonProperty(!ru ? "Prevent bot owner turrets from aiming and killing the bot? (bot owner's turrets will not be able to damage the bot)" : "Предотвратить, чтобы бот-водитель не мог атаковать и убить бота? (турели бота-водителя не смогут нанести урон боту)")]
                    public bool blockOwnerTurretTargeting = true;

                    [JsonProperty(!ru ? "Cooldown before switching to another target (useful when bot is being attacked from multiple enemies)" : "Коэффициент замедления перед переключением на другой объект (полезно, когда бот атакуется несколькими врагами)")]
                    public float switchTargetCooldown = 3f;

                    [JsonProperty(!ru ? "Disable drowning damage? (will disable for all Frankensteins on the server too)" : "Отключить ущерб от утопления? (отключит для всех Франкенштейнов на сервере также)")]
                    public bool noDrowningDamage = false;

                    [JsonProperty(!ru ? "Disable damage to other players buildings?" : "Отключить ущерб к другим игрокам зданиям?")]
                    public bool disableDamagePlayerBuildings = false;

                    [JsonProperty(!ru ? "Disable damage to owner buildings?" : "Отключить ущерб к зданиям владельца?")]
                    public bool disableDamageOwnerBuildings = false;

                    [JsonProperty(!ru ? "Target visibility settings" : "Настройки видимости объекта цели")]
                    public VisibilitySetup visibilitySetup = new VisibilitySetup();

                    [JsonProperty(!ru ? "Attack aim offset" : "Смещение цели для атаки")]
                    public Vector3 aimOffset = new Vector3(0, -0.5f, -0.3f);

                    [JsonProperty(!ru ? "Aim offset when player is wounded" : "Смещение цели при ранении игрока")]
                    public Vector3 aimWoundedOffset = new Vector3(0, 1f);

                    [JsonProperty(!ru ? "When attacked ignore all targets except players & NPCs?" : "Когда атакован игрок, игнорировать все цели except игроков и NPC?")]
                    public bool targetOnlyBasePlayers = false;

                    [JsonProperty(!ru ? "Blacklist of objects that the bot will ignore when owner selecting a target (short prefab name)" : "Черный список объектов, которые бот игнорирует при выборе владельцем цели (короткое префабное имя)")]
                    public string[] inputBlacklist = new string[] {};

                    [JsonProperty(!ru ? "BossMonster names to prevent targeting them (if you've BossMonster plugin)" : "Имена BossMonster, которые предотвращают их цель (если у вас плагин BossMonster)")]
                    public string[] bossesNames = new string[] {};

                    public class VisibilitySetup 
                    {
                        [JsonProperty(!ru ? "Visibility distance" : "Дистанция видимости")]
                        public float distance = Mathf.Infinity;

                        [JsonProperty(!ru ? "Bot center point offset" : "Смещение центра бота")]
                        public Vector3 botCenterOffset = new Vector3(0, 0, 0);

                        [JsonProperty(!ru ? "Target center point offset" : "Смещение центра цели")]
                        public Vector3 targetCenterOffset = new Vector3(0, 0, 0);

                        [JsonProperty(!ru ? "Obstacle layers" : "Слои препятствий")]
                        public string[] obstacleLayers = new string[] {
                            "Default", "Deployed", "Construction", "World", "Tree", "Terrain", "Clutter", "Debris", "Tree"
                        };
                    }
                }

                public class GatherSetup
                {
                    [JsonProperty(!ru ? "Shortname of items that can harvest trees" : "Короткое имя предметов, которые можно собирать с деревьев")]
                    public List<string> toolForTrees = new List<string>();

                    [JsonProperty(!ru ? "Shortname of items that can mine stones and ore" : "Короткое имя предметов, которые можно добывать камни и руду")]
                    public List<string> toolForStones = new List<string>();

                    [JsonProperty(!ru ? "Setting up mining rates" : "Настройка скорости добычи")]
                    public Dictionary<string, float> gatherRates = new Dictionary<string, float>();

                    [JsonProperty(!ru ? "Radius to collect/gather resources in auto-mode" : "Радиус сбора ресурсов в автомоде")]
                    public float autoModeRadius = 50f;

                    [JsonProperty(!ru ? "Chainsaw fuel consumption rate" : "Скорость расхода топлива бензопилы")]
                    public float chainsawFuelConsRate = 1f;

                    [JsonProperty(!ru ? "Gather resources to owner's inventory?" : "Собирать ресурсы в инвентарь владельца?")]
                    public bool gatherResourcesToOwner = false;
                }

                public class FunctionsSetup 
                {
                    [JsonProperty(!ru ? "Can a bot loot crates?" : "Может ли бот открывать ящики?")]
                    public bool canLootBoxes = true;

                    [JsonProperty(!ru ? "Can the bot mine trees and stones?" : "Может ли бот добывать деревья и камни?")]
                    public bool canGatherResources = true;

                    [JsonProperty(!ru ? "Can the bot pick up resources? (wood, sulfur and metal ore, stones)" : "Может ли бот собирать ресурсы? (дерево, серу и металлическую руду, камни)")]
                    public bool canCollectResources = true;

                    [JsonProperty(!ru ? "Should the bot protect the owner?" : "Должен ли бот защищать владельца?")]
                    public bool canProtectOwner = true;

                    [JsonProperty(!ru ? "Should the bot defend itself?" : "Должен ли бот защищать себя?")]
                    public bool canProtectSelf = true;

                    [JsonProperty(!ru ? "Can the bot travel by car/copter and other vehicles?" : "Может ли бот ездить на машине/вертолете и других транспортных средствах?")]
                    public bool canMount = true;

                    [JsonProperty(!ru ? "Can the bot pick up dropped items?" : "Может ли бот собирать упавшие предметы?")]
                    public bool canCollectDroppedItems = true;

                    [JsonProperty(!ru ? "Recover the owner from a wounded state" : "Восстановить владельца из раненого состояния")]
                    public RecoverSetup recoverSetup = new RecoverSetup();

                    [JsonProperty(!ru ? "Target Setup for Combat mode (/pnpc combat)" : "Настройки цели для режима боя (/pnpc combat)")]
                    public CombatSetup combatSetup = new ();

                    [JsonProperty(!ru ? "PVP Mode (/pnpc pvp)" : "Режим PvP (/pnpc pvp)")]
                    public PVPSetup pvpSetup = new PVPSetup();

                    [JsonProperty(!ru ? "Loot All (/pnpc loot-all)" : "Лут всех (/pnpc loot-all)")]
                    public LootAllSetup lootAllSetup = new LootAllSetup();

                    [JsonProperty(!ru ? "Self Heal" : "Самоисцеление")]
                    public SelfHealSetup selfHeal = new SelfHealSetup();

                    [JsonProperty(!ru ? "Can the bot attack other people's buildings?" : "Может ли бот атаковать здания других людей?")]
                    public bool canAttackEnemyBuildings = true;

                    [JsonProperty(!ru ? "Can a bot attack its owner's buildings?" : "Может ли бот атаковать здания владельца?")]
                    public bool canAttackOwnerBuildings = false;

                    [JsonProperty(!ru ? "Can the bot collect resources within a radius of 50 meters? (/pnpc auto-pickup)" : "Может ли бот собирать ресурсы в радиусе 50 метров? (/pnpc auto-pickup)")]
                    public bool canAutoPickup = true;

                    [JsonProperty(!ru ? "Can the bot farm resources within a radius of 50 meters? (/pnpc auto-farm)" : "Может ли бот собирать ресурсы в радиусе 50 метров? (/pnpc auto-farm)")]
                    public bool canAutoFarm = true;

                    [JsonProperty(!ru ? "Enable bot's inventory?" : "Включить инвентарь бота?")]
                    public bool enableBotInventory = true;

                    [JsonProperty(!ru ? "Lock bot's wear slots?" : "Заблокировать слоты одежды бота?")]
                    public bool blockWearSlots = false;

                    [JsonProperty(!ru ? "Lock bot's main slots?" : "Заблокировать основные слоты бота?")]
                    public bool blockMainSlots = false;

                    [JsonProperty(!ru ? "Lock bot's equipment slots?" : "Заблокировать слоты оборудования бота?")]
                    public bool blockEquipmentSlots = false;

                    [JsonProperty(!ru ? "Can the bot fly on helicopters? (PNPC Heli AI Addon plugin)" : "Может ли бот управлять вертолетом? (PNPC Heli AI Addon плагин)")]
                    public bool enableHeliAddon = false;

                    [JsonProperty(!ru ? "Can the bot build bases? (PNPC Builder AI Addon plugin)" : "Может ли бот строить базы? (PNPC Builder AI Addon плагин)")]
                    public bool enableBuilderAddon = false;

                    [JsonProperty(!ru ? "Can the bot go hunting animals? (PNPC Hunter AI Addon plugin)" : "Может ли бот пойти на охоту за животными? (PNPC Hunter AI Addon плагин)")]
                    public bool enableHunterAddon = false;

                    [JsonProperty(!ru ? "Can the bot drive cars? (PNPC Addon Car AI plugin)" : "Может ли бот управлять машиной? (PNPC Addon Car AI плагин)")]
                    public bool enableCarAddon = false;
                    
                    [JsonProperty(!ru ? "Can the bot drive boats? (PNPC Addon Boat AI plugin)" : "Может ли бот управлять лодкой? (PNPC Addon Boat AI плагин)")]
                    public bool enableBoatAddon = false;

                    [JsonProperty(!ru ? "Can bot collect DeployableNature entities manually?" : "Может ли бот подбирать DeployableNature сущности вручную?")]
                    public bool canCollectDeployableNatureManually = true;

                    [JsonProperty(!ru ? "Can bot gather DeployableNature entities manually?" : "Может ли бот собирать DeployableNature сущности вручную?")]
                    public bool canGatherDeployableNatureManually = true;

                    [JsonProperty(!ru ? "Can bot collect DeployableNature entities in auto-pickup mode?" : "Может ли бот подбирать DeployableNature сущности в режиме auto-pickup?")]
                    public bool canCollectDeployableNatureAutoPickup = true;
                    
                    [JsonProperty(!ru ? "Can bot gather DeployableNature entities in auto-farm mode?" : "Может ли бот собирать DeployableNature сущности в режиме auto-farm?")]
                    public bool canGatherDeployableNatureAutoFarm = true;

                    public class SelfHealSetup 
                    {
                        [JsonProperty(!ru ? "Should bot heal himself?" : "Должен ли бот исцелить себя?")]
                        public bool enableHealing = false;

                        [JsonProperty(!ru ? "Bot will heal himself when his health is below this value" : "Бот будет исцелить себя, когда его здоровье будет ниже этого значения")]
                        public float belowValue = 20f;

                        [JsonProperty(!ru ? "Items to heal (you can set list by priority)" : "Товары для исцеления (вы можете задать список по приоритету)")]
                        public List<string> healItems = new List<string>();
                    }

                    public class LootAllSetup 
                    {
                        [JsonProperty(!ru ? "Enable Loot All command (/pnpc loot-all)" : "Включить команду Loot All (/pnpc loot-all)")]
                        public bool enableLootAll = false;

                        [JsonProperty(!ru ? "Resources detect radius" : "Радиус обнаружения ресурсов")]
                        public float radius = 15f;

                        [JsonProperty(!ru ? "Loot containers?" : "Исследовать контейнеры?")]
                        public bool lootContainers = true;

                        [JsonProperty(!ru ? "Loot corpses?" : "Исследовать трупы?")]
                        public bool lootCorpses = true;

                        [JsonProperty(!ru ? "Loot dropped items?" : "Исследовать сброшенные предметы?")]
                        public bool lootDroppedItems = true;
                    }

                    public class PVPSetup 
                    {
                        [JsonProperty(!ru ? "Enable PVP mode (attack all bots and players in radius, /pnpc pvp)" : "Включить режим PVP (атаковать всех ботов и игроков в радиусе, /pnpc pvp)")]
                        public bool enablePVP = false;

                        [JsonProperty(!ru ? "Detect radius" : "Радиус обнаружения")]
                        public float radius = 10f;

                        [JsonProperty(!ru ? "Ignore bots?" : "Игнорировать ботов?")]
                        public bool ignoreBots = false;

                        [JsonProperty(!ru ? "Ignore personal npc bots?" : "Игнорировать личных npc ботов?")]
                        public bool ignorePersonalNPC = true;

                        [JsonProperty(!ru ? "Ignore players?" : "Игнорировать игроков?")]
                        public bool ignorePlayers = true;

                        [JsonProperty(!ru ? "Ignore by short prefab name" : "Игнорировать по короткому префабу имени")]
                        public List<string> ignorePrefabs = new List<string>();
                    }

                    public class RecoverSetup
                    {
                        [JsonProperty(!ru ? "Can the bot recover the owner if he is in a wounded state?" : "Может ли бот восстановить владельца, если он находится в раненом состоянии?")]
                        public bool canRecover = true;

                        [JsonProperty(!ru ? "Recover time" : "Время восстановления")]
                        public float _recoverTime = 6f;

                        [JsonProperty(!ru ? "Can spawn personal bot while owner downed?" : "Может ли бот спавнить личный бот, пока владелец находится в обездвиженном состоянии?")]
                        public bool blockBotSpawnWhileDowned = false;
                    }
                    public class CombatSetup
                    {
                        [JsonProperty(!ru ? "Can bot attack NPC in combat mode?" : "Может ли бот атаковать NPC в режиме боя?")]
                        public bool CanAttackedNpc = true;
                        [JsonProperty(!ru ? "Can bot attack players in combat mode?" : "Может ли бот атаковать игроков в режиме боя?")]
                        public bool CanAttackedUsers = true;
                        [JsonProperty(!ru ? "Whitelist of entity prefabs that's allowed to attack in combat mode" : "Белый список префабов сущностей, разрешенных к атаке в режиме боя")]
                        public List<string> WiteListTarget = new ();
                        [JsonProperty(!ru ? "Blacklist of entity prefabs that's not allowed to attack in combat mode" : "Черный список префабов сущностей, не разрешенных к атаке в режиме боя")]
                        public List<string> BlackListTarget = new ();
                        public bool HasBlackList() => BlackListTarget != null || BlackListTarget.Count > 0;
                        public bool HasWiteList() => WiteListTarget != null || WiteListTarget.Count > 0;
                        public bool HasEntityFromList(string prefab, bool black)
                        {
                            if(black) return CheckList(prefab, BlackListTarget);
                            else return CheckList(prefab, WiteListTarget);
                        }
                        private bool CheckList(string prefab, List<string> list)
                        {
                            foreach(var name in list) if(prefab.Contains(name)) return true;
                            return false;
                        }
                    }
                }

                public class ItemSetup 
                {
                    [JsonProperty(!ru ? "Item name" : "Имя предмета")]
                    public string name = "";

                    [JsonProperty(!ru ? "Item shortname" : "Короткое имя предмета")]
                    public string shortname = "";

                    [JsonProperty(!ru ? "Item skin" : "Скин предмета")]
                    public ulong skin = 0;

                    [JsonProperty(!ru ? "Item amount" : "Количество предмета")]
                    public int amount = 1;

                    [JsonProperty(!ru ? "In which container to place? (belt, main, wear)" : "В каком контейнере поместить? (belt, main, wear)")]
                    public string container = "main";
                }
            }
        }

        protected override void LoadDefaultConfig() 
        {
            _config = new Configuration();

            _config.allowedLootPrefabs.Add("vehicle_parts");

            _config.permissionBot.Add("personalnpc.bot1", new Configuration.BotSetup
            {
                name = "Personal bot of player %OWNER_NAME%",
                startKit = new List<Configuration.BotSetup.ItemSetup>
                {
                    new Configuration.BotSetup.ItemSetup
                    {
                        shortname = "shoes.boots",
                        container = "wear"
                    },
                    new Configuration.BotSetup.ItemSetup
                    {
                        shortname = "pants",
                        container = "wear"
                    },
                    new Configuration.BotSetup.ItemSetup
                    {
                        shortname = "hoodie",
                        container = "wear"
                    },
                    new Configuration.BotSetup.ItemSetup
                    {
                        shortname = "mask.bandana",
                        container = "wear"
                    },
                    new Configuration.BotSetup.ItemSetup
                    {
                        shortname = "hat.boonie",
                        container = "wear"
                    },
                    new Configuration.BotSetup.ItemSetup
                    {
                        shortname = "sunglasses",
                        container = "wear"
                    }
                },
                gather = new Configuration.BotSetup.GatherSetup
                {
                    toolForTrees = new List<string>
                    {
                        "hatchet", "chainsaw", "hammer.salvaged", "stonehatchet", "axe.salvaged"
                    },

                    toolForStones = new List<string>
                    {
                        "pickaxe", "stone.pickaxe", "hammer.salvaged", "jackhammer", "icepick.salvaged"
                    },

                    gatherRates = new Dictionary<string, float>
                    {
                        ["stones"] = 2f,
                        ["wood"] = 5f
                    }
                },
                target = new Configuration.BotSetup.TargetSetup
                {
                    inputBlacklist = new string[] 
                    {
                        "barricade.sandbags"
                    }
                },
                functions = new Configuration.BotSetup.FunctionsSetup
                {
                    selfHeal = new Configuration.BotSetup.FunctionsSetup.SelfHealSetup
                    {
                        healItems = new List<string>
                        {
                            "largemedkit",
                            "syringe.medical",
                            "bandage",
                        }
                    }
                }
            });
        
            _config.installItem.Add(new Configuration.ItemInfo 
            {
                name = "PersonalNPC",
                shortname = "furnace",
                skin = 2741314889,
                bot = new Configuration.BotSetup
                {
                    name = "Personal bot of player %OWNER_NAME%",
                    startKit = new List<Configuration.BotSetup.ItemSetup>
                    {
                        new Configuration.BotSetup.ItemSetup
                        {
                            shortname = "shoes.boots",
                            container = "wear"
                        },
                        new Configuration.BotSetup.ItemSetup
                        {
                            shortname = "pants",
                            container = "wear"
                        },
                        new Configuration.BotSetup.ItemSetup
                        {
                            shortname = "hoodie",
                            container = "wear"
                        },
                        new Configuration.BotSetup.ItemSetup
                        {
                            shortname = "mask.bandana",
                            container = "wear"
                        },
                        new Configuration.BotSetup.ItemSetup
                        {
                            shortname = "hat.boonie",
                            container = "wear"
                        },
                        new Configuration.BotSetup.ItemSetup
                        {
                            shortname = "sunglasses",
                            container = "wear"
                        }
                    },
                    gather = new Configuration.BotSetup.GatherSetup
                    {
                        toolForTrees = new List<string>
                        {
                            "hatchet", "chainsaw", "hammer.salvaged", "stonehatchet", "axe.salvaged"
                        },

                        toolForStones = new List<string>
                        {
                            "pickaxe", "stone.pickaxe", "hammer.salvaged", "jackhammer", "icepick.salvaged"
                        },

                        gatherRates = new Dictionary<string, float>
                        {
                            ["stones"] = 2f,
                            ["wood"] = 5f
                        }
                    },
                    target = new Configuration.BotSetup.TargetSetup
                    {
                        inputBlacklist = new string[] 
                        {
                            "barricade.sandbags"
                        }
                    }
                }
            });

            _config.gui.panelPosition = new CuiRectTransformComponent
            {
                AnchorMin = "1 1", AnchorMax = "1 1",
                OffsetMin = "-170 -104", OffsetMax = "-10 -10"
            };

            _config.gui.accessButtons.Add(new Configuration.GUIOptions.AccessButton("Auto-Farm: Wood", new string[] {"pnpc auto-farm wood", "pnpc auto-farm enable"}));
            _config.gui.accessButtons.Add(new Configuration.GUIOptions.AccessButton("Auto-Farm: Stone", new string[] {"pnpc auto-farm stone", "pnpc auto-farm enable"}));

            _config.gui.accessButtons.Add(new Configuration.GUIOptions.AccessButton("Auto-Pickup: Wood", new string[] {"pnpc auto-pickup wood", "pnpc auto-pickup enable"}));
            _config.gui.accessButtons.Add(new Configuration.GUIOptions.AccessButton("Auto-Pickup: Stone", new string[] {"pnpc auto-pickup stone", "pnpc auto-pickup enable"}));
        }

        protected override void LoadConfig()
        {
            base.LoadConfig();

            try
            {
                _config = Config.ReadObject<Configuration>();
                if (_config == null) throw new Exception();

                SaveConfig();
            }
            catch (Exception ex)
            {
                PrintError("{0}", ex);
                LoadDefaultConfig();
            }
        }

        protected override void SaveConfig() => Config.WriteObject(_config);

        #endregion

        #region Loc

        protected override void LoadDefaultMessages()
        {
            lang.RegisterMessages(new Dictionary<string, string>
            {
                ["ChatCommand_Success_Despawn"] = "Ваш персональный бот успешно задеспавнен!",
                ["ChatCommand_Success_Spawn"] = "Ваш персональный бот успешно заспавнен!",

                ["ChatCommand_Notice_Ignore_Activated"] = "Бот теперь игнорирует тех, кто атакует его и хозяина",
                ["ChatCommand_Notice_Ignore_Deactivated"] = "Бот теперь не игнорирует тех, кто атакует его и хозяина",

                ["ChatCommand_Notice_Combat_Activated"] = "Бот теперь атакует тех, кого атакует хозяин",
                ["ChatCommand_Notice_Combat_Deactivated"] = "Бот теперь не атакует тех, кого атакует хозяин",

                ["ChatCommand_Notice_PVP_Activated"] = "Бот теперь атакует всех ботов и игроков которых нет в команде хозяин",
                ["ChatCommand_Notice_PVP_Deactivated"] = "Бот больше не атакует всех ботов и игроков которых нет в команде хозяина",

                ["ChatCommand_Notice_Cooldown"] = "Вам нужно подождать {0} секунд, прежде чем повторно заспавнить бота!",
                ["ChatCommand_Notice_Location"] = "Ваш бот находится в квадрате: {0}, расстояние до бота: {1}",
                ["ChatCommand_Notice_Health"] = "Здоровье вашего бота: {0}/{1}",
                ["ChatCommand_Notice_Name_Changed"] = "Имя бота над головой: {0}",
                ["ChatCommand_Notice_Name_Reset"] = "Имя сброшено на значение из конфига.",
                ["ChatCommand_Error_Name_Usage"] = "Использование: /pnpc name <имя>  или  /pnpc name reset  (поддерживается %OWNER_NAME%)",
                ["ChatCommand_Error_Name_Invalid"] = "Недопустимое имя.",
                ["ChatCommand_Notice_Follow"] = "Бот теперь следует за вами!",
                ["ChatCommand_Notice_AvailableBots"] = "<size=16>Доступные боты:</size>\n{BOTS}\n\nВведите /pnpc [короткое название бота], чтобы заспавнить!",

                ["ChatCommand_Error_AutoPickup"] = "<size=16>Авто-подбор ресурсов</size>\n\nБот начнет собирать все ресурсы в радиусе 50 метров от его первоначальной точки.\n\nДоступные режимы: all, wood, stone, metal, sulfur, hemp, berries, pumpkin, potato, mushroom, corn\nОтключить - /pnpc auto-pickup disable",
                ["ChatCommand_Error_AutoFarm"] = "<size=16>Авто-фарм ресурсов</size>\n\nБот начнет фармить все ресурсы в радиусе 50 метров от его первоначальной точки.\n\nДоступные режимы: all, wood, stone, metal, sulfur\nОтключить - /pnpc auto-farm disable",
                ["ChatCommand_Error_NoPermission"] = "У вас нет разрешения на спавн персонального бота",
                ["ChatCommand_Error_CannotUse"] = "Ваш бот не обладает такой функцией, вы не можете ее использовать!",
                ["ChatCommand_Error_NoBot"] = "У вас нет персонального бота!",
                ["ChatCommand_Error_NotFounded"] = "Бот не найден!",
                ["ChatCommand_Error_Blacklist"] = "Этот предмет добавлен в черный список, вы не можете дать его боту!",
                ["ChatCommand_Error_Contents_Blacklist"] = "У предмета есть содержимое, которое добавлено в черный список. Вы не можете дать этот предмет боту!",
                ["ChatCommand_Error_NoSpawnHere"] = "Вы не можете заспавнить персонального бота здесь!",

                ["ChatCommand_Notice_AutoPickup_Status"] = "Авто-подбор ресурсов: {0}\nРесурсы для сбора: {1}",
                ["ChatCommand_Notice_AutoFarm_Status"] = "Авто-фарм ресурсов: {0}\nРесурсы для фарма: {1}",

                ["ChatCommand_Tugboat_Drive"] = "Введите /pnpc tugboat если вы хотите чтобы ваш персональный бот управлял буксиром за вас!",
                ["ChatCommand_Tugboat_NoAuth"] = "У вас нет авторизации в этом буксире!",
                ["ChatCommand_Tugboat_TooFar"] = "Бот слишком далеко от буксира чтобы сесть!",

                ["ChatCommand_AutoMode_Resources_All"] = "все",
                ["ChatCommand_AutoMode_Resources_Wood"] = "дерево",
                ["ChatCommand_AutoMode_Resources_Stone"] = "камень",
                ["ChatCommand_AutoMode_Resources_Sulfur"] = "сера",
                ["ChatCommand_AutoMode_Resources_Metal"] = "металл",
                ["ChatCommand_AutoMode_Resources_Hemp"] = "ткань",
                ["ChatCommand_AutoMode_Resources_Berries"] = "ягоды",
                ["ChatCommand_AutoMode_Resources_Corn"] = "кукуруза",
                ["ChatCommand_AutoMode_Resources_Mushroom"] = "гриб",
                ["ChatCommand_AutoMode_Resources_Pumpkin"] = "тыква",
                ["ChatCommand_AutoMode_Resources_Barrels"] = "бочки",

                ["ChatCommand_AutoMode_Status_Disabled"] = "отключён",
                ["ChatCommand_AutoMode_Status_Enabled"] = "включён",

                ["Chat_Commands_TooFast"] = "Вы вводите команды слишком быстро, подождите немного!",

                ["Bot_Notice_Recover"] = "Поднял вас, возвращаюсь к заданию!",
                ["Bot_Notice_MissionCompleted"] = "Цель выполнена, возвращаюсь к вам!",
                ["Bot_Notice_GoingCollect"] = "Иду собирать ресурс!",
                ["Bot_Notice_GoingFarm"] = "Иду добывать ресурс!",
                ["Bot_Notice_GoingLootBox"] = "Иду лутать ящик!",
                ["Bot_Notice_Following"] = "Следую за вами!",
                ["Bot_Notice_Staying"] = "Стою на позиции.",
                ["Bot_Notice_StartedAttack"] = "Начинаю атаку!",
                ["Bot_Notice_GoingCollectItem"] = "Иду подбирать предмет!",
                ["Bot_Notice_GoingPosition"] = "Иду на позицию.",
                ["Bot_Notice_GoingLootCorpse"] = "Иду лутать труп!",
                ["Bot_Notice_HitByOwner"] = "Вы атакуете меня!",

                ["Bot_Error_NoTool"] = "Нечем добывать ресурс!",
                ["Bot_Error_NoWeapon"] = "Нет оружия чтобы атаковать!",
                ["Bot_Error_PickupBrokenItem"] = "Нельзя подбирать сломанные вещи!",
                ["Bot_Error_NoAmmo"] = "Нет патрон у оружия чтобы атаковать!",
                ["Bot_Error_NoResourcesAround"] = "Нет ресурсов поблизости!",
                ["Bot_Error_Chainsaw_NoFuel"] = "Нет топлива в бензопиле!",
                ["Bot_Error_AutoFarm_NoResourcesAroundOrNoTool"] = "Нет ресурсов поблизости либо нет инструмента чтобы добыть ресурс!",
                ["Bot_Error_Dead_NotOwner"] = "Вы не являетесь владельцом этого бота и не можете его залутать!",
                ["Bot_Error_Loot_HackableCrate"] = "Ящик еще не взломан!",
                ["Bot_Error_FlyAddon_NoPlayerToFollow"] = "Игрок для слежки не найден!",

                ["GUI_Header"] = "Управление NPC",
                ["GUI_Follow"] = "Следовать",
                ["GUI_Kill"] = "Убить",
            }, this, "ru");

            lang.RegisterMessages(new Dictionary<string, string>
            {
                ["ChatCommand_Success_Despawn"] = "Your personal bot has been successfully deleted!",
                ["ChatCommand_Success_Spawn"] = "Your personal bot has been successfully spawned!",

                ["ChatCommand_Notice_Ignore_Activated"] = "The bot now ignores those who attack it and the owner",
                ["ChatCommand_Notice_Ignore_Deactivated"] = "The bot no longer ignores those who attack it and the owner",

                ["ChatCommand_Notice_Combat_Activated"] = "Bot now attacks those who are attacked by the owner",
                ["ChatCommand_Notice_Combat_Deactivated"] = "The bot no longer attacks those who are attacked by the owner",

                ["ChatCommand_Notice_PVP_Activated"] = "Bot now attacks all bots and players that aren't in owner's team",
                ["ChatCommand_Notice_PVP_Deactivated"] = "Bot no longer attacks all bots and players that aren't in owner's team",

                ["ChatCommand_Notice_Cooldown"] = "You need to wait {0} seconds before re-spawning the bot!",
                ["ChatCommand_Notice_Location"] = "Your bot is in the grid: {0}, distance to the bot: {1}",
                ["ChatCommand_Notice_Health"] = "Your bot health: {0} / {1}",
                ["ChatCommand_Notice_Name_Changed"] = "Bot overhead name set to: {0}",
                ["ChatCommand_Notice_Name_Reset"] = "Bot name reset to the default from config.",
                ["ChatCommand_Error_Name_Usage"] = "Usage: /pnpc name <name>  or  /pnpc name reset  (%OWNER_NAME% is supported)",
                ["ChatCommand_Error_Name_Invalid"] = "Invalid name.",
                ["ChatCommand_Notice_Follow"] = "The bot is now following you!",
                ["ChatCommand_Notice_AvailableBots"] = "<size=16>Available bots:</size>\n{BOTS}\n\nEnter /pnpc [short bot name] to spawn!",

                ["ChatCommand_Error_AutoPickup"] = "<size=16>Auto-collecting resources</size>\n\nThe bot will start collecting all resources within a radius of 50 meters from its original point.\n\nAvailable modes: all, wood, stone, metal, sulfur, hemp, berries, potato, pumpkin, mushroom, corn\nDisable - /pnpc auto-pickup disable",
                ["ChatCommand_Error_AutoFarm"] = "<size=16>Auto-farm resources</size>\n\nThe bot will start farming all resources within a radius of 50 meters from its original point.\n\nAvailable modes: all, wood, stone, metal, sulfur\nDisable - /pnpc auto-farm disable",
                ["ChatCommand_Error_NoPermission"] = "You don't have permission to spawn a personal bot",
                ["ChatCommand_Error_CannotUse"] = "Your bot doesn't have this feature, you can't use it!",
                ["ChatCommand_Error_NoBot"] = "You don't have a personal bot!",
                ["ChatCommand_Error_NotFounded"] = "Bot not found!",
                ["ChatCommand_Error_Blacklist"] = "This item has been blacklisted, you cannot give it to the bot!",
                ["ChatCommand_Error_Contents_Blacklist"] = "This item has contents that has been blacklisted. You cannot give this item to a bot!",
                ["ChatCommand_Error_NoSpawnHere"] = "You can't spawn a personal bot here!",

                ["ChatCommand_Notice_AutoPickup_Status"] = "Auto-collect resources: {0}\nResources to collect: {1}",
                ["ChatCommand_Notice_AutoFarm_Status"] = "Auto-farm resources: {0}\nResources to farm: {1}",

                ["ChatCommand_Tugboat_NoAuth"] = "You aren't authenticated in this tugboat!",
                ["ChatCommand_Tugboat_TooFar"] = "Bot is too far from tugboat to mount!",
                ["ChatCommand_Tugboat_Drive"] = "Enter /pnpc tugboat if you want your PNPC to drive the tugboat for you!",

                ["ChatCommand_AutoMode_Resources_All"] = "all",
                ["ChatCommand_AutoMode_Resources_Wood"] = "wood",
                ["ChatCommand_AutoMode_Resources_Stone"] = "stone",
                ["ChatCommand_AutoMode_Resources_Sulfur"] = "sulfur",
                ["ChatCommand_AutoMode_Resources_Metal"] = "metal",
                ["ChatCommand_AutoMode_Resources_Hemp"] = "hemp",
                ["ChatCommand_AutoMode_Resources_Berries"] = "berries",
                ["ChatCommand_AutoMode_Resources_Corn"] = "corn",
                ["ChatCommand_AutoMode_Resources_Mushroom"] = "mushroom",
                ["ChatCommand_AutoMode_Resources_Pumpkin"] = "pumpkin",
                ["ChatCommand_AutoMode_Resources_Barrels"] = "barrels",

                ["ChatCommand_AutoMode_Status_Disabled"] = "disabled",
                ["ChatCommand_AutoMode_Status_Enabled"] = "enabled",

                ["Chat_Commands_TooFast"] = "You're typing commands so fast, please wait a little!",

                ["Bot_Notice_Recover"] = "Recovered you, backing to mission!",
                ["Bot_Notice_MissionCompleted"] = "Mission сompleted, backing to you!",
                ["Bot_Notice_GoingCollect"] = "Going to collect resource!",
                ["Bot_Notice_GoingFarm"] = "Going to farm resource!",
                ["Bot_Notice_GoingLootBox"] = "Going to loot box!",
                ["Bot_Notice_Following"] = "Following you!",
                ["Bot_Notice_Staying"] = "Standing in position",
                ["Bot_Notice_StartedAttack"] = "Starting attack!",
                ["Bot_Notice_GoingCollectItem"] = "Going to pick up the item!",
                ["Bot_Notice_GoingPosition"] = "Going to the position.",
                ["Bot_Notice_GoingLootCorpse"] = "Going to loot corpse!",
                ["Bot_Notice_HitByOwner"] = "You're attacking me!",

                ["Bot_Error_NoTool"] = "There are no tools to mine the resource!",
                ["Bot_Error_NoWeapon"] = "There are no weapons to attack!",
                ["Bot_Error_PickupBrokenItem"] = "You cannot pickup broken items!",
                ["Bot_Error_NoAmmo"] = "There is no ammo for the weapon to attack!",
                ["Bot_Error_NoResourcesAround"] = "No resources nearby!",
                ["Bot_Error_AutoFarm_NoResourcesAroundOrNoTool"] = "No resources nearby or bot doesn't have any tools to farm resources!",
                ["Bot_Error_Chainsaw_NoFuel"] = "No fuel in chainsaw!",
                ["Bot_Error_Dead_NotOwner"] = "You are not the owner of this bot and you can not loot it!",
                ["Bot_Error_Loot_HackableCrate"] = "Crate is not hacked yet!",
                ["Bot_Error_FlyAddon_NoPlayerToFollow"] = "Player for follow is not found!",

                ["GUI_Header"] = "NPC Control",
                ["GUI_Follow"] = "Follow",
                ["GUI_Kill"] = "Kill",
            }, this, "en");
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
        private void OnEntityMounted(BaseMountable entity, BasePlayer player)
        {
            if(player == null || entity == null) return;
            if(player.IsNpc) return;

            var controller = GetController(player.net.ID.Value);
            if(controller == null) return;
            
            if(entity.HasParent())
            {
                if(entity.GetParentEntity() is Tugboat)
                {
                    if(controller.botSetup.functions.canMount && controller.botSetup.functions.enableBoatAddon)
                    {
                        SendMsg(player, "ChatCommand_Tugboat_Drive");
                    }
                }
            }
        }
        
        private object CanUseGesture(BasePlayer player, GestureConfig gesture)
        {
            if(player == null || gesture == null) return null;

            if(gesture.gestureName.english == "Point")
            {
                if (player.net == null) return null;
                
                var controller = GetController(player.net.ID.Value);
                if (controller == null) return null;
                
                controller.OnPlayerInput(player, null);
            }
            
            return null;
        }

        private object CanBradleyApcTarget(BradleyAPC apc, BaseEntity entity)
        {
            if(entity == null || apc == null) return null;

            if(entity is FrankensteinPet)
            {
                var comp = GetOwnerComponent(entity.net.ID.Value);
                if(comp != null)
                {
                    if(comp.controller != null)
                    {
                        if(!comp.controller.botSetup.target.enableBradleyTargeting) return false;
                    }
                }
            }

            return null;
        }

        private void OnLoseCondition(Item item, float amount)
        {
            if(item?.info?.category == ItemCategory.Attire && item?.hasCondition == true && item?.GetOwnerPlayer() is NPCPlayer npc &&
                npc.TryGetComponent<BotOwnerComponent>(out var component) && component.controller.botSetup.target.enableProtectedClothesDamage)
            {
                float currentCondition = item.condition;
                NextTick(() => item.condition = currentCondition);
            }
        }
        
        private void Init()
        {
            if(_config.clearConsoleOfSpam)
            {
                UnityEngine.Application.logMessageReceived += HandleLog;
                UnityEngine.Application.logMessageReceived -= Facepunch.Output.LogHandler;
            }
        }

        private object CanUseLockedEntity(BasePlayer player, BaseLock baseLock)
        {
            if(player == null || baseLock == null) return null;
            if(!baseLock.HasParent()) return null;

            var parent = baseLock.GetParentEntity();
            if(parent is BaseVehicle && GetOwnerComponent(player.net.ID.Value) != null) return true;

            return null;
        }

        private object OnEntityTakeDamage(BaseCombatEntity entity, HitInfo info)
        {
            if(entity == null || info == null || info?.Initiator == null || entity?.net == null) return null;

            BaseEntity target = info.Initiator; 
            if(target == null || target?.net == null) return null;

            var ownerComponent = GetOwnerComponent(entity.net.ID.Value);

            if(ownerComponent != null)
            {
                if(ownerComponent.controller != null)
                {
                    if(target is ModularCar modularCar && modularCar.GetSpeed() < 0.5f) return true;
                    else ownerComponent.controller.OnDamage();
                }
            }

            var initiatorController = GetController(target.net.ID.Value);

            if(initiatorController != null) 
            {
                initiatorController.OnOwnerAttack(entity);

                if(ownerComponent != null)
                {
                    if(ownerComponent.controller != null) ownerComponent.controller.ShowText(lang.GetMessage("Bot_Notice_HitByOwner", this, info.InitiatorPlayer.UserIDString));
                }

                return null;
            }

            var initiatorBotOwner = GetOwnerComponent(target.net.ID.Value);

            if(initiatorBotOwner != null && initiatorBotOwner?.controller != null)
            {
                info.damageTypes?.ScaleAll(initiatorBotOwner.controller.botSetup.target.botDamageRate);

                if(entity is DecayEntity)
                {
                    if(entity.OwnerID != initiatorBotOwner.controller.owner.userID.Get() && initiatorBotOwner.controller.botSetup.target.disableDamagePlayerBuildings)
                    {
                        RemoveDamage(info);
                    }

                    if(entity.OwnerID == initiatorBotOwner.controller.owner.userID.Get() && initiatorBotOwner.controller.botSetup.target.disableDamageOwnerBuildings)
                    {
                        RemoveDamage(info);
                    }
                }
                
                var activeItem = initiatorBotOwner.controller.bot.GetActiveItem();

                if(activeItem != null)
                {
                    var heldItem = activeItem.GetHeldEntity();

                    if(heldItem != null)
                    {
                        if(heldItem is BaseMelee)
                        {
                            var melee = heldItem as BaseMelee;

                            if(melee != null)
                            {
                                if(activeItem.hasCondition)
                                {
                                    float conditionLoss = melee.GetConditionLoss();
                                    float num = 0f;
                                    
                                    foreach (Rust.DamageTypeEntry damageType in melee.damageTypes)
                                    {
                                        if (damageType.amount > 0.0) num += Mathf.Clamp(damageType.amount - info.damageTypes.Get(damageType.type), 0.0f, damageType.amount);
                                    }

                                    activeItem.LoseCondition(conditionLoss + num * 0.2f);
                                }
                            }
                        }
                    }
                }

                if(!initiatorBotOwner.controller.botSetup.target.enablePlayerHurt)
                {
                    var victim = entity.ToPlayer();

                    if(victim != null)
                    {
                        if(!IsBot(victim))
                        {
                            RemoveDamage(info);
                            return true;
                        }
                    }
                }

                if(!initiatorBotOwner.controller.botSetup.target.enablePersonalBotHurt)
                {
                    if(GetOwnerComponent(entity.net.ID.Value) != null)
                    {
                        RemoveDamage(info);
                        return true;
                    }
                }
            }

            var controller = GetController(entity.net.ID.Value);

            if(controller != null && controller?.bot != null) 
            {
                if(target == controller.bot) 
                {
                    RemoveDamage(info);
                    return true;
                }

                controller.OnAttacked(target, info, true);
                return null;
            }
            
            if(ownerComponent != null && ownerComponent?.controller != null && ownerComponent?.controller?.owner != null) 
            {
                ownerComponent.controller.RenderMenu();

                if(entity == ownerComponent.controller.owner) 
                {
                    RemoveDamage(info);
                    return true;
                }                

                info.damageTypes?.ScaleAll(ownerComponent.controller.botSetup.target.botHurtRate);

                if(!ownerComponent.controller.botSetup.target.enablePlayerDamage)
                {
                    var player = target?.ToPlayer();

                    if(player != null)
                    {
                        if(!IsBot(player))
                        {
                            RemoveDamage(info);
                            return true;
                        }
                    }
                }
                
                ownerComponent.controller.OnAttacked(target, info);
            }

            return null;
        }

        private object CanBeTargeted(BaseCombatEntity player, MonoBehaviour behaviour)
        {
            if(player == null || behaviour == null || player?.net == null) return null;
            
            BotOwnerComponent comp = GetOwnerComponent(player.net.ID.Value);

            if(comp)
            {
                if(comp.controller == null) return null;

                BaseEntity ent;
                if(comp.controller.botSetup.target.blockOwnerTurretTargeting && behaviour.TryGetComponent<BaseEntity>(out ent))
                {
                    if(ent.OwnerID == comp.controller.owner.userID.Get()) return false;
                }

                if(!comp.controller.botSetup.target.enableTurretTargeting) return false;
            }

            return null;
        }

        private void OnPlayerDisconnected(BasePlayer player) => _pendingSpawnBots.Remove(player.userID.Get());

        private void OnPlayerRespawned(BasePlayer player)
        {
            if(_pendingSpawnBots.Contains(player.userID.Get())) OnPlayerConnected(player);
        }

        private void OnPlayerConnected(BasePlayer player)
        {
            if(_config.controls.spawnOnConnect)
            {
                var botSetup = GetBotSetup(player);

                if(botSetup?.Count != 0) 
                {
                    _pendingSpawnBots.Remove(player.userID.Get());

                    if(player.IsAlive())
                    {
                        chatCommand(player, "pnpc", new string[] {botSetup[0].spawnName});

                        foreach(var command in _config.controls.chatCommandsOnConnect)
                        {
                            string[] splitted = command.Split(' ');

                            if(splitted.Length == 1) chatCommand(player, splitted[0], new string[] {});
                            else 
                            {
                                var splittedList = new List<string>(splitted);
                                splittedList.RemoveAt(0);

                                chatCommand(player, splitted[0], splittedList.ToArray());
                            }
                        }
                    }
                    else _pendingSpawnBots.Add(player.userID.Get());
                }
            }
        }

        private object OnPlayerDeath(BasePlayer player, HitInfo info)
        {
            if(player == null || player?.net == null) return null;

            if(IsBot(player))
            {
                if(player.isMounted)
                {
                    var mount = player.GetMounted();

                    if(mount != null)
                    {
                        mount.DismountPlayer(player);
                    }
                }
                
                var botComponent = GetOwnerComponent(player.net.ID.Value);

                if(botComponent != null)
                {
                    var controller = botComponent.controller;

                    if(controller != null)
                    {
                        foreach(var item in player.inventory.containerMain.itemList)
                        {
                            if(item == null) continue;
                            
                            var held = item.GetHeldEntity();
                            if(held != null) EmptyContents(held);
                        }

                        foreach(var item in player.inventory.containerBelt.itemList)
                        {
                            if(item == null) continue;
                            
                            var held = item.GetHeldEntity();
                            if(held != null) EmptyContents(held);
                        }

                        if(controller.botSetup.dropActiveItem && controller.botSetup.functions.enableBotInventory && !player.inventory.containerBelt.IsLocked())
                        {
                            var activeItem = player.GetActiveItem();
                            if(activeItem != null) activeItem.DropAndTossUpwards(player.GetDropPosition());
                        }

                        DropLoot(player, controller, info);
                        player.Teleport(new Vector3(0, -1000, 0));

                        NextTick(() => 
                        {
                            if(player != null && !player.IsDestroyed) player.Kill();
                        });

                        return false;
                    }
                }
            }

            return null;
        }

        private void Unload() 
        {
            if(_config.clearConsoleOfSpam)
            {
                UnityEngine.Application.logMessageReceived += Facepunch.Output.LogHandler;
                UnityEngine.Application.logMessageReceived -= HandleLog;
            }

            var finded = _existsControllers.Values;

            for (int i = finded.Count - 1; i >= 0; i--)
            {
                var obj = new List<PlayerBotController>(_existsControllers.Values)[i];

                if(obj.bot != null) OnPlayerDeath(obj.bot, null);
                if(obj) UnityEngine.Object.Destroy(obj);
            }

            foreach(var player in BasePlayer.activePlayerList) CuiHelper.DestroyUi(player, "PersonalNPC_ControlPanel");

            CollectibleHelper.UnloadPlugin();
        }

        private object OnItemAction(Item item, string action, BasePlayer player)
        {
            if(item == null || player == null) return null;

            if(action != "unload_ammo")
            {
                var entity = item.GetEntityOwner();

                if(entity != null)
                {
                    if(entity is PlayerCorpse)
                    {
                        if(entity.TryGetComponent<BotOwnerComponent>(out var botOwnerComponent))
                        {
                            if(item.IsLocked()) return false;
                        }
                    }
                }

                return null;
            }

            var controller = GetController(player.net.ID.Value);
            if(controller == null) return null;
            
            if(controller.bot.inventory.containerMain == item.parent
                || controller.bot.inventory.containerBelt == item.parent
                    || controller.bot.inventory.containerWear == item.parent)
            {
                return false;
            }
            
            return null;
        }

        private object CanMoveItem(Item item, PlayerInventory playerLoot, ItemContainerId targetContainer, int targetSlot, int amount, ItemMoveModifier itemMoveModifier)
        {
            if(item == null) return null;
            var held = item.GetHeldEntity();

            BaseProjectile projectile = null;

            if(held is BaseProjectile) projectile = held as BaseProjectile;
            if(projectile == null) return null;

            var player = playerLoot?.containerMain?.GetOwnerPlayer();
            if(player == null) return null;
            
            var controller = GetController(player.net.ID.Value);
            if(controller == null) return null;

            if(controller != null)
            {
                if(controller.bot.inventory.containerMain.uid.Value == targetContainer.Value
                    || controller.bot.inventory.containerBelt.uid.Value == targetContainer.Value 
                        || controller.bot.inventory.containerWear.uid.Value == targetContainer.Value)
                        {
                            if(controller.botSetup.itemBlacklist.Contains(item.info.shortname))
                            {
                                SendMsg(player, "ChatCommand_Error_Blacklist");
                                return ItemContainer.CanAcceptResult.CannotAcceptRightNow;
                            }

                            if(item.contents != null)
                            {
                                if(item.contents.itemList.Count != 0)
                                {
                                    foreach(var contentsItem in item.contents.itemList)
                                    {
                                        if(controller.botSetup.itemBlacklist.Contains(contentsItem.info.shortname))
                                        {
                                            SendMsg(player, "ChatCommand_Error_Contents_Blacklist");
                                            return ItemContainer.CanAcceptResult.CannotAcceptRightNow;
                                        }
                                    }
                                }
                            }

                            if(projectile.primaryMagazine.contents != 0)
                            {
                                if(controller.botSetup.itemBlacklist.Contains(projectile.primaryMagazine.ammoType.shortname))
                                {
                                    SendMsg(player, "ChatCommand_Error_Contents_Blacklist");
                                    return ItemContainer.CanAcceptResult.CannotAcceptRightNow;
                                }
                            }
                        }
            }

            if(controller != null)
            {
                if(controller.botSetup.infiniteAmmo)
                {
                    var looting = player.inventory.loot.entitySource;

                    if(looting != null)
                    {
                        if(looting is LootableCorpse)
                        {
                            var corpse = looting as LootableCorpse;

                            if(corpse.playerName == controller.bot?.displayName)
                            {
                                if(playerLoot.containerMain.uid.Value == targetContainer.Value 
                                    || playerLoot.containerBelt.uid.Value == targetContainer.Value 
                                        || playerLoot.containerWear.uid.Value == targetContainer.Value)
                                        {
                                            if(player.inventory.loot.containers.Contains(item.parent)) EmptyContents(projectile);
                                            return null;
                                        }

                                if(projectile.primaryMagazine.contents > 0 && targetContainer.Value != 0)
                                {
                                    if(controller.bot.inventory.containerMain.uid.Value == targetContainer.Value
                                        || controller.bot.inventory.containerBelt.uid.Value == targetContainer.Value 
                                            || controller.bot.inventory.containerWear.uid.Value == targetContainer.Value)
                                            {
                                                var itemOwner = item.parent?.GetOwnerPlayer();

                                                if(itemOwner != null)
                                                {
                                                    if(itemOwner.IsNpc) EmptyContents(projectile);
                                                    else
                                                    {
                                                        controller.bot.GiveItem(ItemManager.Create(projectile.primaryMagazine.ammoType, projectile.primaryMagazine.contents));
                                                        EmptyContents(projectile);
                                                    }
                                                }
                                                else EmptyContents(projectile);
                                            }
                                            else 
                                            {
                                                controller.bot.GiveItem(ItemManager.Create(projectile.primaryMagazine.ammoType, projectile.primaryMagazine.contents));
                                                EmptyContents(projectile);
                                            }
                                }

                                if(targetContainer.Value == 0) EmptyContents(projectile);
                            }
                        }
                    }
                }
            }

            return null;
        }

        private object CanAcceptItem(ItemContainer container, Item item, int targetPos)
        {
            if(item == null) return null;

            // Fix bug with locked containers

            if(item.parent != null)
            {
                if(item.parent.IsLocked()) 
                {
                    var botPlayer = item.parent.GetOwnerPlayer();
                    if(botPlayer != null)
                    {
                        var ownerComponent = GetOwnerComponent(botPlayer.net.ID.Value);
                        if(ownerComponent != null)
                        {
                            if(ownerComponent.controller != null)
                            {
                                if(item.parent.uid == ownerComponent.controller.bot.inventory.containerWear.uid 
                                    || item.parent.uid == ownerComponent.controller.bot.inventory.containerMain.uid 
                                        || item.parent.uid == ownerComponent.controller.bot.inventory.containerBelt.uid)
                                {
                                    return ItemContainer.CanAcceptResult.CannotAcceptRightNow;
                                }
                            }
                        }
                    }
                    else
                    {
                        var entity = item.GetEntityOwner();

                        if(entity != null)
                        {
                            if(entity is PlayerCorpse)
                            {
                                var ownerComponent = GetOwnerComponent(entity.net.ID.Value);
                                if(ownerComponent != null) return ItemContainer.CanAcceptResult.CannotAcceptRightNow;
                            }
                        }
                    }
                }
            }

            //

            var player = item?.GetOwnerPlayer();
            if(player == null) return null;

            var controller = GetController(player.net.ID.Value);

            if(controller != null)
            {
                if(controller.bot.inventory.containerMain.uid == container.uid
                    || controller.bot.inventory.containerBelt.uid == container.uid 
                        || controller.bot.inventory.containerWear.uid == container.uid)
                        {
                            if(controller.botSetup.itemBlacklist.Contains(item.info.shortname))
                            {
                                SendMsg(player, "ChatCommand_Error_Blacklist");
                                return ItemContainer.CanAcceptResult.CannotAcceptRightNow;
                            }

                            if(item.contents != null)
                            {
                                if(item.contents.itemList.Count != 0)
                                {
                                    foreach(var contentsItem in item.contents.itemList)
                                    {
                                        if(controller.botSetup.itemBlacklist.Contains(contentsItem.info.shortname))
                                        {
                                            SendMsg(player, "ChatCommand_Error_Contents_Blacklist");
                                            return ItemContainer.CanAcceptResult.CannotAcceptRightNow;
                                        }
                                    }
                                }
                            }

                            var held = item.GetHeldEntity();

                            if(held != null)
                            {
                                if(held is BaseProjectile)
                                {
                                    var projectile = held as BaseProjectile;

                                    if(projectile.primaryMagazine.contents != 0)
                                    {
                                        if(controller.botSetup.itemBlacklist.Contains(projectile.primaryMagazine.ammoType.shortname))
                                        {
                                            SendMsg(player, "ChatCommand_Error_Contents_Blacklist");
                                            return ItemContainer.CanAcceptResult.CannotAcceptRightNow;
                                        }
                                    }
                                }
                            }
                        }
            }

            return null;
        }

        private void OnEntityBuilt(Planner plan, GameObject go)
        {
            if(_config.installItem.Count == 0) return;

            var player = plan.GetOwnerPlayer();
            if(player == null) return;

            var item = player.GetActiveItem();
            if(item == null) return;

            if(_config.controls.blockBotSpawnSafezone)
            {
                if(player.InSafeZone())
                {
                    SendMsg(player, "ChatCommand_Error_NoSpawnHere");
                    return;
                }
            }

            if(_config.controls.blockBotZoneManager.Count != 0 && ZoneManager != null)
            {
                foreach(var zone in _config.controls.blockBotZoneManager)
                {
                    if(ZoneManager.Call<bool>("IsPlayerInZone", zone, player))
                    {
                        SendMsg(player, "ChatCommand_Error_NoSpawnHere");
                        return;
                    }
                }
            }

            foreach(var loopInfo in _config.installItem)
            {
                if(loopInfo.skin == item.skin)
                {
                    if(_existsControllers.ContainsKey(player.net.ID.Value)) 
                    {
                        var comp = _existsControllers[player.net.ID.Value];

                        if(comp.ItemInfo.returnDespawn && comp.bot != null)
                        {
                            Item pnpc = ItemManager.CreateByName(comp.ItemInfo.shortname, 1, comp.ItemInfo.skin);
                            if(!string.IsNullOrEmpty(comp.ItemInfo.name)) pnpc.name = comp.ItemInfo.name;

                            player.GiveItem(pnpc);
                        }

                        UnityEngine.Object.Destroy(_existsControllers[player.net.ID.Value]);
                    }

                    NextTick(() =>
                    {
                        SetupController(player, loopInfo.bot, loopInfo);
                        go.ToBaseEntity().Kill();
                    });

                    break;
                }
            }
        }

        private void OnServerInitialized()
        {
            if(ImageLibrary == null)
            {
                PrintError("You need to install ImageLibrary plugin!");
                NextTick(() => Interface.Oxide.UnloadPlugin(Title));

                return;
            }

            CollectibleHelper.InitPlugin();

            if(VehicleDeployedLocks != null) Subscribe("CanUseLockedEntity");
            else Unsubscribe("CanUseLockedEntity");

            foreach(var type in Enum.GetValues(typeof(PlayerBotController.Icon))) ImageLibrary.CallHook("AddImage", $"https://api.rustyplugin.ru/pnpc/{type.ToString().ToLower()}.png", $"PersonalNPC_{type.ToString()}");

            ImageLibrary.CallHook("AddImage", "https://api.rustyplugin.ru/pnpc/arrow.png", "PersonalNPC_Close");
            ImageLibrary.CallHook("AddImage", "https://api.rustyplugin.ru/pnpc/arrow2.png", "PersonalNPC_Open");

            switch(_config.controls.mainControlButton)
            {
                case "E":
                    _config.controls.controlButton = BUTTON.USE;
                    break;

                case "MIDDLE_MOUSE":
                    _config.controls.controlButton = BUTTON.FIRE_THIRD;
                    break;

                case "RELOAD":
                    _config.controls.controlButton = BUTTON.RELOAD;
                    break;
                
                case "SPRINT":
                    _config.controls.controlButton = BUTTON.SPRINT;
                    break;

                case "SECOND_MOUSE":
                    _config.controls.controlButton = BUTTON.FIRE_SECONDARY;
                    break;
            }
            if(_config.autoSpawnBot)
            {
                foreach(var player in BasePlayer.activePlayerList)
                {
                    if(player == null) continue;

                    if(!player.IsNpc && player.IsConnected)
                    {
                        var botSetup = GetBotSetup(player);

                        if(botSetup != null)
                        {
                            if(botSetup.Count != 0) 
                            {
                                chatCommand(player, "pnpc", new string[] {botSetup[0].spawnName});
                            }
                        }
                    }
                }
            }
        }

        private void Loaded() 
        {
            Instance = this;

            _permissionKeys = new List<string>(_config.permissionBot.Keys);
            _permissionKeys.ForEach(x => permission.RegisterPermission(x, this));

            permission.RegisterPermission(_noCooldownPermission, this);
        }

        private object OnDispenserGather(ResourceDispenser dispenser, BaseEntity entity, Item item)
        {
            if(entity == null) return null;
            var bot = entity as BasePlayer;

            if(bot != null)
            {
                BotOwnerComponent botComponent = GetOwnerComponent(bot.net.ID.Value);

                if(botComponent?.controller != null)
                {
                    if(botComponent.controller.botSetup.gather.gatherRates.ContainsKey(item.info.shortname))
                    {
                        float rate = botComponent.controller.botSetup.gather.gatherRates[item.info.shortname];
                        item.amount = (int)(item.amount * rate);
                    }
                }
            }
            
            return null;
        }

        private object CanLootEntity(BasePlayer player, LootableCorpse corpse)
        {
            if (corpse == null || player == null) return null;
            BotOwnerComponent ownerComponent = GetOwnerComponent(corpse.net.ID.Value);
            if (ownerComponent == null) return null;

            if (player.userID.Get() == ownerComponent.botOwnerSteamID)
            {
                if (player.InSafeZone())
                {
                    RPC_OpenLootPanel(player, corpse, "player_corpse", corpse.containers);
                    return false;
                }
                return null;
            }

            // This is the fix: Block non-owners in any zone (PVE/PVP)
            SendMsg(player, "Bot_Error_Dead_NotOwner");
            return false;
        }

        private object CanLootEntity(BasePlayer player, DroppedItemContainer droppedItemContainer)
        {
            if (droppedItemContainer == null || player == null) return null;
            BotOwnerComponent ownerComponent = GetOwnerComponent(droppedItemContainer.net.ID.Value);
            if (ownerComponent == null) return null;

            if (player.userID.Get() == ownerComponent.botOwnerSteamID)
            {
                if (player.InSafeZone())
                {
                    RPC_OpenLootPanel(player, droppedItemContainer, "generic", droppedItemContainer.inventory);
                    return false;
                }
                return null;
            }

            // Hard block for backpacks too
            SendMsg(player, "Bot_Error_Dead_NotOwner");
            return false;
        }

        private void OnLootEntity(BasePlayer player, BaseEntity entity)
        {
            if(player == null || entity == null) return;

            if(entity.net == null) return;
            if(entity.net.ID == null) return;

            if(entity is DroppedItemContainer || entity is LootableCorpse)
            {
                BotOwnerComponent ownerComponent = GetOwnerComponent(entity.net.ID.Value);

                if(ownerComponent != null)
                {
                    if(player.userID.Get() != ownerComponent.botOwnerSteamID && !ownerComponent.canLootCorpse && ownerComponent.controller != null)
                    {
                        rust.SendChatMessage(player, "", GetMsg("Bot_Error_Dead_NotOwner", player.UserIDString), string.IsNullOrEmpty(ownerComponent.controller.botSetup.chatIconSteamID) ? "0" : ownerComponent.controller.botSetup.chatIconSteamID);
                        NextTick(() => 
                        {
                            if(player != null) player.EndLooting();
                        });

                        return;
                    }
                }
            }
        }

        #endregion
        
        #region Methods
        public static void RPC_OpenLootPanel(BasePlayer player, BaseEntity source, string nameType, params ItemContainer[] containers)
        {
            player.EndLooting();
            player.inventory.loot.Clear();
            if(!player.inventory.loot.StartLootingEntity(source, false)) return;
            player.inventory.loot.entitySource = source;
            foreach (var container in containers) player.inventory.loot.AddContainer(container);
            player.RadioactiveLootCheck(player.inventory.loot.containers);
            player.inventory.loot.SendImmediate();
            player.ClientRPC(RpcTarget.Player("RPC_OpenLootPanel", player), nameType);
        }
        public static string GetGrid(Vector3 position) // Credit: Jake_Rich
        {
            var roundedPos = new Vector2(World.Size / 2 + position.x, World.Size / 2 - position.z);
            var grid = $"{NumberToLetter((int)(roundedPos.x / 150))}{(int)(roundedPos.y / 150)}";

            return grid;
        }

        public static string NumberToLetter(int num) // Credit: Jake_Rich
        {
            var num2 = Mathf.FloorToInt((float)(num / 26));
            var num3 = num % 26;
            var text = string.Empty;
            if (num2 > 0)
            {
                for (var i = 0; i < num2; i++)
                {
                    text += Convert.ToChar(65 + i);
                }
            }

            return text + Convert.ToChar(65 + num3);
        }

        private void HandleLog(string message, string stackTrace, UnityEngine.LogType type)
        {
            if (!string.IsNullOrEmpty(message) && !message.Contains("ownerPlayer is not player"))
            {
                Facepunch.Output.LogHandler(message, stackTrace, type);
            }
        }

        private PlayerBotController GetController(ulong netID) => _existsControllers.ContainsKey(netID) ? _existsControllers[netID] : null;
        private BotOwnerComponent GetOwnerComponent(ulong netID) => _existsBots.ContainsKey(netID) ? _existsBots[netID] : null;

        private bool IsBot(BasePlayer player) => (player.IsNpc || !player.userID.Get().IsSteamId());

        private void SetupController(BasePlayer player, Configuration.BotSetup bot, Configuration.ItemInfo? itemInfo = null)
        {
            var controller = player.gameObject.AddComponent<PlayerBotController>();
            
            controller.bot = CreateBot(player, bot);
            controller.owner = player;

            if(itemInfo != null)
            {
                controller.IsSpawnedThroughItem = true;
                controller.ItemInfo = itemInfo.Value;
            }

            _existsControllers.Remove(player.net.ID.Value);
            _existsBots.Remove(controller.bot.net.ID.Value);

            _existsControllers.Add(player.net.ID.Value, controller);
            _existsBots.Add(controller.bot.net.ID.Value, controller.bot.GetComponent<BotOwnerComponent>());

            if(_config.controls.chatCommandsOnSpawn?.Count != 0)
            {
                foreach(var command in _config.controls.chatCommandsOnSpawn)
                {
                    string[] splitted = command.Split(' ');

                    if(splitted.Length == 1) chatCommand(player, splitted[0], new string[] {});
                    else 
                    {
                        var splittedList = new List<string>(splitted);
                        splittedList.RemoveAt(0);

                        chatCommand(player, splitted[0], splittedList.ToArray());
                    }
                }
            }

            if(bot.functions.blockEquipmentSlots) controller.bot.inventory.containerBelt.SetLocked(true);
            if(bot.functions.blockMainSlots) controller.bot.inventory.containerMain.SetLocked(true);
            if(bot.functions.blockWearSlots) controller.bot.inventory.containerWear.SetLocked(true);

            if(OnControllerCreated != null) OnControllerCreated.Invoke(controller);
            SendMsg(player, "ChatCommand_Success_Spawn");
        }

        private void RemoveDamage(HitInfo info)
        {
            info.damageTypes = new Rust.DamageTypeList();
            info.DidHit = false;
            info.DoHitEffects = false;
        }

        private void DropLoot(BasePlayer player, PlayerBotController controller, HitInfo info)
        {
            if(!controller.botSetup.functions.enableBotInventory) return;

            List<ItemContainer> containers = new List<ItemContainer>();

            if(!player.inventory.containerMain.IsLocked()) containers.Add(player.inventory.containerMain);
            if(!player.inventory.containerWear.IsLocked()) containers.Add(player.inventory.containerWear);
            if(!player.inventory.containerBelt.IsLocked()) containers.Add(player.inventory.containerBelt);

            if(_config.enableBackpackOnDeath)
            {
                DroppedItemContainer droppedContainer = GameManager.server.CreateEntity("assets/prefabs/misc/item drop/item_drop_backpack.prefab", player.transform.position + new Vector3(0, 0.5f, 0), Quaternion.identity) as DroppedItemContainer;
                droppedContainer.OwnerID = controller.owner.userID;

                if(controller.botSetup.excludeBackpackMainContainer) containers.Remove(player.inventory.containerMain);
                if(controller.botSetup.excludeBackpackBeltContainer) containers.Remove(player.inventory.containerBelt);
                if(controller.botSetup.excludeBackpackWearContainer) containers.Remove(player.inventory.containerWear);

                if(containers.Count != 0)
                {                    
                    droppedContainer.TakeFrom(containers.ToArray(), 0f);
                    droppedContainer.playerName = player.displayName;
                    droppedContainer.playerSteamID = player.userID.Get();
                    droppedContainer.Spawn();

                    if(_config.disableBackpackDespawn) droppedContainer.ResetRemovalTime(999999f);

                    var botOwner = droppedContainer.gameObject.AddComponent<BotOwnerComponent>();
                    botOwner.botOwnerSteamID = controller.owner.userID.Get();
                    botOwner.canLootCorpse = controller.botSetup.canLootCorpse;

                    _existsBots.Remove(droppedContainer.net.ID.Value);
                    _existsBots.Add(droppedContainer.net.ID.Value, botOwner);
                }
            }
            else 
            {
                PlayerCorpse playerCorpse = player.DropCorpse("assets/prefabs/player/player_corpse.prefab") as PlayerCorpse;
                playerCorpse.OwnerID = controller.owner.userID;

                playerCorpse.TakeFrom(player, containers.ToArray());
                playerCorpse.playerName = player.displayName;
                playerCorpse.playerSteamID = player.userID.Get();
                playerCorpse.transform.position += new Vector3(0, 0.5f, 0);
                playerCorpse.Spawn();

                if(_config.disableBackpackDespawn) playerCorpse.ResetRemovalTime(999999f);

                if(controller.botSetup.lockCorpseBeltContainer) playerCorpse.containers[2].SetLocked(true);
                if(controller.botSetup.lockCorpseMainContainer) playerCorpse.containers[0].SetLocked(true);
                if(controller.botSetup.lockCorpseWearContainer) playerCorpse.containers[1].SetLocked(true);

                var botOwner = playerCorpse.gameObject.AddComponent<BotOwnerComponent>();
                botOwner.botOwnerSteamID = controller.owner.userID.Get();
                botOwner.canLootCorpse = controller.botSetup.canLootCorpse;

                _existsBots.Remove(playerCorpse.net.ID.Value);
                _existsBots.Add(playerCorpse.net.ID.Value, botOwner);

                if (playerCorpse != null && info != null)
                {
                    Rigidbody component = playerCorpse.GetComponent<Rigidbody>();
                    if (component != null) component.AddForce((info.attackNormal + UnityEngine.Vector3.up * 0.5f).normalized * 1f, ForceMode.VelocityChange);
                }
            }
        }

        private void EmptyContents(BaseEntity held)
        {
            if(held is BaseProjectile) EmptyContents(held as BaseProjectile);
        }

        private void EmptyContents(BaseProjectile projectile)
        {
            projectile.primaryMagazine.contents = 0;
            projectile.SendNetworkUpdateImmediate();
        }

        private void OpenInventory(BasePlayer player, PlayerBotController controller)
        {
            if(!controller.botSetup.functions.enableBotInventory) return;

            player.EndLooting();
            player.inventory.loot.Clear();

            LootableCorpse corpse = GameManager.server.CreateEntity("assets/prefabs/player/player_corpse.prefab", Vector3.zero) as LootableCorpse;
            corpse.CancelInvoke("RemoveCorpse");

            corpse.syncPosition = false;
            corpse.limitNetworking = true;
            corpse.enableSaving = false;

            corpse.playerName = controller.bot.displayName;
            corpse.playerSteamID = 0;

            corpse.Spawn();
            corpse.SetFlag(BaseEntity.Flags.Locked, true);

            Buoyancy bouyancy;
            if (corpse.TryGetComponent<Buoyancy>(out bouyancy)) UnityEngine.Object.Destroy(bouyancy);

            Rigidbody rb;
            if (corpse.TryGetComponent<Rigidbody>(out rb)) UnityEngine.Object.Destroy(rb);

            corpse.SendAsSnapshot(player.Connection);
            
            player.inventory.loot.Clear();
            player.inventory.loot.PositionChecks = false;

            corpse.containers = new ItemContainer[0];

            if(!player.inventory.loot.StartLootingEntity(corpse, false)) return;

            player.inventory.loot.AddContainer(controller.bot.inventory.containerMain);
            player.inventory.loot.AddContainer(controller.bot.inventory.containerWear);
            player.inventory.loot.AddContainer(controller.bot.inventory.containerBelt);

            player.inventory.loot.SendImmediate();
            player.inventory.loot.MarkDirty();

            if(controller.botSetup.functions.blockEquipmentSlots) player.inventory.loot.containers[2].SetLocked(true);
            if(controller.botSetup.functions.blockMainSlots) player.inventory.loot.containers[0].SetLocked(true);
            if(controller.botSetup.functions.blockWearSlots) player.inventory.loot.containers[1].SetLocked(true);

            timer.Once(.25f, () => 
            {
                // player.ClientRPCPlayer(null, player, "RPC_OpenLootPanel", "player_corpse");
                player.ClientRPC(RpcTarget.Player("RPC_OpenLootPanel", player), "player_corpse");
            });
        }

        [ChatCommand("pnpc")]
        private void chatCommand(BasePlayer player, string command, string[] args) 
        {
            var controller = GetController(player.net.ID.Value);
            
            if(args == null || args?.Length == 0) 
            {
                if(controller != null) 
                {
                    if(controller.ItemInfo.returnDespawn)
                    {
                        Item pnpc = ItemManager.CreateByName(controller.ItemInfo.shortname, 1, controller.ItemInfo.skin);
                        if(!string.IsNullOrEmpty(controller.ItemInfo.name)) pnpc.name = controller.ItemInfo.name;

                        player.GiveItem(pnpc);
                    }

                    OnPlayerDeath(controller.bot, null);
                    SendMsg(player, "ChatCommand_Success_Despawn");
                }
                else 
                {
                    var botSetup = GetBotSetup(player);

                    if(botSetup != null)
                    {
                        if(botSetup.Count == 0) SendMsg(player, "ChatCommand_Error_NoPermission");
                        else 
                        {
                            if(botSetup.Count == 1)
                            {
                                chatCommand(player, command, new string[] {botSetup[0].spawnName});
                                return;
                            }

                            string msg = lang.GetMessage("ChatCommand_Notice_AvailableBots", this, player.UserIDString);
                            string availableBots = "";

                            foreach(var bot in botSetup) availableBots = availableBots + $"\n{botSetup.IndexOf(bot) + 1}. {bot.spawnName}";

                            msg = msg.Replace("{BOTS}", availableBots);
                            player.ChatMessage(msg);
                        }
                    }
                }

                return;
            }

            if(args[0] == "tugboat")
            {
                if(controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if(controller.LastTimeCommand > Time.realtimeSinceStartup)
                {
                    SendMsg(player, "Chat_Commands_TooFast");
                    return;
                }

                controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                if(controller.bot.isMounted)
                {
                    var mounted = controller.bot.GetMounted();

                    if(mounted.HasParent())
                    {
                        if(mounted.GetParentEntity() is Tugboat tugboat)
                        {
                            tugboat.DismountAllPlayers();
                            controller.bot.modelState.mounted = false;
                            controller.bot.modelState.poseType = 0;
                        }
                    }
                }

                if(controller.botSetup.functions.canMount && controller.botSetup.functions.enableBoatAddon)
                {
                    if(!controller.bot.isMounted && controller.owner.GetParentEntity() is Tugboat tugboat)
                    {
                        if(tugboat != null)
                        {
                            if(tugboat.IsAuthedForBuilding(controller.owner))
                            {
                                BaseMountable driver = null;

                                for(int i = 0; i < tugboat.MaxMounted(); i++)
                                {
                                    var mount = tugboat.GetMountPoint(i);

                                    if(mount != null)
                                    {
                                        if(mount.isDriver)
                                        {
                                            driver = mount.mountable;
                                            break;
                                        }
                                    }
                                }

                                if(driver.AnyMounted()) driver.DismountAllPlayers();
                                if(driver != null) driver.MountPlayer(controller.bot);

                                controller.bot.modelState.mounted = true;
                                controller.bot.modelState.poseType = (int)(tugboat.mountPose);

                                if(controller.MountedBoat != null) controller.MountedBoat.Invoke(tugboat, _config.mainProcessTimer);

                                controller.bot.SendNetworkUpdateImmediate();
                            }
                            else SendMsg(player, "ChatCommand_Tugboat_NoAuth");
                        }
                    }
                }
                else SendMsg(player, "ChatCommand_Error_CannotUse");

                return;
            }

            if(args[0] == "where")
            {
                if(controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if(controller.LastTimeCommand > Time.realtimeSinceStartup)
                {
                    SendMsg(player, "Chat_Commands_TooFast");
                    return;
                }

                controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                SendMsg(player, "ChatCommand_Notice_Location", new string[] {PersonalNPC.GetGrid(controller.bot.transform.position), Vector3.Distance(controller.bot.transform.position, player.transform.position).ToString()} );
                return;
            }

            if(args[0] == "health")
            {
                if(controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if(controller.LastTimeCommand > Time.realtimeSinceStartup)
                {
                    SendMsg(player, "Chat_Commands_TooFast");
                    return;
                }

                controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                SendMsg(player, "ChatCommand_Notice_Health", new string[] {Mathf.RoundToInt(controller.bot.Health()).ToString(), Mathf.RoundToInt(controller.bot.MaxHealth()).ToString()} );
                return;
            }

            if (args[0] == "name")
            {
                if (controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if (controller.LastTimeCommand > Time.realtimeSinceStartup)
                {
                    SendMsg(player, "Chat_Commands_TooFast");
                    return;
                }

                controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                if (args.Length < 2)
                {
                    SendMsg(player, "ChatCommand_Error_Name_Usage");
                    return;
                }

                if (args[1].Equals("reset", StringComparison.OrdinalIgnoreCase))
                {
                    controller.CustomDisplayName = null;
                    controller.bot.displayName = ResolveBotDisplayName(controller, player);
                    controller.bot.SendNetworkUpdate();
                    SendMsg(player, "ChatCommand_Notice_Name_Reset");
                    return;
                }

                string newName;
                if (args.Length == 2)
                    newName = args[1];
                else
                {
                    var parts = new string[args.Length - 1];
                    Array.Copy(args, 1, parts, 0, args.Length - 1);
                    newName = string.Join(" ", parts);
                }
                var sanitized = SanitizePersonalNpcName(newName.Replace("%OWNER_NAME%", player.displayName ?? ""));
                if (sanitized == null)
                {
                    SendMsg(player, "ChatCommand_Error_Name_Invalid");
                    return;
                }

                controller.CustomDisplayName = newName.Trim();
                controller.bot.displayName = ResolveBotDisplayName(controller, player);
                controller.bot.SendNetworkUpdate();
                SendMsg(player, "ChatCommand_Notice_Name_Changed", new string[] { controller.bot.displayName });
                return;
            }

            if(args[0] == "follow")
            {
                if(controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if(controller.LastTimeCommand > Time.realtimeSinceStartup)
                {
                    SendMsg(player, "Chat_Commands_TooFast");
                    return;
                }

                controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                if(args.Length > 1 && controller.botSetup.functions.enableHeliAddon && PNPCAddonHeli != null)
                {
                    if(!string.IsNullOrEmpty(args[1]))
                    {
                        BasePlayer toFollow = BasePlayer.Find(args[1]);
                        
                        if(toFollow == null)
                        {
                            SendMsg(player, "Bot_Error_FlyAddon_NoPlayerToFollow");
                        }
                        else 
                        {
                            PNPCAddonHeli.Call("TryFollowPlayer", player, toFollow);
                        }

                        return;
                    }
                }

                controller.FollowPlayer();
                SendMsg(player, "Bot_Notice_Following");

                return;
            }

            if (args[0] == "build")
            {
                if (controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if (controller.LastTimeCommand > Time.realtimeSinceStartup)
                {
                    SendMsg(player, "Chat_Commands_TooFast");
                    return;
                }

                controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                if (controller.botSetup.functions.enableBuilderAddon && PNPCAddonBuilder != null)
                {
                    PNPCAddonBuilder.Call("Build", player, controller, args.Length > 1 ? args[1] : string.Empty);
                    return;
                }

                return;
            }
            
            if(args[0] == "hunting")
            {
                if(controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if(controller.LastTimeCommand > Time.realtimeSinceStartup)
                {
                    SendMsg(player, "Chat_Commands_TooFast");
                    return;
                }

                controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                if(controller.botSetup.functions.enableHunterAddon && PNPCAddonHunter != null)
                {
                    controller.Nullify();
                    PNPCAddonHunter.Call("StartHunting", controller.bot);
                    return;
                }

                return;
            }

            if (args[0] == "hover")
            {
                if (controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if (controller.LastTimeCommand > Time.realtimeSinceStartup)
                {
                    SendMsg(player, "Chat_Commands_TooFast");
                    return;
                }

                controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                if (controller.botSetup.functions.enableHeliAddon && PNPCAddonHeli != null)
                {
                    PNPCAddonHeli.Call("Hover", player);
                    return;
                }

                return;
            }

            if(args[0] == "inventory")
            {
                if(controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if(controller.LastTimeCommand > Time.realtimeSinceStartup)
                {
                    SendMsg(player, "Chat_Commands_TooFast");
                    return;
                }

                controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                if(!controller.botSetup.functions.enableBotInventory)
                {
                    SendMsg(player, "ChatCommand_Error_CannotUse");
                    return;
                }

                if(controller.botSetup.inventoryCommand) OpenInventory(player, controller);
                else SendMsg(player, "ChatCommand_Error_CannotUse");

                return;
            }

            if(args[0] == "farm")
            {
                if(controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if(args.Length == 1)
                {
                    SendMsg(player, "ChatCommand_Error_AutoFarm");
                    return;
                }

                var compMode = controller.mode;

                if(compMode == null)
                {
                    SendMsg(player, "ChatCommand_Error_CannotUse");
                    return;
                }
                else if(!controller.botSetup.functions.canAutoFarm)
                {
                    SendMsg(player, "ChatCommand_Error_CannotUse");
                    return;
                }

                if(args[1] == "all" || args[1] == "wood" || args[1] == "stone" || args[1] == "metal" || args[1] == "sulfur") 
                {
                    rust.RunClientCommand(player, (_config.gui.useLocal ? "chat.localsay" : "chat.say"), new string[] { $"/pnpc auto-farm disable silent" });

                    rust.RunClientCommand(player, (_config.gui.useLocal ? "chat.localsay" : "chat.say"), new string[] { $"/pnpc auto-farm none silent" });
                    rust.RunClientCommand(player, (_config.gui.useLocal ? "chat.localsay" : "chat.say"), new string[] { $"/pnpc auto-farm {args[1]} silent" });

                    rust.RunClientCommand(player, (_config.gui.useLocal ? "chat.localsay" : "chat.say"), new string[] { $"/pnpc auto-farm enable silent" });

                    return;
                }
                else 
                {
                    SendMsg(player, "ChatCommand_Error_AutoFarm");
                    return;
                }
            }

            if(args[0] == "pickup")
            {
                if(controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if(args.Length == 1)
                {
                    SendMsg(player, "ChatCommand_Error_AutoPickup");
                    return;
                }

                var compMode = controller.mode;

                if(compMode == null)
                {
                    SendMsg(player, "ChatCommand_Error_CannotUse");
                    return;
                }
                else if(!controller.botSetup.functions.canAutoPickup)
                {
                    SendMsg(player, "ChatCommand_Error_CannotUse");
                    return;
                }

                if(args[1] == "all" || args[1] == "wood" || args[1] == "stone" || args[1] == "metal" || args[1] == "sulfur" || args[1] == "hemp" || args[1] == "corn" || args[1] == "mushroom" || args[1] == "pumpkin" || args[1] == "berries" || args[1] == "potato") 
                {
                    rust.RunClientCommand(player, (_config.gui.useLocal ? "chat.localsay" : "chat.say"), new string[] { $"/pnpc auto-pickup disable silent" });

                    rust.RunClientCommand(player, (_config.gui.useLocal ? "chat.localsay" : "chat.say"), new string[] { $"/pnpc auto-pickup none silent" });
                    rust.RunClientCommand(player, (_config.gui.useLocal ? "chat.localsay" : "chat.say"), new string[] { $"/pnpc auto-pickup {args[1]} silent" });

                    rust.RunClientCommand(player, (_config.gui.useLocal ? "chat.localsay" : "chat.say"), new string[] { $"/pnpc auto-pickup enable silent" });

                    return;
                }
                else 
                {
                    SendMsg(player, "ChatCommand_Error_AutoPickup");
                    return;
                }
            }

            if(args[0] == "auto-pickup")
            {
                if(controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if(args.Length == 1)
                {
                    SendMsg(player, "ChatCommand_Error_AutoPickup");
                    return;
                }
                else 
                {
                    var compMode = controller.mode;

                    if(compMode == null)
                    {
                        SendMsg(player, "ChatCommand_Error_CannotUse");
                        return;
                    }
                    else if(!controller.botSetup.functions.canAutoPickup)
                    {
                        SendMsg(player, "ChatCommand_Error_CannotUse");
                        return;
                    }

                    bool silent = false;
                    if(args.Length > 2) silent = args[2] == "silent";

                    if(args[1] == "disable")
                    {
                        if(controller.LastTimeCommand > Time.realtimeSinceStartup && !silent)
                        {
                            SendMsg(player, "Chat_Commands_TooFast");
                            return;
                        }

                        controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                        compMode.Disable();
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoPickup_Status");

                        return;
                    }

                    if(args[1] == "enable")
                    {
                        if(controller.LastTimeCommand > Time.realtimeSinceStartup && !silent)
                        {
                            SendMsg(player, "Chat_Commands_TooFast");
                            return;
                        }

                        controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                        compMode.SetMode(BotAutoMode.AutoMode.Pickup);
                        compMode.EnableMode();
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoPickup_Status");

                        return;
                    }

                    if(args[1] == "all")
                    {
                        compMode.AddResource(BotAutoMode.Resources.All);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoPickup_Status");
                    
                        return;
                    }

                    if(args[1] == "none")
                    {
                        compMode.AddResource(BotAutoMode.Resources.None);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoPickup_Status");
                    
                        return;
                    }

                    if(args[1] == "stone")
                    {
                        compMode.AddResource(BotAutoMode.Resources.Stone);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoPickup_Status");
                    
                        return;
                    }

                    if(args[1] == "metal")
                    {
                        compMode.AddResource(BotAutoMode.Resources.Metal);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoPickup_Status");
                    
                        return;
                    }

                    if(args[1] == "sulfur")
                    {
                        compMode.AddResource(BotAutoMode.Resources.Sulfur);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoPickup_Status");
                    
                        return;
                    }

                    if(args[1] == "wood")
                    {
                        compMode.AddResource(BotAutoMode.Resources.Wood);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoPickup_Status");

                        return;
                    }

                    if(args[1] == "hemp")
                    {
                        compMode.AddResource(BotAutoMode.Resources.Hemp);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoPickup_Status");

                        return;
                    }

                    if(args[1] == "corn")
                    {
                        compMode.AddResource(BotAutoMode.Resources.Corn);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoPickup_Status");

                        return;
                    }

                    if(args[1] == "mushroom")
                    {
                        compMode.AddResource(BotAutoMode.Resources.Mushroom);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoPickup_Status");

                        return;
                    }

                    if(args[1] == "pumpkin")
                    {
                        compMode.AddResource(BotAutoMode.Resources.Pumpkin);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoPickup_Status");

                        return;
                    }

                    if(args[1] == "berries")
                    {
                        compMode.AddResource(BotAutoMode.Resources.Berries);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoPickup_Status");

                        return;
                    }

                    if(args[1] == "potato")
                    {
                        compMode.AddResource(BotAutoMode.Resources.Potato);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoPickup_Status");

                        return;
                    }

                    compMode.Disable();
                    if(!silent) SendMsg(player, "ChatCommand_Notice_AutoPickup_Status");

                    return;
                }
            }

            if(args[0] == "auto-farm")
            {
                if(controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if(args.Length == 1)
                {
                    SendMsg(player, "ChatCommand_Error_AutoFarm");
                    return;
                } 
                else 
                {
                    var compMode = controller.mode;

                    if(compMode == null)
                    {
                        SendMsg(player, "ChatCommand_Error_CannotUse");
                        return;
                    }
                    else if(!controller.botSetup.functions.canAutoFarm)
                    {
                        SendMsg(player, "ChatCommand_Error_CannotUse");
                        return;
                    }

                    bool silent = false;
                    if(args.Length > 2) silent = args[2] == "silent";

                    if(args[1] == "disable")
                    {
                        if(controller.LastTimeCommand > Time.realtimeSinceStartup && !silent)
                        {
                            SendMsg(player, "Chat_Commands_TooFast");
                            return;
                        }

                        controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                        compMode.Disable();
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoFarm_Status");

                        return;
                    }

                    if(args[1] == "enable")
                    {
                        if(controller.LastTimeCommand > Time.realtimeSinceStartup && !silent)
                        {
                            SendMsg(player, "Chat_Commands_TooFast");
                            return;
                        }

                        controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                        compMode.SetMode(BotAutoMode.AutoMode.Farm);
                        compMode.EnableMode();
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoFarm_Status");

                        return;
                    }

                    if(args[1] == "all")
                    {
                        compMode.AddResource(BotAutoMode.Resources.All);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoFarm_Status");
                    
                        return;
                    }

                    if(args[1] == "none")
                    {
                        compMode.AddResource(BotAutoMode.Resources.None);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoFarm_Status");
                    
                        return;
                    }

                    if(args[1] == "barrels")
                    {
                        compMode.AddResource(BotAutoMode.Resources.Barrels);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoFarm_Status");
                    
                        return;
                    }

                    if(args[1] == "stone")
                    {
                        compMode.AddResource(BotAutoMode.Resources.Stone);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoFarm_Status");

                        return;
                    }

                    if(args[1] == "metal")
                    {
                        compMode.AddResource(BotAutoMode.Resources.Metal);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoFarm_Status");

                        return;
                    }

                    if(args[1] == "sulfur")
                    {
                        compMode.AddResource(BotAutoMode.Resources.Sulfur);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoFarm_Status");
                    
                        return;
                    }

                    if(args[1] == "wood")
                    {
                        compMode.AddResource(BotAutoMode.Resources.Wood);
                        if(!silent) SendMsg(player, "ChatCommand_Notice_AutoFarm_Status");
                    
                        return;
                    }

                    compMode.Disable();
                    if(!silent) SendMsg(player, "ChatCommand_Notice_AutoFarm_Status");

                    return;
                }
            }

            if(args[0] == "ignore")
            {
                if(controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if(controller.LastTimeCommand > Time.realtimeSinceStartup)
                {
                    SendMsg(player, "Chat_Commands_TooFast");
                    return;
                }

                controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                controller.EnableIgnore();
                return;
            }

            if(args[0] == "loot-all")
            {
                if(controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if(controller.LastTimeCommand > Time.realtimeSinceStartup)
                {
                    SendMsg(player, "Chat_Commands_TooFast");
                    return;
                }

                controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                if(!controller.botSetup.functions.lootAllSetup.enableLootAll) SendMsg(player, "ChatCommand_Error_CannotUse");
                else controller.EnableLootAll();

                return;
            }

            if(args[0] == "pvp")
            {
                if(controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if(controller.LastTimeCommand > Time.realtimeSinceStartup)
                {
                    SendMsg(player, "Chat_Commands_TooFast");
                    return;
                }

                controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                if(controller.botSetup.functions.pvpSetup.enablePVP == false) SendMsg(player, "ChatCommand_Error_CannotUse");
                else controller.EnablePVP();

                return;
            }

            if(args[0] == "idle")
            {
                if(controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if(controller.LastTimeCommand > Time.realtimeSinceStartup)
                {
                    SendMsg(player, "Chat_Commands_TooFast");
                    return;
                }

                controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                controller.EnableIdle();
                return;
            }

            if(args[0] == "combat")
            {   
                if(controller == null)
                {
                    SendMsg(player, "ChatCommand_Error_NoBot");
                    return;
                }

                if(controller.LastTimeCommand > Time.realtimeSinceStartup)
                {
                    SendMsg(player, "Chat_Commands_TooFast");
                    return;
                }

                controller.LastTimeCommand = Time.realtimeSinceStartup + _config.controls.pnpcCommandsCooldown;

                controller.EnableCombat();
                return;
            }

            var bots = GetBotSetup(player);

            if(bots.Count != 0)
            {
                List<Configuration.BotSetup> botsFinded = new List<Configuration.BotSetup>();
                foreach(var botSetup in bots) if(botSetup.spawnName == args[0]) botsFinded.Add(botSetup);

                Configuration.BotSetup bot;

                if(botsFinded.Count != 0) bot = botsFinded[0];
                else 
                {
                    SendMsg(player, "ChatCommand_Error_NotFounded");
                    return;
                }

                if(bot != null)
                {
                    if(!bot.functions.recoverSetup.blockBotSpawnWhileDowned && player.IsWounded())
                    {
                        SendMsg(player, "ChatCommand_Error_NoSpawnHere");
                        return;
                    }
                    string perm = string.Empty;

                    foreach(var pair in _config.permissionBot)
                    {
                        if(pair.Value == bot)
                        {
                            perm = pair.Key;
                            break;
                        }
                    }

                    if(permission.UserHasPermission(player.UserIDString, perm))
                    {
                        if(_config.controls.blockBotSpawnSafezone)
                        {
                            if(player.InSafeZone())
                            {
                                SendMsg(player, "ChatCommand_Error_NoSpawnHere");
                                return;
                            }
                        }

                        if(_config.controls.blockBotZoneManager.Count != 0 && ZoneManager != null)
                        {
                            foreach(var zone in _config.controls.blockBotZoneManager)
                            {
                                if(ZoneManager.Call<bool>("IsPlayerInZone", zone, player))
                                {
                                    SendMsg(player, "ChatCommand_Error_NoSpawnHere");
                                    return;
                                }
                            }
                        }

                        PlayerBotController comp = GetController(player.net.ID.Value);

                        if(comp != null) 
                        {
                            if(comp.ItemInfo.returnDespawn)
                            {
                                Item pnpc = ItemManager.CreateByName(comp.ItemInfo.shortname, 1, comp.ItemInfo.skin);
                                if(!string.IsNullOrEmpty(comp.ItemInfo.name)) pnpc.name = comp.ItemInfo.name;

                                player.GiveItem(pnpc);
                            }

                            OnPlayerDeath(comp.bot, null);
                            SendMsg(player, "ChatCommand_Success_Despawn");

                            return;
                        }

                        if(!permission.UserHasPermission(player.UserIDString, _noCooldownPermission))
                        {
                            if(_cooldownInfo.ContainsKey(player.userID.Get()))
                            {
                                var lastTimeSpawn = _cooldownInfo[player.userID.Get()];

                                if(DateTime.Now > lastTimeSpawn.AddSeconds(bot.cooldown))
                                {
                                    _cooldownInfo.Remove(player.userID.Get());
                                    _cooldownInfo.Add(player.userID.Get(), DateTime.Now);
                                }
                                else 
                                {
                                    SendMsg(player, "ChatCommand_Notice_Cooldown", new string[] { Mathf.RoundToInt((float)(lastTimeSpawn.AddSeconds(bot.cooldown) - DateTime.Now).TotalSeconds).ToString() });
                                    return;
                                }
                            }
                            else _cooldownInfo.Add(player.userID.Get(), DateTime.Now);
                        }

                        SetupController(player, bot);
                    }
                    else SendMsg(player, "ChatCommand_Error_NoPermission");
                }
                else SendMsg(player, "ChatCommand_Error_NotFounded");
            }
            else SendMsg(player, "ChatCommand_Error_NoPermission");
        }

        [ConsoleCommand("pnpc")]
        private void cnslCommand(ConsoleSystem.Arg arg)
        {
            var player = arg.Player();
            if(player == null) return;

            var controller = GetController(player.net.ID.Value);
            if(controller == null) return;

            if(arg.HasArgs())
            {
                if(arg.Args[0] == "command")
                {
                    if(arg.HasArgs(2))
                    {
                        string args = "";

                        if(arg.HasArgs(3)) for(int i = 2; i < arg.Args.Length; i++) args = args + $"\"{arg.Args[i]}\"";
                        rust.RunClientCommand(player, (_config.gui.useLocal ? "chat.localsay" : "chat.say"), new string[] { $"/{arg.Args[1]} {args}" });
                    }
                    
                    return;
                }

                if(arg.Args[0] == "hierarchy")
                {
                    if(!_config.gui.lockShortcutButtons) controller.RenderHierarchy();
                    return;
                }

                if(arg.Args[0] == "hide_panel")
                {
                    controller.IsGUIHidden = !controller.IsGUIHidden;
                    controller.RenderMenu(true);

                    return;
                }

                int index = 0;
                if(int.TryParse(arg.Args[0], out index)) foreach(var command in _config.gui.accessButtons[index].commands) player.SendConsoleCommand($"pnpc command {command}");
            }
        }

        [ConsoleCommand("pnpc.info")]
        private void cnslCommandInfo(ConsoleSystem.Arg arg)
        {
            string msg = string.Empty;
            var player = arg.Player();
        
            if(player != null) 
            {
                if(!player.IsAdmin) return;
            }

            foreach(var controller in _existsControllers.Values) msg += $"{controller.owner.displayName}: {controller.botSetup.spawnName}";
            if(string.IsNullOrEmpty(msg)) msg = "0 personal bots are spawned";

            if(player) player.ConsoleMessage(msg);
            else Puts(msg);
        }
        
        [ConsoleCommand("pnpc.item")]
        private void cnslCommandItem(ConsoleSystem.Arg arg)
        {
            if(arg.Player() != null) return;

            if(!arg.HasArgs(2))
            {
                PrintError("Please enter Steam ID and item skin!");
                return;
            }

            ulong id, skin;

            if(!ulong.TryParse(arg.Args[0], out id))
            {
                PrintError("Steam ID is incorrect");
                return;
            }

            if(!ulong.TryParse(arg.Args[1], out skin))
            {
                PrintError("Skin is incorrect");
                return;
            }

            BasePlayer reciver = BasePlayer.FindByID(id);
            
            if(reciver == null)
            {
                PrintError("Player not found");
                return;
            }

            Configuration.ItemInfo info = new Configuration.ItemInfo();

            foreach(var loopInfo in _config.installItem)
            {
                if(loopInfo.skin == skin)
                {
                    info = loopInfo;
                    break;
                }
            }

            if(info.bot == null)
            {
                PrintError("Item is not found");
                return;
            }

            Item pnpc = ItemManager.CreateByName(info.shortname, 1, info.skin);
            if(!string.IsNullOrEmpty(info.name)) pnpc.name = info.name;

            reciver.GiveItem(pnpc);
            Puts($"Item was successfully given to player {reciver.displayName}");
        }

        private NPCPlayer CreateBot(BasePlayer player, Configuration.BotSetup botSetup, Vector3 botPos = new Vector3())
        {
            NPCPlayer bot = GameManager.server.CreateEntity("assets/rust.ai/agents/npcplayer/pet/frankensteinpet.prefab", botPos == new Vector3() ? player.transform.position : botPos) as NPCPlayer;

            if(botSetup.skin == 0) bot.userID.Set((ulong)UnityEngine.Random.Range(1, 100000));
            else bot.userID.Set(botSetup.skin);

            bot.UserIDString = bot.userID.Get().ToString();
            bot.Spawn();

            bot.InitializeHealth(botSetup.maxHealth, botSetup.maxHealth);
            bot.inventory.Strip();

            var controller = player.GetComponent<PlayerBotController>();

            controller.botSetup = botSetup;
            controller.plugin = this;

            bot.displayName = ResolveBotDisplayName(controller, player);

            controller.enableCopterLocksAPI = VehicleDeployedLocks != null;
            controller.cachedImages = new Dictionary<string, string>();

            foreach(var type in Enum.GetValues(typeof(PlayerBotController.Icon)))
            {
                controller.cachedImages.Add(type.ToString(), ImageLibrary.Call<string>("GetImage", $"PersonalNPC_{type.ToString()}"));
            }

            controller.cachedImages.Add("open", ImageLibrary.Call<string>("GetImage", $"PersonalNPC_Open"));
            controller.cachedImages.Add("close", ImageLibrary.Call<string>("GetImage", $"PersonalNPC_Close"));

            bot.gameObject.AddComponent<BotOwnerComponent>().controller = controller; //
            
            return bot;
        }

        private static string SanitizePersonalNpcName(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return null;
            var t = s.Trim().Replace("<", "").Replace(">", "");
            if (t.Length > 48) t = t.Substring(0, 48);
            return string.IsNullOrWhiteSpace(t) ? null : t;
        }

        private static string ResolveBotDisplayName(PlayerBotController controller, BasePlayer owner)
        {
            if (controller?.botSetup == null) return "Bot";
            var ownerName = owner != null ? owner.displayName : "";
            if (!string.IsNullOrWhiteSpace(controller.CustomDisplayName))
            {
                var raw = controller.CustomDisplayName.Replace("%OWNER_NAME%", ownerName ?? "");
                var sanitized = SanitizePersonalNpcName(raw);
                return string.IsNullOrEmpty(sanitized) ? "Bot" : sanitized;
            }

            return string.IsNullOrEmpty(controller.botSetup.name)
                ? "Bot"
                : controller.botSetup.name.Replace("%OWNER_NAME%", ownerName ?? "");
        }

        public static string HexToRustFormat(string hex)
        {
            Color color;
            ColorUtility.TryParseHtmlString(hex, out color);

            var sb = new System.Text.StringBuilder();
            return sb.AppendFormat("{0:F2} {1:F2} {2:F2} {3:F2}", color.r, color.g, color.b, color.a).ToString();
        }

        private List<Configuration.BotSetup> GetBotSetup(BasePlayer player) 
        {
            List<Configuration.BotSetup> setups = new List<Configuration.BotSetup>();

            foreach(var key in _permissionKeys)
            {
                if(permission.UserHasPermission(player.UserIDString, key)) setups.Add(_config.permissionBot[key]);
            }

            return setups;
        }

        private string GetMsg(string key, string id) => lang.GetMessage(key, this, id);

        private void SendMsg(BasePlayer player, string key, string[] args = null) 
        {
            var controller = GetController(player.net.ID.Value);

            if(args != null) rust.SendChatMessage(player, "", string.Format(lang.GetMessage(key, this, player.UserIDString), args), (controller != null ? (string.IsNullOrEmpty(controller.botSetup.chatIconSteamID) ? "0" : controller.botSetup.chatIconSteamID) : "0"));
            else 
            {
                if(key == "ChatCommand_Notice_AutoPickup_Status" || key == "ChatCommand_Notice_AutoFarm_Status")
                {
                    if(controller != null)
                    {
                        string msg = "", status = "";

                        if(controller.mode.IsDisabled()) status = lang.GetMessage("ChatCommand_AutoMode_Status_Disabled", this, player.UserIDString);
                        else status = lang.GetMessage("ChatCommand_AutoMode_Status_Enabled", this, player.UserIDString);

                        var resources = controller.mode.GetResources();

                        for(int i = 0; i < resources.Length; i++) msg += $"{lang.GetMessage($"ChatCommand_AutoMode_Resources_{resources[i]}", this, player.UserIDString)}, ";
                        if(msg.Length - 2 >= 0) msg = msg.Remove(msg.Length - 2);

                        SendMsg(player, key, new string[] {status, msg});

                        return;
                    }
                }

                rust.SendChatMessage(player, "", lang.GetMessage(key, this, player.UserIDString), (controller != null ? (string.IsNullOrEmpty(controller.botSetup.chatIconSteamID) ? "0" : controller.botSetup.chatIconSteamID) : "0"));
            }
        }

        #endregion

        #region Behaviour

        private class BotOwnerComponent : MonoBehaviour
        {
            public PlayerBotController controller; // used to identify bot when he alive
            public ulong botOwnerSteamID = 0; // used for identify bot owner when he is dead
            public bool canLootCorpse = false;
        }

        public class BotAutoMode : MonoBehaviour
        {
            public enum AutoMode {None, Farm, Pickup}; 
            public enum Resources {All, None, Wood, Stone, Metal, Sulfur, Hemp, Berries, Potato, Corn, Pumpkin, Mushroom, Barrels};

            private AutoMode _mode = AutoMode.None;
            private List<string> _resources = new List<string>();
            private PlayerBotController _controller;

            private Coroutine _autoModeCoroutine;

            public float lastTimeStarted {get; private set;}
            public Vector3 StartPos {get; private set;}

            private void Start() => _controller = GetComponent<BotOwnerComponent>().controller;
            
            public void Disable() 
            {
                _mode = AutoMode.None;
                EnableMode(true);
            }

            public bool IsDisabled() => _mode == AutoMode.None;
            public AutoMode GetMode() => _mode;
            public void SetMode(AutoMode newMode) => _mode = newMode;

            public void AddResource(Resources resource) 
            {
                if(resource == Resources.All) 
                {
                    _resources = new List<string>() {"Wood", "Stone", "Metal", "Sulfur", "Barrels", "Hemp", "Corn", "Berries", "Potato", "Pumpkin", "Mushroom"};
                }
                else
                {
                    if(resource == Resources.None) _resources = new List<string>();
                    else 
                    {
                        _resources.RemoveAll(x => x == "All");

                        if(!_resources.Contains(resource.ToString())) _resources.Add(resource.ToString());
                        else _resources.RemoveAll(x => x == resource.ToString());
                    }
                }
            }

            public void EnableMode(bool disable = false)
            {
                if(disable)
                {
                    if(_autoModeCoroutine != null) _controller.StopCoroutine(_autoModeCoroutine);
                }
                else
                {
                    if(_mode != AutoMode.None && _controller) 
                    {
                        if(GetResources() == new string[] {})
                        {
                            EnableMode(true);
                            return;
                        }

                        StartPos = transform.position;
                        lastTimeStarted = UnityEngine.Time.realtimeSinceStartup;

                        // _autoModdeCoroutine = _controller.StartCoroutine(_controller.UpdateAutoMode());
                        _controller.StartAutoMode(); 
                    }
                }
            }

            public string[] GetResources() => _resources?.ToArray() ?? new string[] {};
        }

        public class PlayerBotController : FacepunchBehaviour
        {
            public enum Icon {Idle, Follow, Collect, Farm, Attack, Recover};

            public PersonalNPC plugin = null;
            public Configuration.BotSetup botSetup = new Configuration.BotSetup();

            /// <summary>When set, overrides <see cref="Configuration.BotSetup.name"/> for the overhead nameplate (supports %OWNER_NAME%).</summary>
            public string CustomDisplayName;

            public Dictionary<string, string> cachedImages = new Dictionary<string, string>();

            public NPCPlayer bot;
            public BasePlayer owner;
            public BotAutoMode mode {get; private set;}

            public bool enableCopterLocksAPI = false;

            private bool _isFollowPlayer, _isViewingHierarchy = false;
            private Vector3 _currentDestination;

            private BaseNavigator.NavigationSpeed _navigationSpeed = BaseNavigator.NavigationSpeed.Normal;
            private BaseNavigator _botNavigator;
            private Configuration _config;
            private List<ulong> _unreachableEntities = new List<ulong>(); // List of entities id, which didn't gather because they were unreachable
            private Icon _statusIcon = Icon.Follow;
            private Icon _lastRenderedIcon = Icon.Follow;

            private Vector3 _lastPosition, _lastBarrelTargetPosition;

            private CollectibleEntity _collectibleTarget;
            private ResourceDispenser _dispenserTarget;
            private LootContainer _containerTarget, _barrelTarget;
            private DroppedItem _itemTarget;
            private BaseEntity _lastTarget;
            private BaseEntity _lastBanTarget;
            private Vector3 _lastHitPositionWorld = Vector3.zero;
            private LootableCorpse _corpseTarget;

            private Coroutine _dismountCoroutine;
            private DistanceComparer _distanceComparer;
            
            private LootAllData _lootAllData = null;

            private float _recoverTime = 6f;
            private float _lastTimeGathered, _lastTimeGUI, _nextShootTime, _lastConditionWhileGather, _lastTimeSwitchTarget, _lastTimeAIMovement, _lastTimeInput;

            private int _pendingHealth;

            private bool _isIgnore, _isCombat, _isIdle, _isPVP;
            public bool IsGUIHidden;
            public float LastTimeCommand;

            public bool IsSpawnedThroughItem;
            public Configuration.ItemInfo ItemInfo;

            public UnityAction<BaseHelicopter> ControlHeli;
            public UnityAction<BaseHelicopter> MountedHeli;

            public UnityAction ControlBoat;
            public UnityAction<MotorRowboat, float> MountedBoat;

            public UnityAction<GroundVehicle> ControlCar;
            public UnityAction<GroundVehicle> MountedCar;

            public UnityAction<BaseLauncher, BaseEntity> FireRocket;
            public UnityAction<BaseProjectile, BaseEntity> FireBow;
            public UnityAction<ThrownWeapon, BaseEntity> Throw;
            public BaseNavigator Navigator => _botNavigator;

            public class LootAllData 
            {
                public BaseNavigator botNavigator;

                public List<BaseEntity> lootEntities = new List<BaseEntity>();

                public BaseEntity GetLootEntity()
                {
                    if(lootEntities == null) return null;

                    float closestDistance = float.MaxValue;
                    BaseEntity closestEntity = null;

                    foreach(var item in lootEntities)
                    {
                        if(item == null) continue;
                        float distance = Vector3.Distance(item.transform.position, botNavigator.transform.position);

                        if(distance < closestDistance || closestEntity == null)
                        {
                            closestEntity = item;
                            closestDistance = distance;
                        }
                    }

                    return closestEntity;
                }
            }

            private static string[] _blacklistedEntities = {"cactus-3", "cactus-4", "cactus-5", "cactus-6", "cactus-7", "cactus_3", "cactus_4", "cactus_5", "cactus_6", "cactus_7", "dead_log_a", "dead_log_b", "dead_log_c", "driftwood_1", "driftwood_2", "driftwood_3", "driftwood_4", "driftwood_5", "driftwood_set_1", "driftwood_set_2", "driftwood_set_3"};

            private bool OwnerIsMounted => owner.isMounted || IsOwnerTugboat;
            private bool IsOwnerTugboat => owner.GetParentEntity() is Tugboat tugboat && tugboat.IsAuthedForBuilding(owner);
            private BaseVehicle GetOwnerMountedVehicle()
            {
                if(owner.isMounted) return owner.GetMountedVehicle();
                if(IsOwnerTugboat) return owner.GetParentEntity() as Tugboat;
                return null;
            }
            private void Start() 
            {
                StartCoroutine(NextTick(() =>
                {
                    var frankenstein = bot.GetComponent<BasePet>();

                    frankenstein.ApplyPetStatModifiers();
                    //frankenstein.Brain.SetOwningPlayer(owner);

                    _botNavigator = frankenstein.GetComponent<FrankensteinPet>().Brain.Navigator;
                    if(botSetup.target.noDrowningDamage) FrankensteinBrain.DrownInDeepWater = false;

                    if(botSetup.enableMapView) 
                    {
                        BaseEntity marker = GameManager.server.CreateEntity(frankenstein.mapMarkerPrefab?.resourcePath, Vector3.zero, Quaternion.identity);

                        marker.OwnerID = owner.userID.Get();
                        marker.Spawn();

                        marker.SetParent(frankenstein);
                    }

                    if(_config.gui.autoMinimize) owner.SendConsoleCommand("pnpc hide_panel");
                    _distanceComparer = new DistanceComparer(bot);
                }));

                if(botSetup.functions.canAutoFarm || botSetup.functions.canAutoPickup) mode = bot.gameObject.AddComponent<BotAutoMode>();

                if(botSetup.startKit.Count != 0)
                {
                    foreach(var item in botSetup.startKit)
                    {
                        var cloth = ItemManager.CreateByName(item.shortname, item.amount, item.skin);
                        if(!string.IsNullOrEmpty(item.name)) cloth.name = item.name;

                        switch(item.container)
                        {
                            case "belt":
                                cloth.MoveToContainer(bot.inventory.containerBelt);
                                break;

                            case "main":
                                cloth.MoveToContainer(bot.inventory.containerMain);
                                break;

                            case "wear":
                                cloth.MoveToContainer(bot.inventory.containerWear);
                                break;
                        } 
                    }
                }

                _navigationSpeed = (BaseNavigator.NavigationSpeed)Enum.Parse(typeof(BaseNavigator.NavigationSpeed), System.Globalization.CultureInfo.CurrentCulture.TextInfo.ToTitleCase(botSetup.speed));

                _isFollowPlayer = true;
                
                _nextShootTime = UnityEngine.Time.realtimeSinceStartup;
                _lastTimeGUI = UnityEngine.Time.realtimeSinceStartup;

                _config = plugin._config;
                bot.CancelInvoke("UpdateMetabolism");

                bot.InvokeRepeating(() =>
                {
                    if(_pendingHealth > 0)
                    {
                        bot.Heal(1);
                        _pendingHealth--;
                    }
                }, 1f, 1f);

                StartCoroutine(Timer(RefreshMenu, _config.gui.guiRefreshTime, false));
                
                StartCoroutine(Timer(() =>
                {
                    if(bot != null) 
                    {
                        if(bot.transform.position.y > -1000f) _lastPosition = bot.transform.position;
                    }

                    if(botSetup.functions.recoverSetup.canRecover)
                    {
                        if(owner.IsWounded() || owner.IsIncapacitated()) 
                        {
                            _currentDestination = owner.transform.position - new Vector3(0, 0, 1);
                            SetDestination(_currentDestination);

                            if(Vector3.Distance(owner.transform.position, bot.transform.position) < _config.controls.recoverDistance)
                            {
                                if(_recoverTime < 0f) 
                                {
                                    SendMsg("Bot_Notice_Recover");
                                    owner.StopWounded(bot);

                                    SetIcon(Icon.Follow);
                                    _isFollowPlayer = true;
                                }
                                else 
                                {
                                    _recoverTime -= _config.mainProcessTimer;
                                    SetIcon(Icon.Recover);
                                }
                            }
                        }
                        else _recoverTime = botSetup.functions.recoverSetup._recoverTime;
                    }

                    if(_lootAllData != null)
                    {
                        if(_lootAllData.lootEntities.Count != 0)
                        {
                            var lootEntity = _lootAllData.GetLootEntity();

                            if(lootEntity is DroppedItem droppedItem)
                            {
                                if(_itemTarget != droppedItem)
                                {
                                    _itemTarget = droppedItem;
                                    _isFollowPlayer = false;

                                    SendMsg("Bot_Notice_GoingCollectItem");
                                    SetDestination(_itemTarget.transform.position);

                                    SetIcon(Icon.Collect);
                                }
                            }

                            if(lootEntity is LootableCorpse lootableCorpse)
                            {
                                if(_corpseTarget != lootableCorpse)
                                {
                                    _corpseTarget = lootableCorpse;
                                    _isFollowPlayer = false;

                                    SendMsg("Bot_Notice_GoingLootCorpse");
                                    SetDestination(_corpseTarget.transform.position);

                                    SetIcon(Icon.Collect);
                                }
                            }
                            
                            if(lootEntity is LootContainer lootContainer)
                            {
                                if(_containerTarget != lootContainer)
                                {
                                    _containerTarget = lootContainer;
                                    _isFollowPlayer = false;

                                    SendMsg("Bot_Notice_GoingLootBox");
                                    SetDestination(_containerTarget.transform.position);

                                    SetIcon(Icon.Collect);
                                }
                            }
                        }
                    }

                    if(_collectibleTarget != null)
                    {
                        if(!_collectibleTarget.IsDestroyed)
                        {
                            if(Vector3.Distance(bot.transform.position, _collectibleTarget.transform.position) < _config.controls.collectableDistance)
                            {
                                SetDestination(bot.transform.position);
                                foreach (ItemAmount itemAmount in _collectibleTarget.itemList)
                                {
                                    Item obj = ItemManager.Create(itemAmount.itemDef, (int) itemAmount.amount);
                                    if (obj != null) GiveItem(obj, false);
                                }

                                if (_collectibleTarget.pickupEffect.isValid) Effect.server.Run(_collectibleTarget.pickupEffect.resourcePath, _collectibleTarget.transform.position, _collectibleTarget.transform.up);
                                
                                RandomItemDispenser randomItemDispenser = PrefabAttribute.server.Find<RandomItemDispenser>(_collectibleTarget.prefabID);
                                if (randomItemDispenser != null) randomItemDispenser.DistributeItems(bot, _collectibleTarget.transform.position);
                                
                                _collectibleTarget.Kill();
                                bot.SignalBroadcast(BaseEntity.Signal.Gesture, "pickup_item");
                            }
                        }
                        else _collectibleTarget = null;
                    }

                    if(_itemTarget != null)
                    {
                        if(!_itemTarget.IsDestroyed)
                        {
                            if(Vector3.Distance(bot.transform.position, _itemTarget.transform.position) < _config.controls.itemPickupDistance)
                            {
                                SetDestination(bot.transform.position);

                                Item pickupItem = _itemTarget.item;
                                _itemTarget.RemoveItem();
                                
                                GiveItem(pickupItem, false);

                                if(_lootAllData != null)
                                {
                                    if(_lootAllData.lootEntities.Contains(_itemTarget)) _lootAllData.lootEntities.Remove(_itemTarget);
                                }

                                bot.SignalBroadcast(BaseEntity.Signal.Gesture, "pickup_item");
                            }
                        }
                        else _itemTarget = null;
                    }

                    if(_corpseTarget != null)
                    {
                        if(!_corpseTarget.IsDestroyed)
                        {
                            if(Vector3.Distance(bot.transform.position, _corpseTarget.transform.position) < _config.controls.lootContainerDistance)
                            {
                                SetDestination(bot.transform.position);

                                for(int i = _corpseTarget.containers.Length - 1; i >= 0; i--)
                                {
                                    if(_corpseTarget is NPCPlayerCorpse && (i == 1 || i == 2)) continue;

                                    var container = _corpseTarget.containers[i];

                                    for (int x = container.itemList.Count - 1; x >= 0; x--)
                                    {
                                        var item = container.itemList[x];
                                        GiveItem(item, false);
                                    }
                                }

                                if(_lootAllData != null)
                                {
                                    if(_lootAllData.lootEntities.Contains(_corpseTarget)) _lootAllData.lootEntities.Remove(_corpseTarget);
                                }

                                _corpseTarget.SendNetworkUpdateImmediate();                            
                                _corpseTarget = null;

                                bot.SignalBroadcast(BaseEntity.Signal.Gesture, "pickup_item");
                            }
                        }
                        else _corpseTarget = null;
                    }

                    if(_containerTarget != null)
                    {
                        if(!_containerTarget.IsDestroyed)
                        {
                            bool distanceCheck = Vector3.Distance(bot.transform.position, _containerTarget.transform.position) < _config.controls.lootContainerDistance;
                            if(!distanceCheck) distanceCheck = IsAtClosestNavmeshPoint(_containerTarget.transform.position, _config.controls.lootContainerDistance);

                            if(distanceCheck)
                            {
                                if(_containerTarget.LootSpawnSlots.Length != 0 || _config.allowedLootPrefabs.Contains(_containerTarget.ShortPrefabName))
                                {
                                    if(_containerTarget is HackableLockedCrate)
                                    {
                                        var hackable = _containerTarget as HackableLockedCrate;

                                        if(hackable.IsFullyHacked())
                                        {
                                            SetDestination(bot.transform.position);
                                                                        
                                            for (int i = _containerTarget.inventory.itemList.Count - 1; i >= 0; i--)
                                            {
                                                var item = _containerTarget.inventory.itemList[i];
                                                GiveItem(item, false);
                                            }
                                            
                                            if(_lootAllData != null)
                                            {
                                                if(_lootAllData.lootEntities.Contains(_containerTarget)) _lootAllData.lootEntities.Remove(_containerTarget);
                                            }
                                            
                                            _containerTarget.Kill();
                                            bot.SignalBroadcast(BaseEntity.Signal.Gesture, "pickup_item");
                                        }
                                        else 
                                        {
                                            if(!hackable.IsBeingHacked()) hackable.StartHacking();

                                            SendMsg("Bot_Error_Loot_HackableCrate");
                                            _containerTarget = null;
                                        }
                                    }
                                    else 
                                    {
                                        SetDestination(bot.transform.position);
                                                                    
                                        for (int i = _containerTarget.inventory.itemList.Count - 1; i >= 0; i--)
                                        {
                                            var item = _containerTarget.inventory.itemList[i];
                                            GiveItem(item, false);
                                        }
                                        
                                        if(_lootAllData != null)
                                        {
                                            if(_lootAllData.lootEntities.Contains(_containerTarget)) _lootAllData.lootEntities.Remove(_containerTarget);
                                        }

                                        _containerTarget.Kill();
                                        bot.SignalBroadcast(BaseEntity.Signal.Gesture, "pickup_item");
                                    }
                                }
                            }
                        }
                        else _containerTarget = null;
                    }

                    if(_barrelTarget != null)
                    {
                        if(!_barrelTarget.IsDestroyed)
                        {
                            _lastTarget = _barrelTarget;
                            _lastBarrelTargetPosition = _lastTarget.transform.position;
                        }
                        else _barrelTarget = null;
                    }
                    else if(_lastBarrelTargetPosition != Vector3.zero)
                    {
                        _lastTarget = null;
                        _isFollowPlayer = false;

                        if(Vector3.Distance(bot.transform.position, _lastBarrelTargetPosition) < _config.controls.lootContainerDistance)
                        {
                            SetDestination(bot.transform.position);
                                                        
                            var colliders = Physics.OverlapSphere(_lastBarrelTargetPosition, 10f);

                            foreach(var collider in colliders)
                            {
                                if(collider == null) continue;

                                var ent = collider.ToBaseEntity();
                                if(ent == null) continue;

                                if(ent is DroppedItem)
                                {
                                    var droppedItem = ent as DroppedItem;

                                    Item pickupItem = droppedItem.item;
                                    droppedItem.RemoveItem();
                                    
                                    GiveItem(pickupItem, false);
                                }
                            }

                            bot.SignalBroadcast(BaseEntity.Signal.Gesture, "pickup_item");
                            _lastBarrelTargetPosition = Vector3.zero;
                        }
                        else SetDestination(_lastBarrelTargetPosition);
                    }

                    try 
                    {
                        if(_dispenserTarget != null)
                        {
                            if(!_dispenserTarget.baseEntity.IsDestroyed)
                            {
                                if(Vector3.Distance(bot.transform.position, _dispenserTarget.transform.position) < _config.controls.gatherDistance)
                                {
                                    SetDestination(_dispenserTarget.transform.position);

                                    if(_dispenserTarget.gatherType == ResourceDispenser.GatherType.Ore)
                                    {   
                                        StagedResourceEntity staged = _dispenserTarget.GetComponent<StagedResourceEntity>();
                                        Vector3 offset = new Vector3(0, GetResourceStage(staged) * -1);

                                        Item pickaxe = (Item)null;
                                        Item active = bot.inventory.containerBelt.GetSlot(0);

                                        if(active != null && botSetup.gather.toolForStones.Contains(active.info.shortname))
                                        {
                                            var attackEntity = bot.GetAttackEntity();
                                            bool hasCooldown = attackEntity.HasAttackCooldown();

                                            bot.SetAimDirection(_dispenserTarget.transform.position + offset - bot.GetPosition());
                                            bot.MeleeAttack();

                                            if(_lastConditionWhileGather != _dispenserTarget.baseEntity.Health() && !hasCooldown)
                                            {
                                                HitInfo info = new HitInfo 
                                                {
                                                    Weapon = bot.GetAttackEntity(),
                                                    CanGather = true,
                                                    DidGather = false,
                                                    Initiator = botSetup.gather.gatherResourcesToOwner ? owner : bot,
                                                    gatherScale = 1f,
                                                };

                                                info.damageTypes.ScaleAll(1f);
                                                _dispenserTarget.DoGather(info);

                                                _lastConditionWhileGather = _dispenserTarget.baseEntity.Health();
                                                _lastTimeGathered = UnityEngine.Time.realtimeSinceStartup;
                                            }
                                            else 
                                            {
                                                if(_lastTimeGathered + 0.5f < UnityEngine.Time.realtimeSinceStartup)
                                                {
                                                    _lastTimeGathered = UnityEngine.Time.realtimeSinceStartup;
                                                    _lastConditionWhileGather = _lastConditionWhileGather - 1f;
                                                }
                                            }
                                        }
                                        else 
                                        {
                                            pickaxe = EquipItem(false, false, true);

                                            if(pickaxe != null)
                                            {
                                                if(active != null) active.position = pickaxe.position;
                                                pickaxe.position = 0;

                                                active.MarkDirty();
                                                pickaxe.MarkDirty();
                                            }
                                        }
                                    }
                                    else if(_dispenserTarget.gatherType == ResourceDispenser.GatherType.Tree)
                                    {
                                        Item axe = (Item)null;
                                        Item active = bot.inventory.containerBelt.GetSlot(0);

                                        if(active != null && botSetup.gather.toolForTrees.Contains(active.info.shortname))
                                        {
                                            var attackEntity = bot.GetAttackEntity();
                                            bool hasCooldown = attackEntity.HasAttackCooldown();

                                            bot.MeleeAttack();

                                            if(_lastConditionWhileGather != _dispenserTarget.baseEntity.Health() && !hasCooldown)
                                            {
                                                HitInfo info = new HitInfo 
                                                {
                                                    Weapon = attackEntity,
                                                    CanGather = true,
                                                    DidGather = false,
                                                    Initiator = botSetup.gather.gatherResourcesToOwner ? owner : bot,
                                                    gatherScale = 1f
                                                };

                                                info.damageTypes.ScaleAll(1f);
                                                _dispenserTarget.DoGather(info);

                                                if(active.info.shortname == "chainsaw") 
                                                {
                                                    if(ReduceChainsawAmmo())    
                                                    {
                                                        _lastConditionWhileGather = _dispenserTarget.baseEntity.Health();
                                                        _lastTimeGathered = UnityEngine.Time.realtimeSinceStartup;
                                                    }
                                                }
                                                else //
                                                {
                                                    _lastConditionWhileGather = _dispenserTarget.baseEntity.Health();
                                                    _lastTimeGathered = UnityEngine.Time.realtimeSinceStartup;
                                                }
                                            }
                                            else 
                                            {
                                                if(_lastTimeGathered + 0.5f < UnityEngine.Time.realtimeSinceStartup)
                                                {
                                                    _lastTimeGathered = UnityEngine.Time.realtimeSinceStartup;
                                                    _lastConditionWhileGather = _lastConditionWhileGather - 0.5f; //
                                                }
                                            }
                                        }
                                        else 
                                        {
                                            axe = EquipItem(false, true);
                                            
                                            if(axe != null)
                                            {
                                                if(active != null) active.position = axe.position;
                                                axe.position = 0;

                                                active.MarkDirty();
                                                axe.MarkDirty();
                                            }
                                        }
                                    }
                                }
                                else SetDestination(_dispenserTarget.transform.position);
                            }
                            else 
                            {
                                _dispenserTarget.AssignFinishBonus(botSetup.gather.gatherResourcesToOwner ? owner : bot, 0.5f, null);
                                Nullify();

                                _isFollowPlayer = true;
                                _dispenserTarget = null;
                            }
                        }
                    }
                    catch (NullReferenceException) {}

                    if(OwnerIsMounted && _isFollowPlayer && !bot.isMounted && botSetup.functions.canMount && !IsOwnerTugboat)
                    {
                        if(Vector3.Distance(owner.transform.position, bot.transform.position) < (_config.controls.mountDistance))
                        {
                            var vehicle = GetOwnerMountedVehicle();

                            if(vehicle != null)
                            {
                                if((enableCopterLocksAPI ? (((bool)Interface.Oxide.CallHook("API_CanAccessVehicle", bot, vehicle.GetEntity(), false)) == true) : true))
                                {
                                    int maxSeats = vehicle.MaxMounted();

                                    bool requiresExtraSeating = _config.enableExtraSeatingSupport && vehicle is Minicopter;
                                    List<BaseMountable> extraSeats = new List<BaseMountable>();

                                    if(requiresExtraSeating)
                                    {
                                        var allSeats = vehicle.GetComponentsInChildren<BaseMountable>();
                                        
                                        foreach(var seat in allSeats)
                                        {
                                            if(seat.PrefabName == "assets/prefabs/vehicle/seats/passengerchair.prefab")
                                            {
                                                extraSeats.Add(seat);
                                                maxSeats++;
                                            }
                                        }
                                    }

                                    if(vehicle.NumMounted() < maxSeats)
                                    {
                                        if(_dismountCoroutine != null) StopCoroutine(_dismountCoroutine);

                                        BaseMountable nonOccupied = null, driver = null;

                                        for(int i = 0; i < vehicle.MaxMounted(); i++)
                                        {
                                            var mount = vehicle.GetMountPoint(i);

                                            if(mount != null)
                                            {
                                                if(!mount.mountable.IsBusy())
                                                {
                                                    if(!mount.isDriver) nonOccupied = mount.mountable;
                                                    else driver = mount.mountable;
                                                }
                                            }
                                        }

                                        if(requiresExtraSeating && driver == null && nonOccupied == null)
                                        {
                                            foreach(var seat in extraSeats)
                                            {
                                                if(seat != null)
                                                {
                                                    if(!seat.IsBusy())
                                                    {
                                                        nonOccupied = seat;
                                                        break;
                                                    }
                                                }
                                            }
                                        }

                                        if(driver != null) driver.MountPlayer(bot);
                                        else if(nonOccupied != null) nonOccupied.MountPlayer(bot);

                                        bot.modelState.mounted = true;
                                        bot.modelState.poseType = (int)(vehicle.mountPose);

                                        if(MountedHeli != null && vehicle is BaseHelicopter) MountedHeli.Invoke(vehicle as BaseHelicopter);
                                        if(MountedBoat != null && vehicle is MotorRowboat) MountedBoat.Invoke(vehicle as MotorRowboat, _config.mainProcessTimer);
                                        if(MountedCar != null && vehicle is GroundVehicle) MountedCar.Invoke(vehicle as GroundVehicle);

                                        bot.SendNetworkUpdateImmediate();
                                    }
                                }
                            }
                        }
                    }
                    else if(bot.isMounted && !OwnerIsMounted) 
                    {
                        Vector3 dismountPos;
                        var mountable = bot.GetMounted();
                        bool tp = mountable.GetParentEntity() is Tugboat;
                        mountable.DismountPlayer(bot);
                        if(tp) bot.transform.position = owner.transform.position + owner.transform.forward * 1.5f;

                        if(mountable.GetDismountPosition(bot, out dismountPos))
                        {
                            bot.DismountObject();
                            bot.modelState.mounted = false;

                            float height = 0f;
                            RaycastHit hit;

                            if (Physics.Raycast(new Vector3(bot.transform.position.x, bot.transform.position.y + 200f, bot.transform.position.z), Vector3.down, out hit, Mathf.Infinity, LayerMask.GetMask(new[] { "Terrain", "World", "Default", "Construction", "Deployed" } )) && !hit.collider.name.Contains("rock_cliff")) 
                            {
                                height = Vector3.Distance(hit.point, bot.transform.position);
                            }
                            
                            if(height == 0f || height > 3.5f) 
                            {
                                _dismountCoroutine = StartCoroutine(Timer(() => 
                                {
                                    if(dismountPos == bot.transform.position) OnDestroy();
                                }, 3f));
                            }
                        }
                    }

                    if(bot.isMounted && OwnerIsMounted)
                    {
                        var vehicle = bot.GetMountedVehicle();

                        if(vehicle != null)
                        {
                            if(vehicle.IsDriver(bot))
                            {
                                if(vehicle is BaseHelicopter)
                                {
                                    if(ControlHeli != null) ControlHeli.Invoke(vehicle as BaseHelicopter);
                                }

                                if(vehicle is MotorRowboat)
                                {
                                    if(ControlBoat != null) ControlBoat.Invoke();
                                }

                                if(vehicle is GroundVehicle)
                                {
                                    if(ControlCar != null) ControlCar.Invoke(vehicle as GroundVehicle);
                                }
                            }
                        }
                    }

                    if (_lastTarget != null && _recoverTime == botSetup.functions.recoverSetup._recoverTime)
                    {
                        if (!StartAttack())
                        {
                            if (_lastTarget == _barrelTarget) _barrelTarget = null;
                            _lastTarget = null;

                            SendMsg("Bot_Error_NoWeapon");
                            _isFollowPlayer = true;

                            SetIcon(Icon.Follow);
                        }
                    }
                    else if (_lastTarget == null && _isPVP)
                    {
                        Collider[] allDetected = Physics.OverlapSphere(bot.transform.position, botSetup.functions.pvpSetup.radius);

                        foreach (var collider in allDetected)
                        {
                            if (collider?.ToBaseEntity() is BasePlayer player)
                            {
                                if (player == bot || player == owner) continue;

                                if (botSetup.functions.pvpSetup.ignoreBots && !player.userID.Get().IsSteamId()) continue;
                                if (botSetup.functions.pvpSetup.ignorePersonalNPC && plugin.GetOwnerComponent(player.net.ID.Value)) continue;
                                if (botSetup.functions.pvpSetup.ignorePlayers && player.userID.Get().IsSteamId()) continue;
                                if (botSetup.functions.pvpSetup.ignorePrefabs.Contains(player.ShortPrefabName)) continue;

                                if (owner.Team != null)
                                {
                                    if (owner.Team.members.Contains(player.userID.Get())) continue;
                                }
                                if (plugin.Friends?.Call<bool>("IsFriend", owner.UserIDString, player.UserIDString) == true) continue;
                                if (plugin.Clans?.Call<bool>("IsClanMember", owner.UserIDString, player.UserIDString) == true) continue;

                                _lastTarget = player;
                                StartAttack();

                                break;
                            }
                        }
                    }
                    
                    bool isHunting = false;
                    if (botSetup.functions.enableHunterAddon && plugin.PNPCAddonHunter != null) isHunting = plugin.PNPCAddonHunter.Call<bool>("IsHunting", bot);

                    if (Vector3.Distance(bot.transform.position, owner.transform.position) > botSetup.gather.autoModeRadius && bot.transform.position != new Vector3() && mode.IsDisabled() && !_isIdle)
                    {
                        if (plugin.PNPCAddonHunter != null && botSetup.functions.enableHunterAddon)
                        {
                            if (!isHunting)
                            {
                                Nullify();
                                _isFollowPlayer = true;
                            }
                        }
                        else
                        {
                            Nullify();
                            _isFollowPlayer = true;
                        }
                    }

                    if(_dispenserTarget == null && _lastTarget == null && !bot.isMounted && _lastBarrelTargetPosition == Vector3.zero && _collectibleTarget == null && !_isFollowPlayer && _corpseTarget == null && _barrelTarget == null && _containerTarget == null && _dispenserTarget == null && !_isIdle && _itemTarget == null)
                    {
                        if(mode != null && !mode.IsDisabled()) 
                        {
                            bool started = StartAutoMode();

                            if(!started)
                            {
                                _isFollowPlayer = true;
                                if(!_isCombat) SendMsg("Bot_Notice_MissionCompleted");

                                SetIcon(Icon.Follow);
                            }
                        }
                        else
                        {
                            if (isHunting)
                            {
                                plugin.PNPCAddonHunter.Call("TryResumeHunting", bot);
                            }
                            else
                            {
                                _isFollowPlayer = true;
                                if(!_isCombat) SendMsg("Bot_Notice_MissionCompleted");

                                SetIcon(Icon.Follow);
                            }
                        }
                    }
                }, _config.mainProcessTimer, false, true));

                RenderMenu(true);
                if(_config.gui.showShortcutButtons) RenderHierarchy();
            }

            private void Update() 
            {
                if(bot == null || owner == null)
                {
                    Destroy(this);
                    return;
                }

                if(!owner.IsConnected)
                {
                    if(_config.enableDespawnOnDisconnect)
                    {
                        if(bot != null)
                        {
                            if(bot.inventory != null)
                            {
                                bot.inventory.Strip();
                            }
                        }
                    }

                    Destroy(this);
                    return;
                }
                else 
                {
                    if(owner.inventory.loot.entitySource != null)
                    {
                        var corpse = owner.inventory.loot.entitySource as LootableCorpse;
                        if(corpse?.playerName == bot.displayName && Vector3.Distance(owner.transform.position, bot.transform.position) > 3f && !botSetup.inventoryCommand) owner.EndLooting();
                    }
                }
                
                OnPlayerInput(owner, owner.serverInput);
                
                if(_isIdle) SetDestination(bot.transform.position);
                else 
                {
                    if(_isFollowPlayer) 
                    {
                        _currentDestination = owner.transform.position;
                        
                        if(Vector3.Distance(bot.transform.position, owner.transform.position) > _config.controls.followDistance) SetDestination(_currentDestination);
                        else _botNavigator.Pause();
                    }
                    else if(_botNavigator.Destination != _currentDestination && _currentDestination != new Vector3()) SetDestination(_currentDestination);
                }

                if(_currentDestination != bot.transform.position && _currentDestination != Vector3.zero && botSetup.teleportNoPath && !_isFollowPlayer)
                {
                    float distance = Vector3.Distance(bot.transform.position, _currentDestination);
                    if(distance > 2f && (bot.NavAgent?.velocity.magnitude < 0.4f))
                    {
                        if(_lastTimeAIMovement + 3f < Time.realtimeSinceStartup)
                        {
                            Vector3 teleportDestination = _currentDestination;
                            teleportDestination.y = TerrainMeta.HeightMap.GetHeight(teleportDestination);

                            if(Physics.Raycast(teleportDestination + new Vector3(0, 2f, 0), Vector3.down, out var hit, Mathf.Infinity, LayerMask.GetMask("Construction", "World", "Terrain", "Deployed", "Clutter", "Debris")))
                            {
                                if(hit.point.y < teleportDestination.y) teleportDestination.y = hit.point.y;
                            } //

                            bot.Teleport(teleportDestination);
                            _lastTimeAIMovement = Time.realtimeSinceStartup;
                        }
                    }
                    else _lastTimeAIMovement = Time.realtimeSinceStartup;
                }
                else _lastTimeAIMovement = Time.realtimeSinceStartup;//
            }

            public void OnPlayerInput(BasePlayer player, InputState input)
            {
                if(input != null)
                {
                    if(_config.controls.usePointGesture && !input.WasJustPressed(BUTTON.USE)) return;
                    if(!input.WasJustPressed(_config.controls.controlButton) && !input.WasJustPressed(BUTTON.USE)) return;
                }
                else if(_config.controls.usePointGesture == false) return;
                
                if(_lastTimeInput + 0.1f > Time.realtimeSinceStartup) return;
                _lastTimeInput = Time.realtimeSinceStartup;

                if(input != null)
                {
                    if(input.WasJustPressed(_config.controls.controlButton))
                    {
                        OnInput();
                        if(_config.controls.controlButton != BUTTON.USE) return;
                    }

                    if(input.WasJustPressed(BUTTON.USE))
                    {
                        RaycastHit hit;

                        if(Physics.Raycast(player.eyes.HeadRay(), out hit, 2f))
                        {
                            var ent = hit.GetEntity();
                            if(ent == bot && ent != null && owner == player && botSetup.functions.enableBotInventory) Instance.OpenInventory(owner, this);
                        }
                    }
                }
                else OnInput();
            }
            
            public bool GiveItem(Item item, bool directToBot)
            {
                if(!directToBot && botSetup.gather.gatherResourcesToOwner)
                {
                    owner.GiveItem(item);
                    return true;
                }

                if(bot.inventory.GiveItem(item)) return true;
                else 
                {
                    if(mode != null) 
                    {
                        if(!mode.IsDisabled()) mode.Disable();
                    }

                    item.Drop(bot.inventory.containerMain.dropPosition, bot.inventory.containerMain.dropVelocity);
                    return false;
                }
            }

            private void SetIcon(Icon icon)
            {
                _statusIcon = icon;
                RenderIcon();
            }

            public void FollowPlayer()
            {
                Nullify();

                if (mode) mode.Disable();

                _isFollowPlayer = true;

                if (botSetup.teleportFollow)
                {
                    bot.Teleport(owner.ServerPosition);
                }

                if (bot.isMounted)
                {
                    var mounted = bot.GetMounted();

                    if (mounted.HasParent())
                    {
                        if (mounted.GetParentEntity() is Tugboat tugboat)
                        {
                            tugboat.DismountAllPlayers();
                            bot.modelState.mounted = false;
                            bot.modelState.poseType = 0;
                        }
                    }
                }

                SetIcon(Icon.Follow);
            }
            
            public void FollowPlayerSimple()
            {
                _currentDestination = new Vector3();
                _lastBarrelTargetPosition = Vector3.zero;
                _lootAllData = null;

                _collectibleTarget = null;
                _dispenserTarget = null;
                _containerTarget = null;
                _barrelTarget = null;
                _corpseTarget = null;
                _lastTarget = null;
                _lastBanTarget = null;
                _itemTarget = null;

                _isIdle = false;
                _isFollowPlayer = false;

                _lastTimeGathered = 0f;
                _lastConditionWhileGather = 0f;
                _recoverTime = botSetup.functions.recoverSetup._recoverTime;

                if (mode) mode.Disable();

                _isFollowPlayer = true;

                if (bot.isMounted)
                {
                    var mounted = bot.GetMounted();

                    if (mounted.HasParent())
                    {
                        if (mounted.GetParentEntity() is Tugboat tugboat)
                        {
                            tugboat.DismountAllPlayers();
                            bot.modelState.mounted = false;
                            bot.modelState.poseType = 0;
                        }
                    }
                }

                SetIcon(Icon.Follow);
            }

            public void EnableIgnore()
            {
                _isIgnore = !_isIgnore;
                _lastBanTarget = null;
                _isCombat = false;
                _isPVP = false;

                SendMsg(_isIgnore ? "ChatCommand_Notice_Ignore_Activated" : "ChatCommand_Notice_Ignore_Deactivated");
            }

            public void EnableLootAll()
            {
                Collider[] colliders = Physics.OverlapSphere(bot.transform.position, botSetup.functions.lootAllSetup.radius);

                List<BaseEntity> lootEntities = new List<BaseEntity>();

                foreach(var collider in colliders)
                {
                    if(collider != null)
                    {
                        var ent = collider.ToBaseEntity();

                        if(ent != null)
                        {
                            if(botSetup.functions.lootAllSetup.lootContainers)
                            {
                                if(ent is LootContainer)
                                {
                                    var container = ent as LootContainer;

                                    if(container.LootSpawnSlots.Length != 0 || _config.allowedLootPrefabs.Contains(container.ShortPrefabName))
                                    {
                                        if(container is HackableLockedCrate crate)
                                        {
                                            if(!crate.IsFullyHacked()) continue;        
                                        }

                                        lootEntities.Add(container);
                                    }

                                    continue;
                                }
                            }

                            if(botSetup.functions.lootAllSetup.lootCorpses)
                            {
                                if(ent is LootableCorpse)
                                {
                                    var corpse = ent as LootableCorpse;
                                    bool found = false;

                                    foreach(var container in corpse.containers)
                                    {
                                        if(container.itemList.Count != 0 && !found)
                                        {
                                            found = true;
                                            lootEntities.Add(corpse);
                                        }
                                    }

                                    continue;
                                }
                            }

                            if(botSetup.functions.lootAllSetup.lootDroppedItems)
                            {
                                if(ent is DroppedItem)
                                {
                                    lootEntities.Add(ent);
                                    continue;
                                }
                            }
                        }
                    }
                }

                if(lootEntities.Count != 0) 
                {
                    _lootAllData = new LootAllData
                    {
                        lootEntities = lootEntities,
                        botNavigator = _botNavigator
                    };
                }
                else 
                {
                    _lootAllData = null;
                    SendMsg("Bot_Error_NoResourcesAround");
                }
            }

            public void EnablePVP() 
            {
                _isPVP = !_isPVP;
                _lastBanTarget = null;
                _isIgnore = false;
                _isCombat = false;

                if(!_isPVP)
                {
                    Nullify();

                    _lastTarget = null;
                    SetIcon(Icon.Follow);

                    _isFollowPlayer = true;
                }

                SendMsg(_isPVP ? "ChatCommand_Notice_PVP_Activated" : "ChatCommand_Notice_PVP_Deactivated");
            }

            public void EnableCombat()
            {
                _isCombat = !_isCombat;
                _lastBanTarget = null;
                _isIgnore = false;
                _isPVP = false;

                SendMsg(_isCombat ? "ChatCommand_Notice_Combat_Activated" : "ChatCommand_Notice_Combat_Deactivated");
            }

            public void EnableIdle()
            {
                _isCombat = false;
                _lastBanTarget = null;
                _isIgnore = false;
                _isPVP = false;
                _isIdle = !_isIdle;

                SendMsg(_isIdle ? "Bot_Notice_Staying" : "Bot_Notice_Following");
            }

            private bool ReduceChainsawAmmo()
            {
                var chainsaw = bot?.GetActiveItem()?.GetHeldEntity()?.GetComponent<Chainsaw>();
                if(chainsaw == null) return false;

                chainsaw.ammo = (int)(chainsaw.ammo - (chainsaw.fuelPerSec * botSetup.gather.chainsawFuelConsRate));

                if (chainsaw.ammo <= 0) 
                {
                    Item ammo;

                    while (chainsaw.ammo < chainsaw.maxAmmo && (ammo = chainsaw.GetAmmo()) != null && ammo.amount > 0)
                    {
                        int amountToConsume = Mathf.Min(chainsaw.maxAmmo - chainsaw.ammo, ammo.amount);
                        chainsaw.ammo += amountToConsume;

                        ammo.UseItem(amountToConsume);
                    }

                    chainsaw.SendNetworkUpdateImmediate();
                    ItemManager.DoRemoves();
                    bot.inventory.ServerUpdate(0.0f);

                    if(chainsaw.ammo <= 0)
                    {
                        chainsaw.ammo = 0;
                        chainsaw.SetEngineStatus(false);

                        _dispenserTarget = null;

                        SendMsg("Bot_Error_Chainsaw_NoFuel");
                        return false;
                    }
                }

                chainsaw.SendNetworkUpdate();
                return true;
            }

            public void OnInput()
            {
                if(botSetup.functions.enableBuilderAddon && plugin.PNPCAddonBuilder != null)
                {
                    var result = plugin.PNPCAddonBuilder.Call<bool>("InputPNPC", owner, _config.controls.rayLength);

                    if (result) return;
                }

                RaycastHit hit;

                if(Physics.Raycast(owner.eyes.HeadRay(), out hit, _config.controls.rayLength))
                {
                    var hitEnt = hit.GetEntity();
                    
                    if(hitEnt != null) 
                    {
                        if(botSetup.target.inputBlacklist.Contains(hitEnt.ShortPrefabName)) return;
                        if(_blacklistedEntities.Contains(hitEnt.ShortPrefabName)) return;
                        if(hitEnt.ShortPrefabName.Contains("junkpile") && !hitEnt.ShortPrefabName.Contains("scientistnpc")) return;

                        if(hitEnt is CollectibleEntity)
                        {
                            if(!botSetup.functions.canCollectResources)
                            {
                                SendMsg("ChatCommand_Error_CannotUse");
                                return;
                            }
                            
                            if(!botSetup.functions.canCollectDeployableNatureManually) 
                            {
                                if(plugin.DeployableNature != null)
                                {
                                    if (plugin.DeployableNature.IsLoaded)
                                    {
                                        if(plugin.DeployableNature.Call<bool>("IsDeployableNature", hitEnt)) return;
                                    }
                                }
                            }

                            ShowArrow(hit.point);
                            Nullify();

                            _currentDestination = hit.point;
                            SetDestination(_currentDestination);
                            _collectibleTarget = hitEnt as CollectibleEntity;

                            SendMsg("Bot_Notice_GoingCollect");
                            SetIcon(Icon.Collect);

                            return;
                        }

                        if(hitEnt is LootableCorpse)
                        {
                            if(!botSetup.functions.canLootBoxes)
                            {
                                SendMsg("ChatCommand_Error_CannotUse");
                                return;
                            }

                            var container = hitEnt as LootableCorpse;

                            ShowArrow(hitEnt.transform.position);
                            Nullify();

                            _currentDestination = hitEnt.transform.position;
                            SetDestination(_currentDestination);

                            _corpseTarget = container;

                            SendMsg("Bot_Notice_GoingLootCorpse");
                            SetIcon(Icon.Collect);

                            return;
                        }

                        if(hitEnt.GetComponent<ResourceDispenser>() != null)
                        {
                            if(!botSetup.functions.canGatherResources)
                            {
                                SendMsg("ChatCommand_Error_CannotUse");

                                return;
                            }
                            
                            if(!botSetup.functions.canGatherDeployableNatureManually) 
                            {
                                if(plugin.DeployableNature != null)
                                {
                                    if (plugin.DeployableNature.IsLoaded)
                                    {
                                        if(plugin.DeployableNature.Call<bool>("IsDeployableNature", (hitEnt))) return;
                                    }
                                }
                            }

                            var dispenser = hitEnt.GetComponent<ResourceDispenser>();

                            if(dispenser.gatherType != ResourceDispenser.GatherType.Flesh)
                            {
                                Item equipItem = EquipItem(false, dispenser.gatherType == ResourceDispenser.GatherType.Tree, dispenser.gatherType == ResourceDispenser.GatherType.Ore);

                                if(equipItem != null)
                                {
                                    ShowArrow(hitEnt.transform.position);
                                    Nullify();

                                    _currentDestination = hitEnt.transform.position;
                                    SetDestination(_currentDestination);
                                    _dispenserTarget = dispenser;

                                    SendMsg("Bot_Notice_GoingFarm");

                                    _statusIcon = Icon.Farm;
                                    RenderIcon();

                                    return;
                                }
                                else 
                                {
                                    SendMsg("Bot_Error_NoTool");
                                    
                                    return;
                                }
                            }
                        }

                        if(hitEnt is DroppedItem)
                        {
                            if(!botSetup.functions.canCollectDroppedItems)
                            {
                                SendMsg("ChatCommand_Error_CannotUse");
                                return;
                            }

                            var item = hitEnt as DroppedItem;

                            if(botSetup.itemBlacklist.Contains(item.item.info.shortname)) return;

                            if(!item.IsBroken())
                            {
                                ShowArrow(hitEnt.transform.position);
                                Nullify();
                                
                                _currentDestination = hitEnt.transform.position;
                                SetDestination(_currentDestination);
                                
                                _itemTarget = item;

                                SendMsg("Bot_Notice_GoingCollectItem");
                                SetIcon(Icon.Collect);
                            }
                            else 
                            {
                                SendMsg("Bot_Error_PickupBrokenItem");
                                return;
                            }
                        }

                        if(hitEnt is LootContainer)
                        {
                            if(!botSetup.functions.canLootBoxes)
                            {
                                SendMsg("ChatCommand_Error_CannotUse");
                                return;
                            }

                            var container = hitEnt as LootContainer;

                            if(container.LootSpawnSlots.Length != 0 || _config.allowedLootPrefabs.Contains(container.ShortPrefabName))
                            {
                                ShowArrow(hitEnt.transform.position);
                                Nullify();

                                _currentDestination = hitEnt.transform.position;

                                SetDestination(_currentDestination);
                                _containerTarget = container;

                                SendMsg("Bot_Notice_GoingLootBox");
                                SetIcon(Icon.Collect);

                                return;
                            }
                            else if(container.ShortPrefabName == "loot-barrel-1" || container.ShortPrefabName == "loot-barrel-2" || container.ShortPrefabName == "loot_barrel_1" || container.ShortPrefabName == "loot_barrel_2")
                            {
                                ShowArrow(hitEnt.transform.position);
                                Nullify();

                                _currentDestination = hitEnt.transform.position;

                                SetDestination(_currentDestination);
                                _barrelTarget = container;

                                SendMsg("Bot_Notice_GoingLootBox");
                                SetIcon(Icon.Collect);

                                return;
                            }
                        }

                        if(hitEnt is BaseCombatEntity)
                        {
                            if(!hitEnt.IsDestroyed && hitEnt.Health() > 1f)
                            {
                                if(hitEnt == bot)
                                {
                                    if(!_isFollowPlayer)
                                    {
                                        FollowPlayer();
                                        SendMsg("Bot_Notice_Following");

                                        return;
                                    }
                                    else 
                                    {
                                        _isFollowPlayer = false;
                                        _isIdle = true;

                                        SendMsg("Bot_Notice_Staying");
                                        SetIcon(Icon.Idle);

                                        return;
                                    }
                                }
                                else 
                                {
                                    if(hitEnt is DecayEntity)
                                    {
                                        if(!botSetup.functions.canAttackEnemyBuildings)
                                        {
                                            Nullify();
                                            _isFollowPlayer = true;

                                            return;
                                        }

                                        if(!botSetup.functions.canAttackOwnerBuildings && hitEnt.OwnerID == owner.userID.Get())
                                        {
                                            Nullify();
                                            _isFollowPlayer = true;

                                            return;
                                        }
                                    }

                                    ShowArrow(hitEnt.transform.position);
                                    Nullify();

                                    _lastTarget = hitEnt;

                                    if(StartAttack() == false)
                                    {
                                        _lastTarget = null;

                                        SendMsg("Bot_Error_NoWeapon");
                                        _isFollowPlayer = true;

                                        SetIcon(Icon.Follow);

                                        return;
                                    }

                                    SendMsg("Bot_Notice_StartedAttack");
                                    SetIcon(Icon.Attack);
                                }
                            }
                        }
                    }

                    if(CollectibleHelper.Instance?.GetFirstCollectibleEntity(hit.point, 1f) is CollectibleEntity collectible)
                    {
                        hitEnt = collectible;
                        
                        if(botSetup.target.inputBlacklist.Contains(hitEnt.ShortPrefabName)) return;
                        if(_blacklistedEntities.Contains(hitEnt.ShortPrefabName)) return;
                        if(hitEnt.ShortPrefabName.Contains("junkpile") && !hitEnt.ShortPrefabName.Contains("scientistnpc")) return;
                        
                        if(!botSetup.functions.canCollectResources)
                        {
                            SendMsg("ChatCommand_Error_CannotUse");
                            return;
                        }
                        
                        if(!botSetup.functions.canCollectDeployableNatureManually) 
                        {
                            if(plugin.DeployableNature != null)
                            {
                                if (plugin.DeployableNature.IsLoaded)
                                {
                                    if(plugin.DeployableNature.Call<bool>("IsDeployableNature", collectible)) return;
                                }
                            }
                        }

                        ShowArrow(collectible.transform.position);
                        Nullify();

                        _currentDestination = collectible.transform.position;
                        SetDestination(_currentDestination);
                        _collectibleTarget = collectible;

                        SendMsg("Bot_Notice_GoingCollect");
                        SetIcon(Icon.Collect);

                        return;
                    }
                
                    if(_isFollowPlayer || _isIdle)
                    {
                        ShowArrow(hit.point);
                        Nullify();

                        _currentDestination = hit.point;
                        SetDestination(_currentDestination);

                        _isIdle = true;
                        SendMsg("Bot_Notice_GoingPosition");
                    }
                }
            }

            public void OnAttacked(BaseEntity attacker, HitInfo info, bool ownerAttacked = false)
            {
                if(plugin.PNPCAddonHunter != null && botSetup.functions.enableHunterAddon)
                {
                    var result = plugin.PNPCAddonHunter.Call<bool>("IsHunting", bot);
                    if (result)
                    {
                        plugin.PNPCAddonHunter.Call("OnBotAttacked", bot, attacker);
                        return;
                    }
                }

                if(attacker == owner) return;
                if(attacker == bot) return;

                if(_isIgnore) return;

                if(ownerAttacked) 
                {
                    if(!botSetup.functions.canProtectOwner) return;
                }
                else 
                {
                    if(!botSetup.functions.canProtectSelf) return;
                }

                if(botSetup.attackIgnore.Contains(attacker.PrefabName)) return;

                if(botSetup.target.targetOnlyBasePlayers)
                {
                    if(!(attacker is BasePlayer)) return;
                }

                if(attacker is BasePlayer)
                {
                    var attackerPlayer = attacker as BasePlayer;
                    if(botSetup.target.bossesNames.Contains(attackerPlayer.displayName)) return;
                }
                
                var mount = bot.GetMountedVehicle();
                
                if(mount != null)
                {
                    if(mount.IsDriver(bot)) return;
                }
                
                if(_lastTimeSwitchTarget != 0f)
                {
                    if(_lastTimeSwitchTarget > Time.realtimeSinceStartup) return;
                }

                Nullify();
                _lastTimeSwitchTarget = Time.realtimeSinceStartup + botSetup.target.switchTargetCooldown;

                _lastTarget = attacker;
                SetIcon(Icon.Attack);
            }

            public void OnDamage()
            {
                if(botSetup.functions.selfHeal.enableHealing)
                {
                    if(bot.health <= botSetup.functions.selfHeal.belowValue)
                    {
                        foreach(var healItem in botSetup.functions.selfHeal.healItems)
                        {
                            var findItem = bot.inventory.FindItemByItemName(healItem);

                            if(findItem != null)
                            {
                                if(healItem == "largemedkit")
                                {
                                    bot.Heal(10);
                                    _pendingHealth += 100;

                                    findItem.UseItem();
                                }
                                else if(healItem == "syringe.medical" || healItem == "bandage")
                                {
                                    var itemSlot = bot.inventory.containerBelt.GetSlot(0);

                                    if(itemSlot != null ? findItem.parent == itemSlot.parent : false)
                                    {
                                        itemSlot.position = findItem.position;

                                        findItem.position = 0;
                                        findItem.MarkDirty();
                                                
                                        itemSlot.MarkDirty();
                                    }
                                    else 
                                    {
                                        findItem.MoveToContainer(bot.inventory.containerBelt, 0, true, true, null, true);
                                    }

                                    bot.UpdateActiveItem(findItem.uid);
                                    
                                    var held = bot.GetHeldEntity();

                                    if(held != null)
                                    {
                                        if(held is MedicalTool) held.ServerUse();
                                    }
                                }

                                break;
                            }
                        }
                    }
                }
            }

            public void OnOwnerAttack(BaseEntity victim)
            {
                if (plugin.PNPCAddonHunter != null && botSetup.functions.enableHunterAddon)
                {
                    var result = plugin.PNPCAddonHunter.Call<bool>("IsHunting", bot);

                    if (result) return;
                }

                _pendingHealth = 0;

                if (botSetup.attackIgnore.Contains(victim.PrefabName)) return;

                if (victim is BasePlayer)
                {
                    var attackerPlayer = victim as BasePlayer;
                    if (botSetup.target.bossesNames.Contains(attackerPlayer.displayName)) return;
                }

                if ((_isCombat || _isPVP) && victim != _lastBanTarget)
                {
                    if (victim is DecayEntity)
                    {
                        if ((!botSetup.functions.canAttackEnemyBuildings && victim.OwnerID != owner.userID.Get())) return;
                        if ((!botSetup.functions.canAttackOwnerBuildings && victim.OwnerID == owner.userID.Get())) return;
                    }

                    if ((victim is BaseCorpse) == false && victim is BaseCombatEntity baseCombatEntity && baseCombatEntity.IsAlive())
                    {
                        if (victim is BasePlayer basePlayer)
                        {
                            if (basePlayer.UserIDString.IsSteamId())
                            {
                                if (botSetup.functions.combatSetup.CanAttackedUsers) goto SetTarget;
                            }
                            else if (botSetup.functions.combatSetup.CanAttackedNpc) goto SetTarget;

                            goto SetBanTarget;
                        }
                        if (botSetup.functions.combatSetup.HasWiteList() && botSetup.functions.combatSetup.HasEntityFromList(victim.PrefabName, false)) goto SetTarget;
                        if (botSetup.functions.combatSetup.HasBlackList() && !botSetup.functions.combatSetup.HasEntityFromList(victim.PrefabName, true)) goto SetTarget;

                        SetBanTarget:

                        // Nullify();
                        _lastBanTarget = victim;
                        // SendMsg("Мне запрещено атаковать эту цель в режиме combat...");
                        return;

                    SetTarget:

                        Nullify();
                        _lastTarget = victim;
                        SetIcon(Icon.Attack);
                    }

                }
            }
            
            public void SetIdle()
            {
                _currentDestination = new Vector3();
                _lastBarrelTargetPosition = Vector3.zero;
                _lootAllData = null;

                _collectibleTarget = null;
                _dispenserTarget = null;
                _containerTarget = null;
                _barrelTarget = null;
                _corpseTarget = null;
                _lastTarget = null;
                _lastBanTarget = null;
                _itemTarget = null;

                _isIdle = true;
                _isFollowPlayer = false;

                _lastTimeGathered = 0f;
                _lastConditionWhileGather = 0f;
                _recoverTime = botSetup.functions.recoverSetup._recoverTime;
                
                SetIcon(Icon.Idle);
            }
            
            public void SetTarget(BaseEntity victim, Item weapon = null)
            {
                _currentDestination = new Vector3();
                _lastBarrelTargetPosition = Vector3.zero;
                _lootAllData = null;

                _collectibleTarget = null;
                _dispenserTarget = null;
                _containerTarget = null;
                _barrelTarget = null;
                _corpseTarget = null;
                _lastTarget = null;
                _lastBanTarget = null;
                _itemTarget = null;

                _isIdle = false;
                _isFollowPlayer = false;

                _lastTimeGathered = 0f;
                _lastConditionWhileGather = 0f;
                _recoverTime = botSetup.functions.recoverSetup._recoverTime;
                
                _lastTarget = victim;
                StartAttack(weapon);
                
                SetIcon(Icon.Attack);
            }

            private void StartCollect(CollectibleEntity[] array)
            {
                Nullify();

                SendMsg("Bot_Notice_GoingCollect");
                var resource = array[0];

                _currentDestination = resource.transform.position;
                SetDestination(_currentDestination);
                _collectibleTarget = resource;

                SetIcon(Icon.Collect);
            }

            public bool StartAutoMode()
            {
                if(mode.IsDisabled()) return false;

                var modeType = mode.GetMode();

                if(modeType == BotAutoMode.AutoMode.Farm)
                {
                    var resources = mode.GetResources();
                    var closestResourceObj = GetClosestFarmResource(resources);

                    if(closestResourceObj == null) return false;

                    Item axe = null, pickaxe = null;

                    if(closestResourceObj is ResourceDispenser)
                    {
                        var closestResource = closestResourceObj as ResourceDispenser;

                        if(_dispenserTarget != null)
                        {
                            if(closestResource.baseEntity.net.ID.Value == _dispenserTarget.baseEntity.net.ID.Value) return true;
                        }

                        if(closestResource.gatherType == ResourceDispenser.GatherType.Tree)
                        {
                            if(axe == null) axe = EquipItem(false, true);

                            if(axe != null)
                            {
                                Nullify();

                                _currentDestination = closestResource.transform.position;
                                SetDestination(_currentDestination);

                                SendMsg("Bot_Notice_GoingFarm");
                                _dispenserTarget = closestResource;

                                SetIcon(Icon.Farm);

                                return true;
                            } 
                        }
                        else if(closestResource.gatherType == ResourceDispenser.GatherType.Ore)
                        {
                            if(pickaxe == null) pickaxe = EquipItem(false, false, true);

                            if(pickaxe != null)
                            {
                                Nullify();

                                _currentDestination = closestResource.transform.position;
                                SetDestination(_currentDestination);

                                SendMsg("Bot_Notice_GoingFarm");
                                _dispenserTarget = closestResource;

                                SetIcon(Icon.Farm);

                                return true;
                            }
                        }
                    }
                    else 
                    {
                        var lootContainer = closestResourceObj as LootContainer;
                        Nullify();

                        _barrelTarget = lootContainer;
                        SendMsg("Bot_Notice_GoingFarm");

                        SetIcon(Icon.Farm);

                        return true;
                    }

                    if(mode.lastTimeStarted + 2 > UnityEngine.Time.realtimeSinceStartup)
                    {        
                        StartCoroutine(NextTick(() => SendMsg("Bot_Error_AutoFarm_NoResourcesAroundOrNoTool")));    
                        
                        mode.Disable();
                        SetIcon(Icon.Follow);
                    }
                    else 
                    {
                        mode.Disable();
                        SetIcon(Icon.Follow);
                    }

                    _isFollowPlayer = true;
                }
                else
                {
                    var resources = mode.GetResources();

                    var woodCollectibles = GetPickupResourcesInRadius(true);
                    var stoneCollectibles = (CollectibleEntity[])null;
                    var sulfurCollectibles = (CollectibleEntity[])null;
                    var metalCollectibles = (CollectibleEntity[])null;
                    var hempCollectibles = (CollectibleEntity[])null;
                    var cornCollectibles = (CollectibleEntity[])null;
                    var mushroomCollectibles = (CollectibleEntity[])null;
                    var pumpkinCollectibles = (CollectibleEntity[])null;
                    var berriesCollectibles = (CollectibleEntity[])null;
                    var potatoCollectibles = (CollectibleEntity[])null;

                    if(_collectibleTarget != null)
                    {
                        stoneCollectibles = GetPickupResourcesInRadius(false, false, false, true);
                        sulfurCollectibles = GetPickupResourcesInRadius(false, false, true);
                        metalCollectibles = GetPickupResourcesInRadius(false, true);
                        hempCollectibles = GetPickupResourcesInRadius(false, false, false, false, true);
                        cornCollectibles = GetPickupResourcesInRadius(false, false, false, false, false, true);
                        mushroomCollectibles = GetPickupResourcesInRadius(false, false, false, false, false, false, true);
                        pumpkinCollectibles = GetPickupResourcesInRadius(false, false, false, false, false, false, false, true);
                        berriesCollectibles = GetPickupResourcesInRadius(false, false, false, false, false, false, false, false, true);
                        potatoCollectibles = GetPickupResourcesInRadius(false, false, false, false, false, false, false, false, false, true);

                        if(woodCollectibles.Contains(_collectibleTarget) 
                            || stoneCollectibles.Contains(_collectibleTarget) 
                                || sulfurCollectibles.Contains(_collectibleTarget) 
                                    || metalCollectibles.Contains(_collectibleTarget) 
                                        || hempCollectibles.Contains(_collectibleTarget) 
                                            || cornCollectibles.Contains(_collectibleTarget)
                                                || mushroomCollectibles.Contains(_collectibleTarget)
                                                    || pumpkinCollectibles.Contains(_collectibleTarget)
                                                        || berriesCollectibles.Contains(_collectibleTarget)
                                                            || potatoCollectibles.Contains(_collectibleTarget)) return true;
                    }

                    if(resources.Contains("Wood") && woodCollectibles.Length != 0)
                    {
                        StartCollect(woodCollectibles);
                        return true;
                    }

                    stoneCollectibles = GetPickupResourcesInRadius(false, false, false, true);

                    if(resources.Contains("Stone") && stoneCollectibles.Length != 0)
                    {
                        StartCollect(stoneCollectibles);
                        return true;
                    }

                    sulfurCollectibles = GetPickupResourcesInRadius(false, false, true);

                    if(resources.Contains("Sulfur") && sulfurCollectibles.Length != 0)
                    {
                        StartCollect(sulfurCollectibles);
                        return true;
                    }

                    metalCollectibles = GetPickupResourcesInRadius(false, true);

                    if(resources.Contains("Metal") && metalCollectibles.Length != 0)
                    {
                        StartCollect(metalCollectibles);
                        return true;
                    }

                    hempCollectibles = GetPickupResourcesInRadius(false, false, false, false, true);

                    if(resources.Contains("Hemp") && hempCollectibles.Length != 0)
                    {
                        StartCollect(hempCollectibles);
                        return true;
                    }

                    cornCollectibles = GetPickupResourcesInRadius(false, false, false, false, false, true);

                    if(resources.Contains("Corn") && cornCollectibles.Length != 0)
                    {
                        StartCollect(cornCollectibles);
                        return true;
                    }

                    mushroomCollectibles = GetPickupResourcesInRadius(false, false, false, false, false, false, true);

                    if(resources.Contains("Mushroom") && mushroomCollectibles.Length != 0)
                    {
                        StartCollect(mushroomCollectibles);
                        return true;
                    }

                    pumpkinCollectibles = GetPickupResourcesInRadius(false, false, false, false, false, false, false, true);

                    if(resources.Contains("Pumpkin") && pumpkinCollectibles.Length != 0)
                    {
                        StartCollect(pumpkinCollectibles);
                        return true;
                    }

                    berriesCollectibles = GetPickupResourcesInRadius(false, false, false, false, false, false, false, false, true);

                    if(resources.Contains("Berries") && berriesCollectibles.Length != 0)
                    {
                        StartCollect(berriesCollectibles);
                        return true;
                    }

                    potatoCollectibles = GetPickupResourcesInRadius(false, false, false, false, false, false, false, false, false, true);

                    if(resources.Contains("Potato") && potatoCollectibles.Length != 0)
                    {
                        StartCollect(potatoCollectibles);
                        return true;
                    }

                    if(mode.lastTimeStarted + 2 > UnityEngine.Time.realtimeSinceStartup)
                    {                    
                        StartCoroutine(NextTick(delegate()
                        {
                            SendMsg("Bot_Error_NoResourcesAround");
                        }));

                        SetIcon(Icon.Follow);
                        mode.Disable();
                    }
                    else 
                    {
                        SetIcon(Icon.Follow);
                        mode.Disable();
                    }

                    _isFollowPlayer = true;
                }

                return false;
            }

            private IEnumerator NextTick(Action action)
            {
                yield return CoroutineEx.waitForEndOfFrame;
                action();

                yield break;
            }

            private IEnumerator Timer(Action action, float time, bool once = true, bool checkForBuilder = false)
            {
                for(;;)
                {
                    yield return CoroutineEx.waitForSeconds(time);
                    
                    try 
                    {
                        if (checkForBuilder)
                        {
                            if (botSetup.functions.enableBuilderAddon && plugin.PNPCAddonBuilder != null)
                            {
                                var active = plugin.PNPCAddonBuilder.Call<bool>("IsBuilderActive", owner);

                                if (active)
                                {
                                    _isFollowPlayer = false;
                                    _isIdle = true;
                                    _statusIcon = Icon.Idle;

                                    continue;
                                }
                            }
                        }
                       
                        action();
                    }
                    catch {}

                    if(once) break;
                }
            }

            public IEnumerator UpdateAutoMode()
            {
                for(;;)
                {
                    yield return CoroutineEx.waitForSeconds(5f);
                    
                    if(!StartAutoMode()) break;
                }
            }

            private object GetClosestFarmResource(string[] resources)
            {
                var colliders = Physics.OverlapSphere(mode.StartPos, botSetup.gather.autoModeRadius);

                Dictionary<BaseEntity, object> finded = new Dictionary<BaseEntity, object>();

                if(colliders.Length != 0)
                {
                    foreach(var collider in colliders)
                    {
                        var ent = collider.ToBaseEntity();

                        if(ent != null)
                        {
                            ResourceDispenser dispenser;
                            LootContainer container;

                            if(ent.TryGetComponent<ResourceDispenser>(out dispenser) && ent.transform.position != Vector3.zero && !ent.IsDestroyed)
                            {
                                if(!botSetup.functions.canGatherDeployableNatureAutoFarm) 
                                {
                                    if(plugin.DeployableNature != null)
                                    {
                                        if (plugin.DeployableNature.IsLoaded)
                                        {
                                            if(plugin.DeployableNature.Call<bool>("IsDeployableNature", (dispenser.baseEntity))) continue;
                                        }
                                    }
                                }
                                
                                if (!_blacklistedEntities.Contains(ent.ShortPrefabName) && !_unreachableEntities.Contains(ent.net.ID.Value) && !botSetup.target.inputBlacklist.Contains(ent.ShortPrefabName))
                                {
                                    if (resources.Contains("Wood") && dispenser.gatherType == ResourceDispenser.GatherType.Tree && _dispenserTarget != dispenser)
                                    {
                                        if (!finded.ContainsKey(ent)) finded.Add(ent, dispenser);
                                    }
                                    else if (dispenser.gatherType == ResourceDispenser.GatherType.Ore && (resources.Contains("Stone") || resources.Contains("Sulfur") || resources.Contains("Metal")) && _dispenserTarget != dispenser)
                                    {
                                        List<string> shortnames = new List<string>();

                                        if (resources.Contains("Stone")) shortnames.Add("stones");
                                        if (resources.Contains("Sulfur")) shortnames.Add("sulfur.ore");
                                        if (resources.Contains("Metal")) shortnames.Add("metal.ore");

                                        foreach (var item in dispenser.containedItems)
                                        {
                                            if (shortnames.Contains(item.itemDef.shortname))
                                            {
                                                finded.Add(ent, dispenser);
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                            else if(resources.Contains("Barrels") && ent.transform.position != Vector3.zero && !ent.IsDestroyed)
                            {
                                if(ent.TryGetComponent<LootContainer>(out container))
                                {
                                    if(container.ShortPrefabName == "loot-barrel-1" || container.ShortPrefabName == "loot-barrel-2" || container.ShortPrefabName == "loot_barrel_1" || container.ShortPrefabName == "loot_barrel_2")
                                    {
                                        if(!_blacklistedEntities.Contains(ent.ShortPrefabName) && !_unreachableEntities.Contains(ent.net.ID.Value) && !_barrelTarget == ent) 
                                        {
                                            if(!finded.ContainsKey(ent)) finded.Add(ent, container);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if(finded.Count != 0)
                {
                    var readyArray = new List<BaseEntity>(finded.Keys).ToArray();
                    Array.Sort(readyArray, _distanceComparer);

                    return finded[readyArray[0]];
                }

                return null;
            }

            private CollectibleEntity[] GetPickupResourcesInRadius(bool wood = false, bool metal = false, bool sulfur = false, bool stone = false, bool hemp = false, bool corn = false, bool mushroom = false, bool pumpkin = false, bool berries = false, bool potato = false)
            {
                List<CollectibleEntity> finded = CollectibleHelper.Instance == null ? new() : new(CollectibleHelper.Instance.GetCollectibleEntity(mode.StartPos, botSetup.gather.autoModeRadius));

                if(finded.Count != 0)
                {
                    foreach(var found in finded)
                    {
                        if(found != null)
                        {
                            if(!botSetup.functions.canCollectDeployableNatureAutoPickup) 
                            {
                                if(plugin.DeployableNature != null)
                                {
                                    if (plugin.DeployableNature.IsLoaded)
                                    {
                                        if(plugin.DeployableNature.Call<bool>("IsDeployableNature", found)) continue;
                                    }
                                }
                            }
                            
                            bool hasWood = false, hasStones = false, hasMetal = false, hasSulfur = false, hasCloth = false, hasCorn = false, hasMushroom = false, hasPumpkin = false, hasBerries = false, hasPotato = false;

                            foreach(var item in found.itemList)
                            {
                                if(wood && !hasWood) hasWood = item.itemDef.shortname == "wood";
                                if(stone && !hasStones) hasStones = item.itemDef.shortname == "stones";
                                if(metal && !hasMetal) hasMetal = item.itemDef.shortname == "metal.ore";
                                if(sulfur && !hasSulfur) hasSulfur = item.itemDef.shortname == "sulfur.ore";
                                if(hemp && !hasCloth) hasCloth = item.itemDef.shortname == "cloth";
                                if(corn && !hasCorn) hasCorn = item.itemDef.shortname == "corn";
                                if(mushroom && !hasMushroom) hasMushroom = item.itemDef.shortname == "mushroom";
                                if(pumpkin && !hasPumpkin) hasPumpkin = item.itemDef.shortname == "pumpkin";
                                if(potato && !hasPotato) hasPotato = item.itemDef.shortname == "potato";
                                if(berries && !hasBerries) hasBerries = (item.itemDef.shortname == "black.berry" || item.itemDef.shortname == "blue.berry" || item.itemDef.shortname == "green.berry" || item.itemDef.shortname == "red.berry" || item.itemDef.shortname == "white.berry" || item.itemDef.shortname == "yellow.berry");
                            }

                            if((wood && hasWood) || (stone && hasStones) || (metal && hasMetal) || (sulfur && hasSulfur) || (hemp && hasCloth) || (corn && hasCorn) || (mushroom && hasMushroom) || (pumpkin && hasPumpkin) || (berries && hasBerries) || (potato && hasPotato)) 
                            {
                                finded.Add(found);
                                continue;
                            }
                        }
                    }
                }

                var readyArray = finded.ToArray();
                Array.Sort(readyArray, _distanceComparer);

                return readyArray;
            }

            private int GetResourceStage(StagedResourceEntity ent)
            {
                float num = Mathf.InverseLerp(0f, ent.MaxHealth(), ent.Health());
                StagedResourceEntity.ResourceStage[] array = ent.stages.ToArray();
                for (int i = 0; i < array.Length; i++)
                {
                    if (num >= array[i].health)
                    {
                        return i;
                    }
                }

                return array.Length - 1;
            }

            private float _lastTimeTargetHealthChanged;

            private bool StartAttack(Item weapon = null)
            {
                if (_lastTarget != null)
                {
                    if(Vector3.Distance(bot.transform.position, _lastTarget.transform.position) > _config.controls.maxDistanceRemember && _lastTarget is BasePlayer)
                    {
                        _lastTarget = null;
                        return true;
                    }

                    if (_lastTarget.IsVisibleSpecificLayers(bot.CenterPoint() + botSetup.target.visibilitySetup.botCenterOffset, _lastTarget.CenterPoint() + botSetup.target.visibilitySetup.targetCenterOffset, LayerMask.GetMask(botSetup.target.visibilitySetup.obstacleLayers), botSetup.target.visibilitySetup.distance)) 
                    {  
                        var dir = ((_lastTarget.PivotPoint() + botSetup.target.aimOffset) - bot.GetPosition());
                        var targetPlayer = _lastTarget.ToPlayer();

                        if(targetPlayer != null)
                        {
                            if(targetPlayer.IsWounded()) dir -= botSetup.target.aimWoundedOffset;
                        }
                        
                        bot.SetAimDirection(dir);

                        var item = weapon != null ? weapon : EquipItem(true);

                        if(item == null) item = EquipItem(false, true);
                        if(item == null) item = EquipItem(false, false, true);
                        if(item == null) item = EquipItem(false, false, false, true);
                        if(item == null) item = EquipItem(false, false, false, false, true);

                        if(item == null) return false;

                        bool canMoveBot = true;

                        var held = item.GetHeldEntity();
                        float distance = Vector3.Distance(bot.transform.position, _lastTarget.transform.position);

                        if (held is BaseMelee)
                        {
                            if (distance < 2f)
                            {
                                var melee = held as BaseMelee;
                                float lastTargetHealth = _lastTarget.Health();

                                if (!melee.HasAttackCooldown())
                                {
                                    melee.StartAttackCooldown(melee.repeatDelay * 2f);
                                    bot.SignalBroadcast(BaseEntity.Signal.Attack, string.Empty);
                                    if (melee.swingEffect.isValid) Effect.server.Run(melee.swingEffect.resourcePath, melee.transform.position, Vector3.forward, bot.net.connection);

                                    Vector3 position = bot.eyes.position;
                                    Vector3 direction = bot.eyes.BodyForward();
                                    for (int index1 = 0; index1 < 2; ++index1)
                                    {
                                        List<RaycastHit> list = Facepunch.Pool.Get<List<RaycastHit>>();
                                        GamePhysics.TraceAll(new Ray(position - direction * (index1 == 0 ? 0.0f : 0.2f), direction), index1 == 0 ? 0.0f : (melee.attackRadius * 2f), list, (melee.effectiveRange * 2f) + 0.2f, 1220225809);
                                        bool flag = false;
                                        for (int index2 = 0; index2 < list.Count; ++index2)
                                        {
                                            RaycastHit hit = list[index2];
                                            BaseEntity entity = hit.GetEntity();
                                            if (!((UnityEngine.Object)entity == (UnityEngine.Object)null) && (!((UnityEngine.Object)entity != (UnityEngine.Object)null) || !((UnityEngine.Object)entity == (UnityEngine.Object)bot) && !entity.EqualNetID((BaseNetworkable)bot)) && (!((UnityEngine.Object)entity != (UnityEngine.Object)null) || !entity.isClient))
                                            {
                                                float num = 0.0f;
                                                foreach (Rust.DamageTypeEntry damageType in melee.damageTypes)
                                                    num += damageType.amount;
                                                entity.OnAttacked(new HitInfo((BaseEntity)bot, entity, Rust.DamageType.Slash, num * melee.npcDamageScale));
                                                HitInfo info = Facepunch.Pool.Get<HitInfo>();
                                                info.HitEntity = entity;
                                                info.HitPositionWorld = hit.point;
                                                info.HitNormalWorld = -direction;
                                                switch (entity)
                                                {
                                                    case BaseNpc _:
                                                    case BasePlayer _:
                                                        info.HitMaterial = StringPool.Get("Flesh");
                                                        break;
                                                    default:
                                                        info.HitMaterial = StringPool.Get((UnityEngine.Object)hit.GetCollider().sharedMaterial != (UnityEngine.Object)null ? hit.GetCollider().sharedMaterial.GetName() : "generic");
                                                        break;
                                                }
                                                melee.ServerUse_OnHit(info);
                                                Effect.server.ImpactEffect(info);
                                                Facepunch.Pool.Free<HitInfo>(ref info);
                                                flag = true;
                                                if (!((UnityEngine.Object)entity != (UnityEngine.Object)null) || entity.ShouldBlockProjectiles())
                                                    break;
                                            }
                                        }
                                        Facepunch.Pool.FreeUnmanaged<RaycastHit>(ref list);
                                        if (flag)
                                            break;
                                    }
                                }

                                if (lastTargetHealth != _lastTarget.Health()) _lastTimeTargetHealthChanged = Time.realtimeSinceStartup;
                                else if (_lastTimeTargetHealthChanged + 3f < Time.realtimeSinceStartup && !melee.HasAttackCooldown())
                                {
                                    if (_lastTarget is BaseCombatEntity)
                                    {
                                        var bce = _lastTarget as BaseCombatEntity;
                                        if (bce != null)
                                        {
                                            bce.Hurt(bce.health + 1f);
                                        }
                                    }
                                }
                            }
                            else
                            {
                                SetDestination(_lastTarget.transform.position - new Vector3(0, 0, 0.5f));
                                canMoveBot = false;
                            }
                        }
                        else if (held is BaseLauncher baseLauncher && FireRocket != null)
                        {
                            FireRocket.Invoke(baseLauncher, _lastTarget);
                            canMoveBot = false;
                        }
                        else if ((held is BowWeapon || held is CrossbowWeapon) && FireBow != null)
                        {
                            FireBow.Invoke(held as BaseProjectile, _lastTarget);
                        }
                        else if (held is BaseProjectile) ShotTest(item);
                        else if (held is ThrownWeapon thrownWeapon)
                        {
                            if (Throw != null)
                            {
                                Throw.Invoke(thrownWeapon, _lastTarget);
                                canMoveBot = false;
                            }
                            else thrownWeapon.ServerThrow(bot.transform.position + new Vector3(6, 0, 0));
                        }

                        if(canMoveBot)
                        {
                            if(distance > _config.controls.enemyDistance) SetDestination(_lastTarget.transform.position);
                            else _botNavigator.Pause();
                        }
                        
                    }

                    return true;
                }

                return false;
            }

            public virtual bool ShotTest(Item item)
            {
                AttackEntity heldEntity = bot.GetHeldEntity() as AttackEntity;
                if (heldEntity == null) return false;

                BaseProjectile baseProjectile = heldEntity as BaseProjectile;
                if(!baseProjectile) return false;

                if(baseProjectile.primaryMagazine.capacity != 1)
                {                    
                    if (baseProjectile.primaryMagazine.contents <= 0)
                    {
                        if(!botSetup.infiniteAmmo)
                        {
                            baseProjectile.TryReloadMagazine(bot.inventory);

                            if(baseProjectile.primaryMagazine.contents <= 0)
                            {
                                _lastTarget = null;
                                SendMsg("Bot_Error_NoAmmo");
                            }
                            else 
                            {
                                int contents = baseProjectile.primaryMagazine.contents;

                                baseProjectile.ServerReload();
                                baseProjectile.primaryMagazine.contents = contents;
                            }
                        }
                        else baseProjectile.ServerReload();

                        return false;
                    }
                }
                
                if(_nextShootTime > Time.realtimeSinceStartup) return false;
                else _nextShootTime = Time.realtimeSinceStartup + 0.5f;

                if (baseProjectile.isClient || baseProjectile.HasAttackCooldown()) return false;

                bool flag1 = bot != null;

                if (baseProjectile.primaryMagazine.contents <= 0) baseProjectile.SignalBroadcast(BaseEntity.Signal.DryFire);
                else
                {
                    if(baseProjectile.primaryMagazine.capacity == 1)
                    {
                        if (baseProjectile.GetAvailableAmmo() <= 0)
                        {
                            if(!botSetup.infiniteAmmo)
                            {
                                _lastTarget = null;
                                SendMsg("Bot_Error_NoAmmo");

                                return false;
                            }
                            else baseProjectile.ServerReload();
                        }
                        else 
                        {
                            baseProjectile.primaryMagazine.contents = 0;
                            baseProjectile.TryReloadMagazine(bot.inventory);
                        }
                    }

                    bool flag2 = flag1 && bot.IsNpc;
                    bool flag3 = flag1 && !(bot is NPCPlayer);

                    baseProjectile.primaryMagazine.contents--;
                    if (baseProjectile.primaryMagazine.contents <= 0) baseProjectile.primaryMagazine.contents = 0;

                    Vector3 origin = flag1 ? bot.eyes.position : baseProjectile.MuzzlePoint.transform.position;
                    Vector3 inputVec = baseProjectile.MuzzlePoint.transform.forward;

                    ItemModProjectile component1 = baseProjectile.primaryMagazine.ammoType.GetComponent<ItemModProjectile>();
                    Projectile component2 = component1.projectileObject.Get().GetComponent<Projectile>();

                    baseProjectile.SignalBroadcast(BaseEntity.Signal.Attack, string.Empty);

                    if (flag1) inputVec = !flag3 ? bot.eyes.BodyForward() : bot.eyes.rotation * Vector3.forward;

                    for (int index1 = 0; index1 < component1.numProjectiles; ++index1)
                    {
                        Vector3 direction = !flag3 ? AimConeUtil.GetModifiedAimConeDirection((float)((component1.projectileSpread * botSetup.target.fireSpreadRate) + baseProjectile.GetAimCone() + baseProjectile.GetAIAimcone() * 1.0), inputVec) : AimConeUtil.GetModifiedAimConeDirection((component1.projectileSpread * botSetup.target.fireSpreadRate) + baseProjectile.aimCone, inputVec);
                        List<RaycastHit> list = Facepunch.Pool.Get<List<RaycastHit>>();
                        
                        GamePhysics.TraceAll(new Ray(origin, direction), 0.01f, list, 300f, 1219701505); 

                        for (int index2 = 0; index2 < list.Count; ++index2)
                        {
                            if(list.Count < index2) continue;

                            RaycastHit hit = list[index2];
                            BaseEntity entity = hit.GetEntity();

                            if(entity == null) continue;
                            if(entity == bot) continue;

                            ColliderInfo component3 = hit.collider.GetComponent<ColliderInfo>();

                            HitInfo info = new HitInfo
                            {
                                Initiator = bot,

                                Weapon = (AttackEntity)baseProjectile,
                                WeaponPrefab = (BaseEntity)baseProjectile.gameManager.FindPrefab(baseProjectile.PrefabName).GetComponent<AttackEntity>(),

                                IsPredicting = false,
                                DoHitEffects = component2.doHitEffects,
                                DidHit = true,

                                ProjectileVelocity = direction * 300f,

                                PointStart = origin,
                                PointEnd = hit.point,
                                HitPositionWorld = hit.point,
                                HitNormalWorld = hit.normal,

                                HitEntity = entity,
                                UseProtection = true
                            };

                            component2.CalculateDamage(info, baseProjectile.GetProjectileModifier(), 1f);
                            info.damageTypes.ScaleAll(baseProjectile.GetDamageScale() * 1f * (flag2 ? baseProjectile.npcDamageScale : baseProjectile.turretDamageScale));
                            
                            if(entity is BaseCombatEntity) ((BaseCombatEntity)entity).OnAttacked(info);
                            component1.ServerProjectileHit(info);

                            if (entity is BasePlayer || entity is BaseNpc)
                            {
                                info.HitPositionLocal = entity.transform.InverseTransformPoint(info.HitPositionWorld);
                                info.HitNormalLocal = entity.transform.InverseTransformDirection(info.HitNormalWorld);
                                info.HitMaterial = StringPool.Get("Flesh");

                                Effect.server.ImpactEffect(info);
                            }

                            if (entity.ShouldBlockProjectiles())
                                break;
                        }

                        Facepunch.Pool.FreeUnmanaged<RaycastHit>(ref list);
                        Vector3 vector3 = !flag1 || !bot.isMounted ? Vector3.zero : direction * 6f;
                        baseProjectile.CreateProjectileEffectClientside(component1.projectileObject.resourcePath, origin + vector3, direction * component1.projectileVelocity, UnityEngine.Random.Range(1, 100), (Network.Connection) null, baseProjectile.IsSilenced(), true);
                    }
   
                    if(!botSetup.disableWeaponConditionLoss)
                    {
                        float barrelConditionLoss = component1.barrelConditionLoss, num = 0.25f;
                        item.LoseCondition(num + barrelConditionLoss);

                        if (item.contents != null && item.contents.itemList != null)
                        {
                            for (int index = item.contents.itemList.Count - 1; index >= 0; --index)
                            {
                                Item obj = item.contents.itemList[index];
                                if (obj != null) obj.LoseCondition(num + barrelConditionLoss);
                            }
                        }
                    }
                }
                
                return _lastTarget ? bot.ShotTest(Vector3.Distance(bot.transform.position, _lastTarget.transform.position)) : bot.ShotTest(0f);
            }

            public void ShowArrow(Vector3 pos)
            {
                if(!_config.controls.enableArrowView) return;

                if(!owner.IsAdmin) 
                {
                    owner.SetPlayerFlag(BasePlayer.PlayerFlags.IsAdmin, true);
                    owner.SendNetworkUpdateImmediate();

                    owner.SendConsoleCommand("ddraw.arrow", _config.controls.arrowViewDuration, Color.black, pos + new Vector3(0f, pos.y + 5), pos, 1.5f);
                   
                    owner.SetPlayerFlag(BasePlayer.PlayerFlags.IsAdmin, false);
                    owner.SendNetworkUpdateImmediate();
                }
                else 
                {
                    owner.SendConsoleCommand("ddraw.arrow", _config.controls.arrowViewDuration, Color.black, pos + new Vector3(0f, pos.y + 5), pos, 1.5f);
                }
            }

            public void ShowText(string text)
            {
                if(!_config.controls.showTextOnHit) return;

                if(!owner.IsAdmin) 
                {
                    owner.SetPlayerFlag(BasePlayer.PlayerFlags.IsAdmin, true);
                    owner.SendNetworkUpdateImmediate();

                    owner.SendConsoleCommand("ddraw.text", _config.controls.textViewDuration, Color.white, bot.transform.position + new Vector3(0, 2f, 0), text);
                   
                    owner.SetPlayerFlag(BasePlayer.PlayerFlags.IsAdmin, false);
                    owner.SendNetworkUpdateImmediate();
                }
                else 
                {
                    owner.SendConsoleCommand("ddraw.text", _config.controls.textViewDuration, Color.white, bot.transform.position + new Vector3(0, 2f, 0), text);
                }
            }

            public Item EquipItem(bool needWeapon = false, bool needAxe = false, bool needPickaxe = false, bool needMelee = false, bool needThrowable = false)
            {
                if(needWeapon)
                {
                    List<Item> weapons = new List<Item>();

                    var allItems = new List<Item>();

                    foreach(var item in bot.inventory.containerBelt.itemList) allItems.Add(item);
                    foreach(var item in bot.inventory.containerMain.itemList) allItems.Add(item);

                    foreach(var item in allItems)
                    {
                        if(item.info.category == ItemCategory.Weapon && item.info.shortname != "speargun")
                        {
                            if(item.info.shortname == "bow.hunting" || item.info.shortname == "crossbow" || item.info.shortname == "bow.compound" || item.info.shortname == "legacy.bow" || item.info.shortname == "minicrossbow")
                            {
                                if (plugin.PNPCAddonHunter != null) weapons.Add(item);
                            }
                            else weapons.Add(item);
                        }
                    }
                    
                    if(weapons.Count != 0)
                    {
                        foreach(var weapon in weapons)
                        {
                            if(weapon.isBroken) continue;

                            var held = weapon.GetHeldEntity();

                            if(held != null)
                            {
                                if(held is BaseProjectile)
                                {
                                    var projectile = held as BaseProjectile;

                                    if(projectile.primaryMagazine.contents <= 0)
                                    {
                                        if(!botSetup.infiniteAmmo)
                                        {
                                            projectile.TryReloadMagazine(bot.inventory);

                                            if(projectile.primaryMagazine.contents <= 0)
                                            {
                                                continue;
                                            }
                                            else 
                                            {
                                                int contents = projectile.primaryMagazine.contents;

                                                projectile.ServerReload();
                                                projectile.primaryMagazine.contents = contents;
                                            }
                                        }
                                        else projectile.ServerReload();
                                    }
                                    
                                    var itemSlot = bot.inventory.containerBelt.GetSlot(0);

                                    if(itemSlot != null ? weapon.parent == itemSlot.parent : false)
                                    {
                                        itemSlot.position = weapon.position;

                                        weapon.position = 0;
                                        weapon.MarkDirty();
                                                
                                        itemSlot.MarkDirty();
                                    }
                                    else 
                                    {
                                        weapon.MoveToContainer(bot.inventory.containerBelt, 0, true, true, null, true);
                                    }

                                    bot.UpdateActiveItem(weapon.uid);

                                    return weapon;
                                }
                                else 
                                {
                                    var itemSlot = bot.inventory.containerBelt.GetSlot(0);

                                    if(itemSlot != null ? weapon.parent == itemSlot.parent : false)
                                    {
                                        itemSlot.position = weapon.position;

                                        weapon.position = 0;
                                        weapon.MarkDirty();
                                                
                                        itemSlot.MarkDirty();
                                    }
                                    else 
                                    {
                                        weapon.MoveToContainer(bot.inventory.containerBelt, 0, true, true, null, true);
                                    }

                                    bot.UpdateActiveItem(weapon.uid);

                                    return weapon;
                                }
                            }
                        }
                    }
                }

                if(needAxe)
                {
                    List<Item> axes = new List<Item>();

                    foreach(var item in bot.inventory.containerBelt.itemList)
                    {
                        if(botSetup.gather.toolForTrees.Contains(item.info.shortname)) axes.Add(item);
                    }

                    if(axes.Count != 0)
                    {
                        foreach(var axe in axes)
                        {
                            if(axe.isBroken) continue;

                            if(axe.info.shortname == "chainsaw")
                            {
                                var held = axe.GetHeldEntity();

                                if(held)
                                {
                                    var chainsaw = held.GetComponent<Chainsaw>();

                                    if(chainsaw)
                                    {
                                        if(chainsaw.ammo <= 0)
                                        {
                                            Item ammo;

                                            while (chainsaw.ammo < chainsaw.maxAmmo && (ammo = chainsaw.GetAmmo()) != null && ammo.amount > 0)
                                            {
                                                int amountToConsume = Mathf.Min(chainsaw.maxAmmo - chainsaw.ammo, ammo.amount);
                                                chainsaw.ammo += amountToConsume;
                                                ammo.UseItem(amountToConsume);
                                            }

                                            chainsaw.SendNetworkUpdateImmediate();
                                            ItemManager.DoRemoves();
                                            bot.inventory.ServerUpdate(0.0f);

                                            if(chainsaw.ammo <= 0) return null;
                                        }

                                        chainsaw.SetEngineStatus(true);
                                    }
                                }
                            }

                            if(axe.position != 0)
                            {
                                var itemSlot = bot.inventory.containerBelt.GetSlot(0);
                                
                                if(itemSlot != null) itemSlot.position = axe.position;

                                axe.position = 0;

                                if(itemSlot != null) itemSlot.MarkDirty();
                                axe.MarkDirty();

                                bot.UpdateActiveItem(axe.uid);

                                return axe;
                            }
                            else 
                            {
                                bot.UpdateActiveItem(axe.uid);

                                return axe;
                            }
                        }
                    }
                }

                if(needPickaxe)
                {
                    List<Item> pickaxes = new List<Item>();

                    foreach(var item in bot.inventory.containerBelt.itemList)
                    {
                        if(botSetup.gather.toolForStones.Contains(item.info.shortname))
                        {
                            pickaxes.Add(item);
                        }
                    }

                    if(pickaxes.Count != 0)
                    {
                        foreach(var pickaxe in pickaxes)
                        {
                            if(pickaxe.isBroken) continue;

                            if(pickaxe.position != 0)
                            {
                                var itemSlot = bot.inventory.containerBelt.GetSlot(0);
                                
                                if(itemSlot != null) itemSlot.position = pickaxe.position;

                                pickaxe.position = 0;

                                if(itemSlot != null) itemSlot.MarkDirty();
                                pickaxe.MarkDirty();

                                bot.UpdateActiveItem(pickaxe.uid);

                                return pickaxe;
                            }
                            else 
                            {
                                bot.UpdateActiveItem(pickaxe.uid);

                                return pickaxe;     
                            }
                        }
                    }
                }

                if(needThrowable)
                {
                    List<Item> throwables = new List<Item>();

                    foreach(var item in bot.inventory.containerBelt.itemList)
                    {
                        if(item.info.shortname == "explosive.timed" 
                            || item.info.shortname == "grenade.beancan"
                                || item.info.shortname == "explosive.satchel"
                                    || item.info.shortname == "grenade.f1") throwables.Add(item);
                    }
                    
                    if(throwables.Count != 0)
                    {
                        foreach(var weapon in throwables)
                        {
                            var throwable = weapon.GetHeldEntity().GetComponent<ThrownWeapon>();

                            if(throwable)
                            {
                                var itemSlot = bot.inventory.containerBelt.GetSlot(0);

                                if(itemSlot != null)
                                {
                                    itemSlot.position = weapon.position;
                                }

                                weapon.position = 0;
                                weapon.MarkDirty();
                                        
                                if(itemSlot != null) itemSlot.MarkDirty();

                                bot.UpdateActiveItem(weapon.uid);

                                return weapon;
                            }
                        }
                    }
                }

                return null;
            }

            private void OnDestroy() 
            {
                if(mode != null) Destroy(mode);

                var mounted = bot?.GetMounted();

                if(mounted != null) mounted.SetFlag(BaseEntity.Flags.Busy, false);

                if(bot != null)
                {
                    if(!bot.IsDestroyed) plugin.CallHook("OnPlayerDeath", bot.ToPlayer(), null);
                }

                if(owner != null) 
                {
                    CuiHelper.DestroyUi(owner, "PersonalNPC_ControlPanel");

                    if(botSetup.deathMarker.enableMarker && owner.Connection != null)
                    {
                        DeathMarker marker = new GameObject("Bot Death Marker", typeof(DeathMarker)).GetComponent<DeathMarker>();

                        marker.displayName = botSetup.deathMarker.displayName;
                        marker.radius = botSetup.deathMarker.radius;
                        marker.alpha = botSetup.deathMarker.alpha;
                        marker.refreshRate = 3f;
                        marker.position = _lastPosition;
                        marker.duration = botSetup.deathMarker.duration;
                        marker.player = owner;

                        ColorUtility.TryParseHtmlString($"#{botSetup.deathMarker.main}", out marker.color1);
                        ColorUtility.TryParseHtmlString($"#{botSetup.deathMarker.outline}", out marker.color2);
                    }
                }
            }

            private void SendMsg(string key, string[] args = null) => plugin.Call<string>("SendMsg", owner, key, args);
            private string GetMsg(string key) => plugin.Call<string>("GetMsg", key, owner.UserIDString);

            private bool IsAtClosestNavmeshPoint(Vector3 targetPosition, float maxDistance)
            {
                if (NavMesh.SamplePosition(targetPosition, out NavMeshHit hit, 10f, Navigator.Agent.areaMask))
                {
                    float distanceToClosestPoint = Vector3.Distance(bot.transform.position, hit.position);
                    return distanceToClosestPoint <= maxDistance;
                }
                return false;
            }

            public void SetDestination(Vector3 destination)
            {
                _currentDestination = destination;
                _botNavigator.SetDestination(destination, _navigationSpeed);

                _botNavigator.Resume();
            }

            public void Nullify()
            {
                _currentDestination = new Vector3();
                _lastBarrelTargetPosition = Vector3.zero;
                _lootAllData = null;

                _collectibleTarget = null;
                _dispenserTarget = null;
                _containerTarget = null;
                _barrelTarget = null;
                _corpseTarget = null;
                _lastTarget = null;
                _lastBanTarget = null;
                _itemTarget = null;

                _isIdle = false;
                _isFollowPlayer = false;

                _lastTimeGathered = 0f;
                _lastConditionWhileGather = 0f;
                _recoverTime = botSetup.functions.recoverSetup._recoverTime;

                if (botSetup.functions.enableBuilderAddon && plugin.PNPCAddonBuilder != null) plugin.PNPCAddonBuilder.Call("ResetBuilder", owner);
                if (botSetup.functions.enableHunterAddon && plugin.PNPCAddonHunter != null) plugin.PNPCAddonHunter.Call("StopHunting", bot);
            }
        
            private void RefreshMenu()
            {
                if(IsGUIHidden) return;

                CuiElementContainer container = new CuiElementContainer();

                CuiHelper.DestroyUi(owner, "CP_HealthBar");
                CuiHelper.DestroyUi(owner, "CP_Location_Text");

                container.Add(new CuiElement 
                {
                    Name = "CP_Location_Text",
                    Parent = "CP_InfoPosition",

                    Components = 
                    {
                        new CuiTextComponent 
                        {
                            Text = $"{PersonalNPC.GetGrid(bot.transform.position)}: {Mathf.RoundToInt(Vector3.Distance(bot.transform.position, owner.transform.position))}m",
                            FontSize = 14,
                            Align = TextAnchor.MiddleCenter
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 0", AnchorMax = "1 1"
                        }
                    }
                });

                container.Add(new CuiElement
                {
                    Name = "CP_HealthBar",
                    Parent = "PersonalNPC_ControlPanel",

                    Components = 
                    {
                        new CuiImageComponent
                        {
                            Color = HexToRustFormat("#C5C5C5FF"), Material = (_config.gui.removeUIMaterial ? "Assets/Icons/IconMaterial.mat" : "Assets/Content/UI/UI.Background.Tile.psd")
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 1", AnchorMax = "1 1",
                            OffsetMin = "27 -48", OffsetMax = "-2 -22"  
                        }
                    } 
                });

                container.Add(new CuiElement 
                {
                    Name = "CP_HealthBar_Fill",
                    Parent = "CP_HealthBar",

                    Components = 
                    {
                        new CuiImageComponent
                        {
                            Color = HexToRustFormat(_config.gui.panelHealthColor),
                            Material = (_config.gui.removeUIMaterial ? "Assets/Icons/IconMaterial.mat" : "Assets/Content/UI/UI.Background.Tile.psd")
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 0", AnchorMax = $"{bot.Health() / bot.MaxHealth()} 1",
                            OffsetMin = "0 0", OffsetMax = "0 -0.001"
                        }
                    }
                });

                container.Add(new CuiElement
                {
                    Name = "CP_HealthBar_Text",
                    Parent = "CP_HealthBar",
                    
                    Components = 
                    {
                        new CuiTextComponent
                        {
                            Text = $"{Mathf.RoundToInt(bot.Health())}",
                            Align = TextAnchor.MiddleCenter
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 0", AnchorMax = "1 1",
                            OffsetMin = "-15 0", OffsetMax = "0 0"
                        }
                    }
                });

                CuiHelper.AddUi(owner, container);
            }

            public void RenderMenu(bool ignoreLastTime = false)
            {
                if(_lastTimeGUI + 1 > UnityEngine.Time.realtimeSinceStartup && !ignoreLastTime) return;
                else _lastTimeGUI = UnityEngine.Time.realtimeSinceStartup;

                CuiHelper.DestroyUi(owner, "PersonalNPC_ControlPanel");

                CuiElementContainer container = new CuiElementContainer();

                container.Add(new CuiElement 
                {
                    Name = "PersonalNPC_ControlPanel",
                    Parent = _config.gui.panelLayer,

                    Components = 
                    {
                        new CuiImageComponent
                        {
                            Material = (_config.gui.removeUIMaterial ? "Assets/Icons/IconMaterial.mat" : "Assets/Content/UI/UI.Background.Tile.psd"),
                            Color = HexToRustFormat(_config.gui.panelColor1)
                        },

                        IsGUIHidden ? new CuiRectTransformComponent
                        {
                            AnchorMin = _config.gui.panelPosition.AnchorMin, AnchorMax = _config.gui.panelPosition.AnchorMax,

                            OffsetMin = $"{_config.gui.panelPosition.OffsetMax.Split(' ')[0]} {_config.gui.panelPosition.OffsetMin.Split(' ')[1]}",
                            OffsetMax = _config.gui.panelPosition.OffsetMax
                        } : _config.gui.panelPosition
                    }
                });

                container.Add(new CuiElement()
                {
                    Name = "CP_HideButton",
                    Parent = "PersonalNPC_ControlPanel",

                    Components = 
                    {
                        new CuiButtonComponent
                        {
                            Color = HexToRustFormat(_config.gui.panelColor2),
                            Command = "pnpc hide_panel",
                            Material = (_config.gui.removeUIMaterial ? "Assets/Icons/IconMaterial.mat" : "Assets/Content/UI/UI.Background.Tile.psd"),
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 1", AnchorMax = "0 1",
                            OffsetMin = "-25 -25", OffsetMax = "-5 0"
                        }
                    }
                });

                container.Add(new CuiElement()
                {
                    Name = "CP_HideButton_Text",
                    Parent = "CP_HideButton",

                    Components = 
                    {
                        new CuiTextComponent
                        {
                            FontSize = 20,
                            Text = IsGUIHidden ? "<" : ">",
                            Align = TextAnchor.MiddleCenter
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 0", AnchorMax = "1 1"
                        }
                    }
                });
                
                if(IsGUIHidden)
                {
                    CuiHelper.AddUi(owner, container);

                    return;
                }

                container.Add(new CuiElement 
                {
                    Name = "CP_Header",
                    Parent = "PersonalNPC_ControlPanel",

                    Components = 
                    {
                        new CuiImageComponent 
                        {
                            Color = HexToRustFormat(_config.gui.panelColor2),
                            Material = (_config.gui.removeUIMaterial ? "Assets/Icons/IconMaterial.mat" : "Assets/Content/UI/UI.Background.Tile.psd")
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 1", AnchorMax = "1 1",
                            OffsetMin = "2 -20", OffsetMax = "-2 -2"
                        }
                    }
                });

                container.Add(new CuiElement 
                {
                    Name = "CP_Header_Text",
                    Parent = "CP_Header",

                    Components = 
                    {
                        new CuiTextComponent
                        {
                            FontSize = 14,
                            Text = GetMsg("GUI_Header"),
                            Align = TextAnchor.MiddleCenter
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 0", AnchorMax = "1 1"
                        }
                    }
                });

                container.Add(new CuiElement
                {
                    Name = "CP_HealthBar",
                    Parent = "PersonalNPC_ControlPanel",

                    Components = 
                    {
                        new CuiImageComponent
                        {
                            Color = HexToRustFormat("#C5C5C5FF"), Material = (_config.gui.removeUIMaterial ? "Assets/Icons/IconMaterial.mat" : "Assets/Content/UI/UI.Background.Tile.psd")
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 1", AnchorMax = "1 1",
                            OffsetMin = "27 -48", OffsetMax = "-2 -22"  
                        }
                    } 
                });

                container.Add(new CuiElement 
                {
                    Name = "CP_HealthBar_Fill",
                    Parent = "CP_HealthBar",

                    Components = 
                    {
                        new CuiImageComponent
                        {
                            Color = HexToRustFormat(_config.gui.panelHealthColor),
                            Material = (_config.gui.removeUIMaterial ? "Assets/Icons/IconMaterial.mat" : "Assets/Content/UI/UI.Background.Tile.psd")
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 0", AnchorMax = $"{bot.Health() / bot.MaxHealth()} 1",
                            OffsetMin = "0 0", OffsetMax = "0 -0.001"
                        }
                    }
                });

                container.Add(new CuiElement
                {
                    Name = "CP_HealthBar_Text",
                    Parent = "CP_HealthBar",
                    
                    Components = 
                    {
                        new CuiTextComponent
                        {
                            Text = $"{Mathf.RoundToInt(bot.Health())}",
                            Align = TextAnchor.MiddleCenter
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 0", AnchorMax = "1 1",
                            OffsetMin = "-15 0", OffsetMax = "0 0"
                        }
                    }
                });

                container.Add(new CuiElement 
                {
                    Name = "CP_Status_Bg",
                    Parent = "PersonalNPC_ControlPanel",

                    Components = 
                    {
                        new CuiImageComponent
                        {
                            Material = (_config.gui.removeUIMaterial ? "Assets/Icons/IconMaterial.mat" : "Assets/Content/UI/UI.Background.Tile.psd"),
                            Color = HexToRustFormat(_config.gui.panelColor2)
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 1", AnchorMax = "0 1",
                            OffsetMin = "2 -48", OffsetMax = "25 -22"
                        }
                    }
                });

                container.Add(new CuiElement 
                {
                    Name = "CP_Status_Icon",
                    Parent = "CP_Status_Bg",

                    Components = 
                    {
                        new CuiRawImageComponent 
                        {
                            Color = "1 1 1 1",
                            Png = cachedImages[_statusIcon.ToString()]
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 0", AnchorMax = "1 1",
                            OffsetMin = "3 3", OffsetMax = "-3 -3"
                        }
                    }
                });

                container.Add(new CuiElement 
                {
                    Name = "CP_InfoPosition",
                    Parent = "PersonalNPC_ControlPanel",
                    
                    Components = 
                    {
                        new CuiImageComponent
                        {
                            Color = HexToRustFormat(_config.gui.panelColor2), Material = (_config.gui.removeUIMaterial ? "Assets/Icons/IconMaterial.mat" : "Assets/Content/UI/UI.Background.Tile.psd"),
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 1", AnchorMax = "1 1",
                            OffsetMin = "2 -70", OffsetMax = "-2 -50"
                        }
                    }
                });

                container.Add(new CuiElement 
                {
                    Name = "CP_Location_Text",
                    Parent = "CP_InfoPosition",

                    Components = 
                    {
                        new CuiTextComponent 
                        {
                            Text = $"{PersonalNPC.GetGrid(bot.transform.position)}: {Mathf.RoundToInt(Vector3.Distance(bot.transform.position, owner.transform.position))}m",
                            FontSize = 14,
                            Align = TextAnchor.MiddleCenter
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 0", AnchorMax = "1 1"
                        }
                    }
                });

                container.Add(new CuiElement 
                {
                    Name = "CP_Follow", Parent = "PersonalNPC_ControlPanel",

                    Components = 
                    {
                        new CuiButtonComponent
                        {
                            Color = HexToRustFormat(_config.gui.panelColor2),
                            Command = "pnpc command pnpc follow",
                            Material = (_config.gui.removeUIMaterial ? "Assets/Icons/IconMaterial.mat" : "Assets/Content/UI/UI.Background.Tile.psd"),
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0.5 0", AnchorMax = "0.5 0",
                            OffsetMin = "-78 2", OffsetMax = "-5 22"
                        }
                    }
                });

                container.Add(new CuiElement 
                {
                    Name = "CP_Follow_Text", Parent = "CP_Follow",
                    Components =
                    {
                        new CuiTextComponent
                        {
                            Text = GetMsg("GUI_Follow"),
                            Align = TextAnchor.MiddleCenter,
                            FontSize = 12
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 0", AnchorMax = "1 1"
                        }
                    }
                });

                container.Add(new CuiElement 
                {
                    Name = "CP_Kill", Parent = "PersonalNPC_ControlPanel",
                    Components = 
                    {
                        new CuiButtonComponent
                        {
                            Color = HexToRustFormat("#F02424FF"),
                            Command = (_config.gui.useLocal ? "chat.localsay" : "chat.say") + " /pnpc",
                            Material = (_config.gui.removeUIMaterial ? "Assets/Icons/IconMaterial.mat" : "Assets/Content/UI/UI.Background.Tile.psd"),
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0.5 0", AnchorMax = "0.5 0",
                            OffsetMin = "-3 2", OffsetMax = "40 22"
                        }
                    }
                });

                container.Add(new CuiElement 
                {
                    Name = "CP_Kill_Text", Parent = "CP_Kill",
                    Components = 
                    {
                        new CuiTextComponent
                        {
                            Text = GetMsg("GUI_Kill"),
                            Align = TextAnchor.MiddleCenter,
                            FontSize = 12,
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 0", AnchorMax = "1 1"
                        }
                    }
                });

                container.Add(new CuiElement 
                {
                    Name = "CP_Open", Parent = "PersonalNPC_ControlPanel",
                    Components = 
                    {
                        new CuiButtonComponent
                        {
                            Color = HexToRustFormat(_config.gui.panelColor2),
                            Material = (_config.gui.removeUIMaterial ? "Assets/Icons/IconMaterial.mat" : "Assets/Content/UI/UI.Background.Tile.psd"),
                            Command = "pnpc hierarchy"
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0.5 0", AnchorMax = "0.5 0",
                            OffsetMin = "42 2", OffsetMax = "78 22"
                        }
                    }
                });

                container.Add(new CuiElement 
                {
                    Name = "CP_Open_Icon", Parent = "CP_Open",
                    Components = 
                    {
                        new CuiRawImageComponent
                        {
                            Png = cachedImages["open"]
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 0", AnchorMax = "1 1",
                            OffsetMin = "5 2", OffsetMax = "-5 -2"
                        }
                    }
                });

                CuiHelper.AddUi(owner, container);

                if(_isViewingHierarchy) 
                {
                    _isViewingHierarchy = false;
                    RenderHierarchy();
                }
            }

            public void RenderHierarchy()
            {
                if(_isViewingHierarchy || IsGUIHidden)
                {
                    if(!IsGUIHidden) _isViewingHierarchy = false;

                    CuiHelper.DestroyUi(owner, "CP_Open_Icon");
                    CuiHelper.DestroyUi(owner, "CP_Hierarchy");

                    CuiHelper.AddUi(owner, new List<CuiElement>
                    {
                        new CuiElement 
                        {
                            Name = "CP_Open_Icon", Parent = "CP_Open",
                            Components = 
                            {
                                new CuiRawImageComponent
                                {
                                    Png = cachedImages["open"]
                                },

                                new CuiRectTransformComponent
                                {
                                    AnchorMin = "0 0", AnchorMax = "1 1",
                                    OffsetMin = "5 2", OffsetMax = "-5 -2"
                                }
                            }
                        }
                    });

                    return;
                }

                CuiElementContainer container = new CuiElementContainer();

                container.Add(new CuiElement 
                {
                    Name = "CP_Hierarchy", Parent = "PersonalNPC_ControlPanel",

                    Components = 
                    {
                        new CuiImageComponent {Color = "0 0 0 0"},
                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 0", AnchorMax = "1 0",
                            OffsetMin = "0 0", OffsetMax = "0 0"
                        }
                    }
                });

                for(int i = 0; i < _config.gui.accessButtons.Count; i++)
                {
                    var button = _config.gui.accessButtons[i];
                    
                    container.Add(new CuiElement 
                    {
                        Name = $"CP_Hierarchy_Element{i}", Parent = "CP_Hierarchy",
                        Components = 
                        {
                            new CuiButtonComponent 
                            {
                                Command = $"pnpc {i}",
                                Color = HexToRustFormat(_config.gui.panelColor2),
                                Material = (_config.gui.removeUIMaterial ? "Assets/Icons/IconMaterial.mat" : "Assets/Content/UI/UI.Background.Tile.psd"),
                            },

                            new CuiRectTransformComponent
                            {
                                AnchorMin = "0 1", AnchorMax = "1 1",
                                OffsetMin = $"0 {-25 * (i + 1)}", OffsetMax = $"0 {-5 - (25 * i)}"
                            }
                        }
                    });

                    container.Add(new CuiElement 
                    {
                        Name = $"CP_Hierarchy_Element{i}_Text", Parent = $"CP_Hierarchy_Element{i}",
                        Components = 
                        {
                            new CuiTextComponent 
                            {
                                Text = button.text,
                                Align = TextAnchor.MiddleCenter,
                                FontSize = 13
                            },

                            new CuiRectTransformComponent
                            {
                                AnchorMin = "0 0", AnchorMax = "1 1"
                            }
                        }
                    });
                }

                _isViewingHierarchy = true;

                container.Add(new CuiElement 
                {
                    Name = "CP_Open_Icon", Parent = "CP_Open",
                    Components = 
                    {
                        new CuiRawImageComponent
                        {
                            Png = cachedImages["close"]
                        },

                        new CuiRectTransformComponent
                        {
                            AnchorMin = "0 0", AnchorMax = "1 1",
                            OffsetMin = "5 2", OffsetMax = "-5 -2"
                        }
                    }
                });

                CuiHelper.DestroyUi(owner, "CP_Open_Icon");
                CuiHelper.AddUi(owner, container);
            }
        
            public void RenderIcon()
            {
                if(IsGUIHidden) return;

                if(_lastRenderedIcon == _statusIcon) return;
                else _lastRenderedIcon = _statusIcon;

                CuiHelper.DestroyUi(owner, "CP_Status_Icon");

                CuiHelper.AddUi(owner, new List<CuiElement>
                {
                    new CuiElement 
                    {
                        Name = "CP_Status_Icon",
                        Parent = "CP_Status_Bg",

                        Components = 
                        {
                            new CuiRawImageComponent 
                            {
                                Color = "1 1 1 1",
                                Png = cachedImages[_statusIcon.ToString()]
                            },

                            new CuiRectTransformComponent
                            {
                                AnchorMin = "0 0", AnchorMax = "1 1",
                                OffsetMin = "3 3", OffsetMax = "-3 -3"
                            }
                        }
                    }
                });
            }
        }

        public class OnControllerCreatedEvent : UnityEvent<PlayerBotController> {}

        public class DistanceComparer : IComparer<BaseEntity>
        {
            private BaseEntity target;
            public DistanceComparer(BaseEntity distanceToTarget) { target = distanceToTarget; }
    
            public int Compare(BaseEntity a, BaseEntity b) => Vector3.Distance(a.transform.position, target.transform.position).CompareTo(Vector3.Distance(b.transform.position, target.transform.position));
        }

        public class DeathMarker : MonoBehaviour
        {
            private const string genericPrefab = "assets/prefabs/tools/map/genericradiusmarker.prefab";
            private const string vendingPrefab = "assets/prefabs/deployable/vendingmachine/vending_mapmarker.prefab";
        
            private VendingMachineMapMarker vending;
            private MapMarkerGenericRadius generic;

            public float radius, alpha, refreshRate;
            public Color color1, color2;
            public string displayName;
            public Vector3 position;
            public int duration;

            public BasePlayer player;

            private void Start()
            {
                transform.position = position;

                vending = GameManager.server.CreateEntity(vendingPrefab, position)?.GetComponent<VendingMachineMapMarker>();
                if(vending == null) return;
                
                vending.markerShopName = displayName;
                vending.enableSaving = false;
                vending.limitNetworking = true;
                vending.Spawn();

                generic = GameManager.server.CreateEntity(genericPrefab)?.GetComponent<MapMarkerGenericRadius>();
                
                if(generic == null) 
                {
                    vending.Kill();
                    return;
                }
                
                generic.color1 = color1;
                generic.color2 = color2;
                generic.radius = radius;
                generic.alpha = alpha;
                generic.enableSaving = false;
                generic.limitNetworking = true;
                generic.SetParent(vending);
                generic.Spawn();

                if (duration != 0) Invoke(nameof(DestroyMakers), duration);
                if (refreshRate > 0f) InvokeRepeating(nameof(UpdateMarkers), refreshRate, refreshRate);

                vending.SendAsSnapshot(player.Connection, true);
                generic.SendAsSnapshot(player.Connection, true);

                UpdateMarkers();
            }

            public void UpdateMarkers()
            {
                vending.SendNetworkUpdate();
                generic.SendUpdate();
            }

            private void DestroyMakers()
            {
                if (vending.IsValid()) vending.Kill();
                if (generic.IsValid()) generic.Kill();

                Destroy(gameObject);
            }

            private void OnDestroy() 
            {
                if (vending.IsValid()) vending.Kill();
                if (generic.IsValid()) generic.Kill();
            }
        }

        #endregion
    
        #region API

        private bool HasBot(BasePlayer player) 
        {
            if(player == null || player.net == null) return false;

            return GetController(player.net.ID.Value) != null;
        }

        private bool IsPersonalNPC(BasePlayer player)
        {
            if(player == null || player.net == null) return false;

            var ownerComp = GetOwnerComponent(player.net.ID.Value);

            if(ownerComp != null)
            {
                if(ownerComp.controller != null)
                {
                    return true;
                }
            }

            return false;
        }

        #endregion
    
        #region HelperClasses
        public class CollectibleHelper
        {
            public static CollectibleHelper Instance;
            private readonly HashSet<BaseEntity> _collectibleEntities;

            private CollectibleHelper()
            {
                try
                {
                    _collectibleEntities = new(System.Linq.Enumerable.OfType<CollectibleEntity>(BaseNetworkable.serverEntities));
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
    }
}
namespace Oxide.Plugins.PersonalNPCex
{
    public static class PersonalNPCex
    {
        public static int Count<TSource>(this IEnumerable<TSource> source)
        {
            if (source == null)
            {
                throw Error.ArgumentNull("source");
            }

            if (source is ICollection<TSource> collection)
            {
                return collection.Count;
            }

            if (source is ICollection collection2)
            {
                return collection2.Count;
            }

            int num = 0;
            using IEnumerator<TSource> enumerator = source.GetEnumerator();
            while (enumerator.MoveNext())
            {
                num = checked(num + 1);
            }

            return num;
        }
        public static IEnumerable<TResult> OfType<TResult>(this IEnumerable source)
        {
            if (source == null)
            {
                throw Error.ArgumentNull("source");
            }

            return OfTypeIterator<TResult>(source);
        }
        private static IEnumerable<TResult> OfTypeIterator<TResult>(IEnumerable source)
        {
            foreach (object item in source)
            {
                if (item is TResult)
                {
                    yield return (TResult)item;
                }
            }
        }

        internal static class Error
        {
            internal static Exception ArgumentNull(string s)
            {
                return new ArgumentNullException(s);
            }
            internal static Exception NoElements()
            {
                return new InvalidOperationException("Sequence contains no elements");
            }
            internal static Exception OutOfRange()
            {
                return new InvalidOperationException("index out of range");
            }
        }
    }
} 