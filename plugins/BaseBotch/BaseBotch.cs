// BaseBotch — automation helpers for RustMaxx bots (water wheel mount, etc.).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using Facepunch;
using Oxide.Core;
using Oxide.Core.Plugins;
using Rust;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("BaseBotch", "RustMaxx", "1.5.4")]
    [Description("Base automation: water wheel mount/autorun, and NPC mixing-table crafting (pulls ingredients from anchor-owned storage).")]
    public class BaseBotch : RustPlugin
    {
        [PluginReference] private Plugin RoamingNPCs;

        private ConfigData _cfg;
        private readonly HashSet<ulong> _autorunNpcNetIds = new();
        private readonly Dictionary<ulong, ulong> _npcToTrackedMountNetId = new();
        private readonly Dictionary<ulong, WheelRestoreState> _wheelRestorePending = new();
        /// <summary>Mount net ID → components touched for power reflection (built once per mount).</summary>
        private readonly Dictionary<ulong, Component[]> _wheelBumpComponentCache = new();
        private readonly Dictionary<ulong, bool> _wheelComponentDumped = new();
        private readonly Dictionary<ulong, bool> _wheelMemberDumped = new();
        private readonly Dictionary<ulong, bool> _wheelMountedSyncEnabled = new();
        private Timer _autorunTimer;
        private Timer _mixingPollTimer;

        private readonly Dictionary<ulong, MixingStationSession> _mixingByNpcNetId = new();
        private readonly Dictionary<ulong, MixingRestoreState> _mixingRestorePending = new();
        private static bool _mixingStartMixLoggedFail;

        private sealed class MixingStationSession
        {
            public ulong TableNetId;
            public string RecipeId;
            public ulong AnchorSteam;
        }

        private sealed class MixingRestoreState
        {
            public string TaskKeyword;
            public ulong AnchorSteam;
        }

        private sealed class MixingIngredientCfg
        {
            public string ShortName = "";
            public int Amount = 1;
        }

        private sealed class MixingRecipeCfg
        {
            public string DisplayName = "";
            public List<MixingIngredientCfg> Ingredients = new();
        }

        private sealed class WheelRestoreState
        {
            public string TaskKeyword;
            public ulong AnchorSteam;

            /// <summary>False when only navigator snapshot (e.g. StartWaterWheelAutorun without MountWaterWheelFromLook).</summary>
            public bool SnapshotBridgeTask = true;

            public bool? PriorCanNavigateMounted;
        }

        private static Type _cachedInputMessageType;
        private static PropertyInfo _cachedInputStateCurrentProp;
        private static FieldInfo _cachedInputStateCurrentField;
        private static PropertyInfo _cachedInputStatePreviousProp;
        private static FieldInfo _cachedInputStatePreviousField;
        private static int _autorunTickPhase;
        private readonly Dictionary<ulong, float> _nextAutorunDebugAt = new();
        private readonly Dictionary<ulong, float> _nextWheelSignalDebugAt = new();
        private readonly Dictionary<ulong, float> _nextWheelPublishDebugAt = new();
        private readonly Dictionary<ulong, float> _nextWheelPublishErrorDebugAt = new();

        private sealed class ConfigData
        {
            public float LookRayDistanceMeters = 8f;
            public string WaterWheelPrefabSubstring = "waterwheel";
            public bool AutorunAfterMount = true;
            public float AutorunTickSeconds = 0.02f;
            public bool AutorunUseSprint = true;
            public bool AutorunUseUseButton = true;
            public bool AutorunDoubleApplyNextTick = true;

            /// <summary>If serverInput is missing or current is null, try reflection to find InputState / InputMessage (NPC builds vary).</summary>
            public bool AutorunTryReflectionInput = true;

            /// <summary>Experimental: nudge float fields on wheel/generator parents (names containing Power/Output/Energy).</summary>
            public bool AutorunTryWheelPowerReflection = true;

            /// <summary>Extra BUTTON bits OR'd each tick (0 = default). Use only if you know your build's mask.</summary>
            public int AutorunExtraButtonMask = 0;

            /// <summary>When true, still run NextTick double-apply even if button write failed (helps power reflection + retries).</summary>
            public bool AutorunDoubleApplyWhenButtonsFail = true;

            public bool AutorunSendNetworkUpdateImmediate = true;
            public bool AutorunInvokePlayerServerInput = true;

            /// <summary>Before mounting, snapshot bridge task and set RoamingNPCs task to idle so pathing does not fight the wheel.</summary>
            public bool PauseRoamingAiWhileOnWheel = true;

            /// <summary>Match PersonalNPC vehicle mount: set modelState.mounted / poseType from mountPose and flush network.</summary>
            public bool SyncModelStateAfterWheelMount = true;

            /// <summary>Roaming NPCs use NPCPlayerNavigator; pathing can fight wheel input. Capture/restore CanNavigateMounted and Stop() while autorunning.</summary>
            public bool TameNavigatorWhileOnWheel = true;

            /// <summary>Value applied to NPCPlayerNavigator.CanNavigateMounted while on wheel (usually true so mounted locomotion can run).</summary>
            public bool WheelSessionCanNavigateMounted = true;

            /// <summary>When true, logs throttled autorun diagnostics (write failures, mount/navigator state).</summary>
            public bool DebugWheelAutorun = false;

            /// <summary>Invoke wheel-specific methods via reflection (experimental; can be disabled if mounts drop).</summary>
            public bool AutorunInvokeWheelMethods = false;

            // --- Mixing table (NPC workstation) ---
            public float MixingLookRayDistanceMeters = 6f;

            /// <summary>MaxxInvaders GUI: assign to nearest mixing table within this radius of the player (no look ray).</summary>
            public float MixingNearPlayerAssignRadiusMeters = 12f;
            public float MixingPollSeconds = 2.25f;
            public bool MixingPauseRoamingAi = true;
            public bool MixingTeleportNpcToStand = true;
            public float MixingStandOffsetMeters = 1.15f;
            public bool MixingDebugReflection = false;

            /// <summary>Pull missing recipe mats from boxes/cupboards/furnaces with <see cref="BaseEntity.OwnerID"/> = streamer Steam ID (same as MaxxInvaders deposit).</summary>
            public bool MixingPullFromAnchorStorage = true;

            public float MixingIngredientSearchRadiusMeters = 24f;

            /// <summary>Max deployables scanned per pull (performance).</summary>
            public int MixingIngredientSearchMaxEntities = 96;

            /// <summary>Recipe id → ordered ingredients (slot order matters on the table).</summary>
            public Dictionary<string, MixingRecipeCfg> MixingRecipes = new()
            {
                ["lowgrade_fuel"] = new MixingRecipeCfg
                {
                    DisplayName = "Low grade fuel",
                    Ingredients = new List<MixingIngredientCfg>
                    {
                        new() { ShortName = "fat.animal", Amount = 3 },
                        new() { ShortName = "cloth", Amount = 1 },
                    },
                },
            };
        }

        protected override void LoadDefaultConfig()
        {
            Config.WriteObject(new ConfigData(), true);
        }

        private void Init()
        {
            _cfg = Config.ReadObject<ConfigData>();
            if (_cfg == null)
            {
                LoadDefaultConfig();
                _cfg = Config.ReadObject<ConfigData>() ?? new ConfigData();
            }

            // Persist newly added keys into existing config files so admins can see/tune them.
            Config.WriteObject(_cfg, true);
        }

        private void OnServerInitialized()
        {
            CacheReflectionTypes();
            if (_autorunTimer != null && !_autorunTimer.Destroyed)
                _autorunTimer.Destroy();
            var interval = Mathf.Clamp(_cfg.AutorunTickSeconds, 0.01f, 0.25f);
            _autorunTimer = timer.Every(interval, AutorunTick);
            if (_mixingPollTimer != null && !_mixingPollTimer.Destroyed)
                _mixingPollTimer.Destroy();
            var mixIv = Mathf.Clamp(_cfg.MixingPollSeconds, 0.75f, 10f);
            _mixingPollTimer = timer.Every(mixIv, MixingStationPollTick);
        }

        private void CacheReflectionTypes()
        {
            try
            {
                var asm = typeof(BasePlayer).Assembly;
                _cachedInputMessageType = asm.GetType("Rust.InputMessage") ?? asm.GetType("InputMessage");
                if (_cachedInputMessageType == null)
                {
                    try
                    {
                        _cachedInputMessageType = asm.GetTypes().FirstOrDefault(t => t.Name == "InputMessage");
                    }
                    catch
                    {
                        // ReflectionTypeLoadException on some hosts
                    }
                }

                var ist = typeof(InputState);
                _cachedInputStateCurrentProp = ist.GetProperty(
                    "current",
                    BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                _cachedInputStateCurrentField = ist.GetField(
                    "current",
                    BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                _cachedInputStatePreviousProp = ist.GetProperty(
                    "previous",
                    BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                _cachedInputStatePreviousField = ist.GetField(
                    "previous",
                    BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            }
            catch
            {
                // ignored
            }
        }

        private void Unload()
        {
            _autorunNpcNetIds?.Clear();
            _npcToTrackedMountNetId?.Clear();
            _wheelRestorePending?.Clear();
            _wheelBumpComponentCache?.Clear();
            _wheelComponentDumped?.Clear();
            _wheelMemberDumped?.Clear();
            _wheelMountedSyncEnabled?.Clear();
            _nextAutorunDebugAt?.Clear();
            _nextWheelSignalDebugAt?.Clear();
            _nextWheelPublishDebugAt?.Clear();
            _nextWheelPublishErrorDebugAt?.Clear();
            if (_autorunTimer != null && !_autorunTimer.Destroyed)
                _autorunTimer.Destroy();
            _autorunTimer = null;
        }

        private void OnEntityKill(BaseNetworkable entity)
        {
            if (entity is BasePlayer bp && bp.net != null)
            {
                var id = bp.net.ID.Value;
                if (_npcToTrackedMountNetId.TryGetValue(id, out var mountId))
                {
                    _wheelBumpComponentCache.Remove(mountId);
                    _wheelComponentDumped.Remove(mountId);
                    _wheelMemberDumped.Remove(mountId);
                    _wheelMountedSyncEnabled.Remove(mountId);
                    _nextWheelPublishDebugAt.Remove(mountId);
                    _nextWheelPublishErrorDebugAt.Remove(mountId);
                }
                _autorunNpcNetIds.Remove(id);
                _npcToTrackedMountNetId.Remove(id);
                TryRestoreWheelRoamTask(id);
                StopMixingSessionInternal(id, restoreRoam: true, issuer: null);
            }

            if (entity is MixingTable mt && mt.net != null)
                RemoveMixingSessionsForTable(mt.net.ID.Value);
        }

        private void AutorunTick()
        {
            if (_autorunNpcNetIds.Count == 0) return;
            var copy = new List<ulong>(_autorunNpcNetIds);
            foreach (var id in copy)
                ApplyAutorunInput(id, true);
        }

        private void ApplyAutorunInput(ulong npcNetId, bool scheduleDoubleApply)
        {
            var npc = BaseNetworkable.serverEntities.Find(new NetworkableId(npcNetId)) as BasePlayer;
            if (npc == null || npc.IsDestroyed)
            {
                _autorunNpcNetIds.Remove(npcNetId);
                _npcToTrackedMountNetId.Remove(npcNetId);
                TryRestoreWheelRoamTask(npcNetId);
                return;
            }

            if (!npc.isMounted)
            {
                _autorunNpcNetIds.Remove(npcNetId);
                _npcToTrackedMountNetId.Remove(npcNetId);
                TryRestoreWheelRoamTask(npcNetId);
                return;
            }

            var m = npc.GetMounted();
            if (m == null || m.net == null)
            {
                _autorunNpcNetIds.Remove(npcNetId);
                _npcToTrackedMountNetId.Remove(npcNetId);
                TryRestoreWheelRoamTask(npcNetId);
                return;
            }

            if (_npcToTrackedMountNetId.TryGetValue(npcNetId, out var expectedMountId))
            {
                if (m.net.ID.Value != expectedMountId)
                {
                    _autorunNpcNetIds.Remove(npcNetId);
                    _npcToTrackedMountNetId.Remove(npcNetId);
                    TryRestoreWheelRoamTask(npcNetId);
                    return;
                }
            }
            else if (!PrefabChainLooksLikeWaterWheel(m))
            {
                _autorunNpcNetIds.Remove(npcNetId);
                return;
            }

            TryStifleNavigatorWhileAutorunning(npc);

            var wrote = TryWriteMovementButtons(npc);
            TryForceMovementModelState(npc);
            if (_cfg.DebugWheelAutorun)
                EnsureWheelDebugDumpForMounted(npc);
            if (_cfg.AutorunTryWheelPowerReflection)
                TryBumpWheelPowerViaReflection(npc);

            TryInvokeInputFlush(npc, _cfg);

            if (_cfg.DebugWheelAutorun)
                TryLogAutorunDebug(npc, m, wrote);

            if (!wrote && !_cfg.AutorunDoubleApplyWhenButtonsFail)
                return;

            if (scheduleDoubleApply && _cfg.AutorunDoubleApplyNextTick && (wrote || _cfg.AutorunDoubleApplyWhenButtonsFail))
            {
                var nid = npcNetId;
                NextTick(() =>
                {
                    if (!_autorunNpcNetIds.Contains(nid)) return;
                    ApplyAutorunInput(nid, false);
                });
            }
        }

        private bool TryWriteMovementButtons(BasePlayer npc)
        {
            if (TryWriteServerInputButtons(npc))
                return true;
            if (_cfg.AutorunTryReflectionInput && TryWriteButtonsViaReflection(npc))
                return true;
            return false;
        }

        private bool TryWriteServerInputButtons(BasePlayer npc)
        {
            var inp = npc.serverInput;
            if (inp == null) return false;
            if (inp.current == null && !TryEnsureInputCurrent(inp))
                return false;
            if (inp.current == null) return false;
            TryEnsureInputPrevious(inp);

            ApplyMovementMaskToInputState(inp);
            npc.SendNetworkUpdate();
            return true;
        }

        private void ApplyMovementMaskToInputState(InputState inp)
        {
            if (inp?.current == null) return;
            _autorunTickPhase++;
            var mask = (int)BUTTON.FORWARD;
            if (_cfg.AutorunUseSprint)
                mask |= (int)BUTTON.SPRINT;
            if (_cfg.AutorunUseUseButton)
                mask |= (int)BUTTON.USE;
            // Hamster wheel: alternate strafe so locomotion isn't treated as pure forward-only in some builds.
            mask |= (_autorunTickPhase & 1) == 0 ? (int)BUTTON.LEFT : (int)BUTTON.RIGHT;
            mask |= _cfg.AutorunExtraButtonMask;
            inp.current.buttons |= mask;
            TrySetInputMessageMouseDeltaReflection(inp.current);
            if (inp.previous != null)
            {
                inp.previous.buttons |= mask;
                TrySetInputMessageMouseDeltaReflection(inp.previous);
            }
        }

        private bool TryEnsureInputCurrent(InputState inp)
        {
            if (inp?.current != null) return true;
            if (_cachedInputMessageType == null) return false;
            if (_cachedInputStateCurrentProp == null && _cachedInputStateCurrentField == null) return false;
            try
            {
                var msg = Activator.CreateInstance(_cachedInputMessageType);
                if (_cachedInputStateCurrentProp != null)
                    _cachedInputStateCurrentProp.SetValue(inp, msg);
                else if (_cachedInputStateCurrentField != null)
                    _cachedInputStateCurrentField.SetValue(inp, msg);
                else
                    return false;
                return inp.current != null;
            }
            catch
            {
                return false;
            }
        }

        private void TryEnsureInputPrevious(InputState inp)
        {
            if (inp == null || inp.previous != null) return;
            if (_cachedInputMessageType == null) return;
            if (_cachedInputStatePreviousProp == null && _cachedInputStatePreviousField == null) return;
            try
            {
                var msg = Activator.CreateInstance(_cachedInputMessageType);
                if (_cachedInputStatePreviousProp != null)
                    _cachedInputStatePreviousProp.SetValue(inp, msg);
                else if (_cachedInputStatePreviousField != null)
                    _cachedInputStatePreviousField.SetValue(inp, msg);
            }
            catch
            {
                // ignored
            }
        }

        private static void TrySetInputMessageMouseDeltaReflection(object inputMessage)
        {
            if (inputMessage == null) return;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            try
            {
                foreach (var f in inputMessage.GetType().GetFields(bf))
                {
                    if (f.FieldType != typeof(Vector2)) continue;
                    var n = f.Name;
                    if (n.IndexOf("mouse", StringComparison.OrdinalIgnoreCase) < 0 &&
                        n.IndexOf("delta", StringComparison.OrdinalIgnoreCase) < 0)
                        continue;
                    f.SetValue(inputMessage, new Vector2(2f, 0f));
                }
            }
            catch
            {
                // ignored
            }
        }

        private bool TryWriteButtonsViaReflection(BasePlayer npc)
        {
            if (npc == null) return false;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            foreach (var name in new[] { "serverInput", "ServerInput", "userInput", "UserInput", "playerInput", "PlayerInput" })
            {
                object stateObj = null;
                var prop = typeof(BasePlayer).GetProperty(name, bf);
                if (prop != null) stateObj = prop.GetValue(npc);
                if (stateObj == null)
                {
                    var field = typeof(BasePlayer).GetField(name, bf);
                    if (field != null) stateObj = field.GetValue(npc);
                }

                if (stateObj is not InputState alt) continue;
                if (alt.current == null && !TryEnsureInputCurrent(alt)) continue;
                if (alt.current == null) continue;
                TryEnsureInputPrevious(alt);
                ApplyMovementMaskToInputState(alt);
                npc.SendNetworkUpdate();
                return true;
            }

            for (var t = npc.GetType(); t != null && t != typeof(object); t = t.BaseType)
            {
                foreach (var field in t.GetFields(bf))
                {
                    if (field.FieldType != typeof(InputState)) continue;
                    if (field.GetValue(npc) is not InputState alt) continue;
                    if (alt.current == null && !TryEnsureInputCurrent(alt)) continue;
                    if (alt.current == null) continue;
                    TryEnsureInputPrevious(alt);
                    ApplyMovementMaskToInputState(alt);
                    npc.SendNetworkUpdate();
                    return true;
                }

                foreach (var prop in t.GetProperties(bf))
                {
                    if (prop.PropertyType != typeof(InputState) || !prop.CanRead || !prop.CanWrite) continue;
                    if (prop.GetValue(npc) is not InputState alt) continue;
                    if (alt.current == null && !TryEnsureInputCurrent(alt)) continue;
                    if (alt.current == null) continue;
                    TryEnsureInputPrevious(alt);
                    ApplyMovementMaskToInputState(alt);
                    npc.SendNetworkUpdate();
                    return true;
                }
            }

            return false;
        }

        private static void TryInvokeInputFlush(BasePlayer npc, ConfigData cfg)
        {
            if (npc == null || cfg == null) return;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            try
            {
                if (cfg.AutorunSendNetworkUpdateImmediate)
                {
                    foreach (var m in typeof(BaseNetworkable).GetMethods(bf))
                    {
                        if (m.Name != "SendNetworkUpdateImmediate" || m.GetParameters().Length != 0) continue;
                        m.Invoke(npc, null);
                        break;
                    }
                }

                if (cfg.AutorunInvokePlayerServerInput)
                {
                    foreach (var m in typeof(BasePlayer).GetMethods(bf))
                    {
                        if (m.Name != "PlayerServerInput" || m.GetParameters().Length != 0) continue;
                        m.Invoke(npc, null);
                        break;
                    }
                }
            }
            catch
            {
                // ignored
            }
        }

        /// <summary>Best-effort: nudge generator-related floats / one-arg float methods on wheel prefab hierarchy.</summary>
        private void TryBumpWheelPowerViaReflection(BasePlayer npc)
        {
            var m = npc?.GetMounted();
            if (m == null || m.net == null) return;
            var mountId = m.net.ID.Value;
            if (!_wheelBumpComponentCache.TryGetValue(mountId, out var comps) || comps == null)
            {
                comps = BuildWheelBumpComponentCache(m);
                _wheelBumpComponentCache[mountId] = comps;
            }

            if (_cfg.DebugWheelAutorun && !_wheelComponentDumped.ContainsKey(mountId))
            {
                _wheelComponentDumped[mountId] = true;
                DumpWheelComponentsForDebug(mountId, comps);
            }
            if (_cfg.DebugWheelAutorun && !_wheelMemberDumped.ContainsKey(mountId))
            {
                _wheelMemberDumped[mountId] = true;
                DumpElectricWheelMembersForDebug(mountId, comps);
            }
            if (!_wheelMountedSyncEnabled.ContainsKey(mountId))
            {
                TryEnableMountedPlayerSync(comps);
                _wheelMountedSyncEnabled[mountId] = true;
            }

            foreach (var comp in comps)
            {
                BumpWheelComponentFieldsAndMethods(comp, npc);
                if (_cfg.DebugWheelAutorun)
                    TryLogWheelSignalValues(comp, npc, mountId);
            }
        }

        private void EnsureWheelDebugDumpForMounted(BasePlayer npc)
        {
            var m = npc?.GetMounted();
            if (m == null || m.net == null) return;
            var mountId = m.net.ID.Value;
            if (_wheelComponentDumped.ContainsKey(mountId) && _wheelMemberDumped.ContainsKey(mountId)) return;
            var comps = BuildWheelBumpComponentCache(m);
            if (!_wheelComponentDumped.ContainsKey(mountId))
            {
                _wheelComponentDumped[mountId] = true;
                DumpWheelComponentsForDebug(mountId, comps);
            }
            if (!_wheelMemberDumped.ContainsKey(mountId))
            {
                _wheelMemberDumped[mountId] = true;
                DumpElectricWheelMembersForDebug(mountId, comps);
            }
        }

        private void TryLogWheelSignalValues(Component comp, BasePlayer npc, ulong mountId)
        {
            if (comp == null || npc == null) return;
            var now = Time.realtimeSinceStartup;
            if (_nextWheelSignalDebugAt.TryGetValue(mountId, out var nextAt) && now < nextAt) return;
            _nextWheelSignalDebugAt[mountId] = now + 4f;

            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            try
            {
                var tn = comp.GetType().Name;
                if (tn.IndexOf("WaterWheelMountable", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    object mounted = null;
                    var m = comp.GetType().GetMethod("PlayerIsMounted", bf);
                    if (m != null && m.GetParameters().Length == 1)
                        mounted = m.Invoke(comp, new object[] { npc });
                    Puts($"[BaseBotch][debug] wheelSignal mount={mountId} type={tn} PlayerIsMounted={mounted ?? "n/a"}");
                }
                else if (tn.IndexOf("ElectricWaterWheel", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    object maxOut = null;
                    object isPowered = null;
                    object currentEnergy = null;
                    object shouldUpdateOutputs = null;
                    object inCount = null;
                    object outCount = null;
                    object hasConn = null;
                    var m = comp.GetType().GetMethod("MaximalPowerOutput", bf, null, Type.EmptyTypes, null);
                    if (m != null) maxOut = m.Invoke(comp, null);
                    var mPowered = comp.GetType().GetMethod("IsPowered", bf, null, Type.EmptyTypes, null);
                    if (mPowered != null) isPowered = mPowered.Invoke(comp, null);
                    var mEnergy = comp.GetType().GetMethod("GetCurrentEnergy", bf, null, Type.EmptyTypes, null);
                    if (mEnergy != null) currentEnergy = mEnergy.Invoke(comp, null);
                    var mShould = comp.GetType().GetMethod("ShouldUpdateOutputs", bf, null, Type.EmptyTypes, null);
                    if (mShould != null) shouldUpdateOutputs = mShould.Invoke(comp, null);
                    var mIn = comp.GetType().GetMethod("GetConnectedInputCount", bf, null, Type.EmptyTypes, null);
                    if (mIn != null) inCount = mIn.Invoke(comp, null);
                    var mOut = comp.GetType().GetMethod("GetConnectedOutputCount", bf, null, Type.EmptyTypes, null);
                    if (mOut != null) outCount = mOut.Invoke(comp, null);
                    var mHas = comp.GetType().GetMethod("HasConnections", bf, null, Type.EmptyTypes, null);
                    if (mHas != null) hasConn = mHas.Invoke(comp, null);
                    Puts($"[BaseBotch][debug] wheelSignal mount={mountId} type={tn} MaximalPowerOutput={maxOut ?? "n/a"} IsPowered={isPowered ?? "n/a"} CurrentEnergy={currentEnergy ?? "n/a"} ShouldUpdateOutputs={shouldUpdateOutputs ?? "n/a"}");
                    Puts($"[BaseBotch][debug] wheelIo mount={mountId} inputs={inCount ?? "n/a"} outputs={outCount ?? "n/a"} hasConnections={hasConn ?? "n/a"}");
                }
            }
            catch
            {
                // ignored
            }
        }

        private static void TryEnableMountedPlayerSync(Component[] comps)
        {
            if (comps == null) return;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            foreach (var c in comps)
            {
                if (c == null) continue;
                var tn = c.GetType().Name;
                if (tn.IndexOf("WaterWheelMountable", StringComparison.OrdinalIgnoreCase) < 0) continue;
                try
                {
                    var syncField = c.GetType().GetField("syncsMountedPlayers", bf);
                    if (syncField != null && syncField.FieldType == typeof(bool))
                        syncField.SetValue(c, true);
                    var m = c.GetType().GetMethod("EnableMountedPlayerSync", bf, null, Type.EmptyTypes, null);
                    m?.Invoke(c, null);
                }
                catch
                {
                    // ignored
                }
            }
        }

        private Component[] BuildWheelBumpComponentCache(BaseMountable mount)
        {
            var sub = _cfg.WaterWheelPrefabSubstring ?? "waterwheel";
            var set = new HashSet<Component>();
            for (var ent = mount as BaseEntity; ent != null; ent = ent.GetParentEntity())
            {
                var pn = ent.PrefabName ?? "";
                var prefabMatch = pn.IndexOf(sub, StringComparison.OrdinalIgnoreCase) >= 0;
                foreach (var comp in ent.GetComponentsInChildren<Component>(true))
                {
                    if (comp == null) continue;
                    if (prefabMatch || ComponentTypeLooksWheelRelated(comp.GetType().Name))
                        set.Add(comp);
                }
            }

            // Prefab substring mismatch (config): still collect mount hierarchy so power-field reflection can run once.
            if (set.Count == 0)
            {
                for (var ent = mount as BaseEntity; ent != null; ent = ent.GetParentEntity())
                {
                    foreach (var comp in ent.GetComponentsInChildren<Component>(true))
                    {
                        if (comp != null) set.Add(comp);
                    }
                }
            }

            var arr = new Component[set.Count];
            var i = 0;
            foreach (var c in set)
                arr[i++] = c;
            return arr;
        }

        private void BumpWheelComponentFieldsAndMethods(Component comp, BasePlayer npc)
        {
            if (comp == null) return;
            var tn = comp.GetType().Name;
            var scanAll = ComponentTypeLooksWheelRelated(tn) || tn.IndexOf("IOEntity", StringComparison.OrdinalIgnoreCase) >= 0;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            foreach (var f in comp.GetType().GetFields(bf))
            {
                if (f.FieldType != typeof(float) && f.FieldType != typeof(double)) continue;
                if (!FieldNameLooksLikePowerSignal(f.Name)) continue;
                try
                {
                    if (f.FieldType == typeof(float))
                    {
                        var v = (float)f.GetValue(comp);
                        f.SetValue(comp, Mathf.Clamp(v + 3f, 0f, 500f));
                    }
                    else
                    {
                        var v = (double)f.GetValue(comp);
                        f.SetValue(comp, v + 3.0);
                    }
                }
                catch
                {
                    // ignored
                }
            }

            foreach (var p in comp.GetType().GetProperties(bf))
            {
                if (!p.CanRead || !p.CanWrite) continue;
                var pt = p.PropertyType;
                if (pt != typeof(float) && pt != typeof(double)) continue;
                if (!FieldNameLooksLikePowerSignal(p.Name)) continue;
                try
                {
                    if (pt == typeof(float))
                    {
                        var v = (float)p.GetValue(comp, null);
                        p.SetValue(comp, Mathf.Clamp(v + 3f, 0f, 500f), null);
                    }
                    else
                    {
                        var v = (double)p.GetValue(comp, null);
                        p.SetValue(comp, v + 3.0, null);
                    }
                }
                catch
                {
                    // ignored
                }
            }

            if (!scanAll) return;
            foreach (var method in comp.GetType().GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
            {
                var mn = method.Name;
                if (mn.IndexOf("power", StringComparison.OrdinalIgnoreCase) < 0 &&
                    mn.IndexOf("spin", StringComparison.OrdinalIgnoreCase) < 0 &&
                    mn.IndexOf("human", StringComparison.OrdinalIgnoreCase) < 0 &&
                    mn.IndexOf("manual", StringComparison.OrdinalIgnoreCase) < 0 &&
                    mn.IndexOf("input", StringComparison.OrdinalIgnoreCase) < 0 &&
                    mn.IndexOf("drive", StringComparison.OrdinalIgnoreCase) < 0 &&
                    mn.IndexOf("rider", StringComparison.OrdinalIgnoreCase) < 0 &&
                    mn.IndexOf("pedal", StringComparison.OrdinalIgnoreCase) < 0)
                    continue;
                try
                {
                    if (method.ReturnType != typeof(void)) continue;
                    var ps = method.GetParameters();
                    if (ps.Length == 0)
                    {
                        method.Invoke(comp, null);
                    }
                    else if (ps.Length == 1)
                    {
                        if (ps[0].ParameterType == typeof(float))
                            method.Invoke(comp, new object[] { 1f });
                        else if (typeof(BasePlayer).IsAssignableFrom(ps[0].ParameterType))
                            method.Invoke(comp, new object[] { null });
                    }
                }
                catch
                {
                    // ignored
                }
            }

            // Force run-state booleans on explicit wheel components.
            if (tn.IndexOf("ElectricWaterWheel", StringComparison.OrdinalIgnoreCase) >= 0 ||
                tn.IndexOf("WaterWheelMountable", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                foreach (var f in comp.GetType().GetFields(bf))
                {
                    if (f.FieldType != typeof(bool) || !BoolNameLooksLikeRunSignal(f.Name)) continue;
                    try { f.SetValue(comp, true); } catch { }
                }
                foreach (var p in comp.GetType().GetProperties(bf))
                {
                    if (!p.CanWrite || p.PropertyType != typeof(bool) || !BoolNameLooksLikeRunSignal(p.Name)) continue;
                    try { p.SetValue(comp, true, null); } catch { }
                }

                // Concrete runtime members seen in debug dumps.
                foreach (var f in comp.GetType().GetFields(bf))
                {
                    if (f.FieldType != typeof(bool)) continue;
                    if (f.Name == "syncsMountedPlayers" || f.Name == "ensureOutputsUpdated")
                    {
                        try { f.SetValue(comp, true); } catch { }
                    }
                }

                // Hard-force known runtime wheel-state members from debug dump.
                if (tn.IndexOf("ElectricWaterWheel", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    foreach (var f in comp.GetType().GetFields(bf))
                    {
                        try
                        {
                            if (f.Name == "fetchedWaterInfo" && f.FieldType == typeof(bool)) f.SetValue(comp, true);
                            else if (f.Name == "isInWater" && f.FieldType == typeof(bool)) f.SetValue(comp, true);
                            else if (f.Name == "isInOpenWater" && f.FieldType == typeof(bool)) f.SetValue(comp, true);
                            else if (f.Name == "_waterAlignmentCached" && f.FieldType == typeof(bool)) f.SetValue(comp, true);
                            else if (f.Name == "ensureOutputsUpdated" && f.FieldType == typeof(bool)) f.SetValue(comp, true);
                            else if (f.Name == "serverWaterSpeed" && f.FieldType == typeof(float)) f.SetValue(comp, Mathf.Max(2.5f, (float)f.GetValue(comp)));
                            else if (f.Name == "_waterAlignment" && f.FieldType == typeof(float)) f.SetValue(comp, 1f);
                            else if (f.Name == "lastUpdateTime" && f.FieldType == typeof(float)) f.SetValue(comp, Time.realtimeSinceStartup);
                        }
                        catch
                        {
                            // ignored
                        }
                    }

                    TryInvokeElectricWheelUpdateMethods(comp);
                    TryDriveElectricWheelDirectOutput(comp);
                    TryForceElectricWheelEnergyState(comp);
                    TryInvokeElectricWheelPublishPipeline(comp, npc);
                }

                if (tn.IndexOf("WaterWheelMountable", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    foreach (var f in comp.GetType().GetFields(bf))
                    {
                        try
                        {
                            // NPCs can fail manual drive if calories are required.
                            if (f.Name == "caloriesRequired" && f.FieldType == typeof(float)) f.SetValue(comp, 0f);
                            else if (f.Name == "calorieDrainPerMinute" && f.FieldType == typeof(float)) f.SetValue(comp, 0f);
                            else if (f.Name == "hydrationDrainPerMinute" && f.FieldType == typeof(float)) f.SetValue(comp, 0f);
                            else if (f.Name == "syncsMountedPlayers" && f.FieldType == typeof(bool)) f.SetValue(comp, true);
                        }
                        catch
                        {
                            // ignored
                        }
                    }
                }
                TryInvokeIoEntityRefresh(comp);
            }

            if (_cfg.AutorunInvokeWheelMethods)
                TryInvokeWheelInputLikeMethods(comp, npc);

            TryDriveWaterWheelMountablePlayerInput(comp, npc);
            TryInvokeWaterWheelMountedPlayerSync(comp);
            TryInvokeWaterWheelMountableTickMethods(comp);
        }

        private static void TryInvokeElectricWheelUpdateMethods(Component comp)
        {
            if (comp == null) return;
            var tn = comp.GetType().Name;
            if (tn.IndexOf("ElectricWaterWheel", StringComparison.OrdinalIgnoreCase) < 0) return;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            try
            {
                foreach (var m in comp.GetType().GetMethods(bf))
                {
                    if (m.ReturnType != typeof(void) || m.GetParameters().Length != 0) continue;
                    var n = m.Name;
                    if (n.IndexOf("Update", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        n.IndexOf("Refresh", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        n.IndexOf("Recalculate", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        n.IndexOf("MarkDirty", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        n.IndexOf("OnCycle", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        n.IndexOf("Tick", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        m.Invoke(comp, null);
                    }
                }
            }
            catch
            {
                // ignored
            }
        }

        private static void TryDriveElectricWheelDirectOutput(Component comp)
        {
            if (comp == null) return;
            var tn = comp.GetType().Name;
            if (tn.IndexOf("ElectricWaterWheel", StringComparison.OrdinalIgnoreCase) < 0) return;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            try
            {
                float maxOut = 100f;
                var maxOutMethod = comp.GetType().GetMethod("MaximalPowerOutput", bf, null, Type.EmptyTypes, null);
                if (maxOutMethod != null)
                {
                    var mv = maxOutMethod.Invoke(comp, null);
                    if (mv is int mi) maxOut = Mathf.Max(1f, mi);
                    else if (mv is float mf) maxOut = Mathf.Max(1f, mf);
                    else if (mv is double md) maxOut = Mathf.Max(1f, (float)md);
                }

                // Push likely runtime power holders when present.
                foreach (var f in comp.GetType().GetFields(bf))
                {
                    try
                    {
                        var n = f.Name;
                        if (f.FieldType == typeof(float) &&
                            (n.IndexOf("currentpower", StringComparison.OrdinalIgnoreCase) >= 0 ||
                             n.IndexOf("targetpower", StringComparison.OrdinalIgnoreCase) >= 0 ||
                             n.IndexOf("desiredpower", StringComparison.OrdinalIgnoreCase) >= 0 ||
                             n.IndexOf("generatedpower", StringComparison.OrdinalIgnoreCase) >= 0))
                        {
                            f.SetValue(comp, maxOut);
                        }
                    }
                    catch
                    {
                        // ignored
                    }
                }

                foreach (var m in comp.GetType().GetMethods(bf))
                {
                    var n = m.Name;
                    var ps = m.GetParameters();
                    if (n.IndexOf("UpdateOutputs", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        if (ps.Length == 0 && m.ReturnType == typeof(void))
                            m.Invoke(comp, null);
                        else if (ps.Length == 1 && ps[0].ParameterType == typeof(int))
                            m.Invoke(comp, new object[] { Mathf.RoundToInt(maxOut) });
                        else if (ps.Length == 1 && ps[0].ParameterType == typeof(float))
                            m.Invoke(comp, new object[] { maxOut });
                    }
                    else if (n.IndexOf("UpdateHasPower", StringComparison.OrdinalIgnoreCase) >= 0 && ps.Length == 0 && m.ReturnType == typeof(void))
                    {
                        m.Invoke(comp, null);
                    }
                    else if (n.IndexOf("MarkDirty", StringComparison.OrdinalIgnoreCase) >= 0 && ps.Length == 0 && m.ReturnType == typeof(void))
                    {
                        m.Invoke(comp, null);
                    }
                }
            }
            catch
            {
                // ignored
            }
        }

        private void TryInvokeElectricWheelPublishPipeline(Component comp, BasePlayer npc)
        {
            if (comp == null || npc == null) return;
            if (comp.GetType().Name.IndexOf("ElectricWaterWheel", StringComparison.OrdinalIgnoreCase) < 0) return;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            var invoked = 0;
            var maxOut = ResolveWheelMaxOutput(comp);
            var invokedNames = new List<string>();
            var failedNames = new List<string>();
            string updateFromInputError = null;
            foreach (var m in comp.GetType().GetMethods(bf))
            {
                var n = m.Name;
                if (n != "UpdateOutputs" &&
                    n != "UpdateFromInput" &&
                    n != "WaterUpdate" &&
                    n != "PowerUpdate" &&
                    n != "TouchIOState" &&
                    n != "IOStateChanged" &&
                    n != "OnCircuitChanged" &&
                    n != "SendChangedToRoot" &&
                    n != "SendIONetworkUpdate" &&
                    n != "UpdateHasPower" &&
                    n != "MarkDirtyForceUpdateOutputs" &&
                    n != "MarkDirty")
                    continue;
                bool ok;
                if (n == "UpdateFromInput")
                {
                    ok = TryInvokeUpdateFromInputIfAvailable(comp, m, maxOut, out updateFromInputError, out var skippedNoInputs);
                    if (skippedNoInputs)
                        continue;
                }
                else
                    ok = TryInvokeWithGeneratedArgs(comp, m, npc, maxOut);
                if (ok)
                {
                    invoked++;
                    invokedNames.Add($"{n}({m.GetParameters().Length})");
                }
                else
                {
                    failedNames.Add($"{n}({m.GetParameters().Length})[{DescribeMethodParams(m)}]");
                }
            }

            if (!_cfg.DebugWheelAutorun || npc.net == null) return;
            var mount = npc.GetMounted();
            if (mount?.net == null) return;
            var mountId = mount.net.ID.Value;
            var now = Time.realtimeSinceStartup;
            if (_nextWheelPublishDebugAt.TryGetValue(mountId, out var nextAt) && now < nextAt) return;
            _nextWheelPublishDebugAt[mountId] = now + 4f;
            Puts($"[BaseBotch][debug] wheelPublish mount={mountId} invoked={invoked} maxOut={maxOut:F1} methods=[{string.Join(", ", invokedNames.ToArray())}]");
            if (failedNames.Count > 0)
                Puts($"[BaseBotch][debug] wheelPublishFailed mount={mountId} methods=[{string.Join(", ", failedNames.ToArray())}]");
            if (!string.IsNullOrEmpty(updateFromInputError))
            {
                if (!_nextWheelPublishErrorDebugAt.TryGetValue(mountId, out var errNextAt) || now >= errNextAt)
                {
                    _nextWheelPublishErrorDebugAt[mountId] = now + 8f;
                    Puts($"[BaseBotch][debug] wheelPublishUpdateFromInputError mount={mountId} error={updateFromInputError}");
                }
            }
        }

        private static bool TryInvokeUpdateFromInputIfAvailable(Component target, MethodInfo method, float maxOut, out string error, out bool skippedNoInputs)
        {
            error = null;
            skippedNoInputs = false;
            try
            {
                const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
                var getConnectedInputCount = target.GetType().GetMethod("GetConnectedInputCount", bf, null, Type.EmptyTypes, null);
                if (getConnectedInputCount != null)
                {
                    var cntObj = getConnectedInputCount.Invoke(target, null);
                    if (cntObj is int cnt && cnt <= 0)
                    {
                        // No wires into input slots — UpdateFromInput indexes IO slots and throws; not used for hamster/manual power.
                        skippedNoInputs = true;
                        return false;
                    }
                }
            }
            catch
            {
                // ignored; fall back to guarded invoke below
            }

            return TryInvokeUpdateFromInput(target, method, maxOut, out error);
        }

        private static bool TryInvokeUpdateFromInput(Component target, MethodInfo method, float maxOut, out string error)
        {
            error = null;
            try
            {
                var ps = method.GetParameters();
                if (ps.Length != 2) return false;
                // ElectricWaterWheel.UpdateFromInput(int slot, int amount)
                if (ps[0].ParameterType == typeof(int) && ps[1].ParameterType == typeof(int))
                {
                    foreach (var slot in new[] { 0, 1, 2 })
                    {
                        try
                        {
                            method.Invoke(target, new object[] { slot, Mathf.RoundToInt(maxOut) });
                            return true;
                        }
                        catch (Exception ex)
                        {
                            error = ex.InnerException?.Message ?? ex.Message;
                        }
                    }
                    return false;
                }
                if (ps[0].ParameterType == typeof(int) && ps[1].ParameterType == typeof(float))
                {
                    foreach (var slot in new[] { 0, 1, 2 })
                    {
                        try
                        {
                            method.Invoke(target, new object[] { slot, maxOut });
                            return true;
                        }
                        catch (Exception ex)
                        {
                            error = ex.InnerException?.Message ?? ex.Message;
                        }
                    }
                    return false;
                }
                if (ps[0].ParameterType == typeof(float) && ps[1].ParameterType == typeof(float))
                {
                    foreach (var slot in new[] { 0f, 1f, 2f })
                    {
                        try
                        {
                            method.Invoke(target, new object[] { slot, maxOut });
                            return true;
                        }
                        catch (Exception ex)
                        {
                            error = ex.InnerException?.Message ?? ex.Message;
                        }
                    }
                    return false;
                }
                if (ps[0].ParameterType == typeof(float) && ps[1].ParameterType == typeof(int))
                {
                    foreach (var slot in new[] { 0f, 1f, 2f })
                    {
                        try
                        {
                            method.Invoke(target, new object[] { slot, Mathf.RoundToInt(maxOut) });
                            return true;
                        }
                        catch (Exception ex)
                        {
                            error = ex.InnerException?.Message ?? ex.Message;
                        }
                    }
                    return false;
                }
                return false;
            }
            catch (Exception ex)
            {
                error = ex.InnerException?.Message ?? ex.Message;
                return false;
            }
        }

        private static string DescribeMethodParams(MethodInfo m)
        {
            try
            {
                var ps = m.GetParameters();
                var parts = new List<string>();
                foreach (var p in ps)
                    parts.Add(p.ParameterType.Name);
                return string.Join("|", parts.ToArray());
            }
            catch
            {
                return "?";
            }
        }

        private static float ResolveWheelMaxOutput(Component comp)
        {
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            try
            {
                var maxOutMethod = comp.GetType().GetMethod("MaximalPowerOutput", bf, null, Type.EmptyTypes, null);
                if (maxOutMethod != null)
                {
                    var mv = maxOutMethod.Invoke(comp, null);
                    if (mv is int mi) return Mathf.Max(1f, mi);
                    if (mv is float mf) return Mathf.Max(1f, mf);
                    if (mv is double md) return Mathf.Max(1f, (float)md);
                }
            }
            catch
            {
                // ignored
            }

            return 30f;
        }

        private static bool TryInvokeWithGeneratedArgs(Component target, MethodInfo method, BasePlayer npc, float maxOut)
        {
            try
            {
                var ps = method.GetParameters();
                if (ps.Length == 0)
                {
                    if (method.ReturnType != typeof(void)) return false;
                    method.Invoke(target, null);
                    return true;
                }

                var args = new object[ps.Length];
                var usedPrimaryNumeric = false;
                for (var i = 0; i < ps.Length; i++)
                {
                    var pt = ps[i].ParameterType;
                    if (typeof(BasePlayer).IsAssignableFrom(pt))
                        args[i] = npc;
                    else if (typeof(BaseEntity).IsAssignableFrom(pt))
                        args[i] = npc;
                    else if (typeof(InputState).IsAssignableFrom(pt))
                        args[i] = npc.serverInput;
                    else if (pt == typeof(int))
                    {
                        args[i] = usedPrimaryNumeric ? 0 : Mathf.RoundToInt(maxOut);
                        usedPrimaryNumeric = true;
                    }
                    else if (pt == typeof(float))
                    {
                        args[i] = usedPrimaryNumeric ? 0f : maxOut;
                        usedPrimaryNumeric = true;
                    }
                    else if (pt == typeof(double))
                    {
                        args[i] = usedPrimaryNumeric ? 0d : (double)maxOut;
                        usedPrimaryNumeric = true;
                    }
                    else if (pt == typeof(bool))
                        args[i] = true;
                    else if (pt == typeof(uint))
                        args[i] = 0u;
                    else if (pt == typeof(ulong))
                        args[i] = 0UL;
                    else if (pt == typeof(string))
                        args[i] = "";
                    else if (pt == typeof(Vector3))
                        args[i] = Vector3.zero;
                    else if (pt.IsEnum)
                        args[i] = Activator.CreateInstance(pt);
                    else if (!pt.IsValueType)
                        args[i] = null;
                    else
                        args[i] = Activator.CreateInstance(pt);
                }

                method.Invoke(target, args);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static void TryForceElectricWheelEnergyState(Component comp)
        {
            if (comp == null) return;
            if (comp.GetType().Name.IndexOf("ElectricWaterWheel", StringComparison.OrdinalIgnoreCase) < 0) return;
            var maxOut = ResolveWheelMaxOutput(comp);
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            try
            {
                for (var t = comp.GetType(); t != null && t != typeof(object); t = t.BaseType)
                {
                    foreach (var f in t.GetFields(bf))
                    {
                        var n = f.Name ?? "";
                        try
                        {
                            if (f.FieldType == typeof(bool))
                            {
                                if (n.IndexOf("ensureOutputsUpdated", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                    n.IndexOf("forceUpdateOutputs", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                    n.IndexOf("shouldUpdateOutputs", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                    n.IndexOf("wantsPower", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                    n.IndexOf("hasPower", StringComparison.OrdinalIgnoreCase) >= 0)
                                    f.SetValue(comp, true);
                            }
                            else if (f.FieldType == typeof(int))
                            {
                                if (n.IndexOf("currentEnergy", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                    n.IndexOf("energy", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                    n.IndexOf("currentPower", StringComparison.OrdinalIgnoreCase) >= 0)
                                    f.SetValue(comp, Mathf.RoundToInt(maxOut));
                            }
                            else if (f.FieldType == typeof(float))
                            {
                                if (n.IndexOf("currentEnergy", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                    n.IndexOf("energy", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                    n.IndexOf("currentPower", StringComparison.OrdinalIgnoreCase) >= 0)
                                    f.SetValue(comp, maxOut);
                            }
                        }
                        catch
                        {
                            // ignored
                        }
                    }
                }
            }
            catch
            {
                // ignored
            }
        }

        private static void TryDriveWaterWheelMountablePlayerInput(Component comp, BasePlayer npc)
        {
            if (comp == null || npc == null) return;
            var tn = comp.GetType().Name;
            if (tn.IndexOf("WaterWheelMountable", StringComparison.OrdinalIgnoreCase) < 0) return;
            if (npc.serverInput == null) return;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            try
            {
                foreach (var m in comp.GetType().GetMethods(bf))
                {
                    if (m.Name != "PlayerServerInput") continue;
                    var ps = m.GetParameters();
                    if (ps.Length != 2) continue;
                    if (!typeof(BasePlayer).IsAssignableFrom(ps[0].ParameterType)) continue;
                    if (!typeof(InputState).IsAssignableFrom(ps[1].ParameterType)) continue;
                    m.Invoke(comp, new object[] { npc, npc.serverInput });
                    return;
                }
            }
            catch
            {
                // ignored
            }
        }

        private static void TryInvokeWaterWheelMountedPlayerSync(Component comp)
        {
            if (comp == null) return;
            var tn = comp.GetType().Name;
            if (tn.IndexOf("WaterWheelMountable", StringComparison.OrdinalIgnoreCase) < 0) return;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            try
            {
                var m = comp.GetType().GetMethod("MountedPlayerSync", bf, null, Type.EmptyTypes, null);
                m?.Invoke(comp, null);
            }
            catch
            {
                // ignored
            }
        }

        private static void TryInvokeWaterWheelMountableTickMethods(Component comp)
        {
            if (comp == null) return;
            var tn = comp.GetType().Name;
            if (tn.IndexOf("WaterWheelMountable", StringComparison.OrdinalIgnoreCase) < 0) return;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            try
            {
                foreach (var m in comp.GetType().GetMethods(bf))
                {
                    if (m.ReturnType != typeof(void) || m.GetParameters().Length != 0) continue;
                    if (m.Name == "UpdateMountFlags" ||
                        m.Name == "VehicleFixedUpdate" ||
                        m.Name == "PostVehicleFixedUpdate")
                    {
                        m.Invoke(comp, null);
                    }
                }
            }
            catch
            {
                // ignored
            }
        }

        private void TryInvokeWheelInputLikeMethods(Component comp, BasePlayer npc)
        {
            if (comp == null || npc == null) return;
            var tn = comp.GetType().Name;
            if (tn.IndexOf("WaterWheel", StringComparison.OrdinalIgnoreCase) < 0 &&
                tn.IndexOf("ElectricWaterWheel", StringComparison.OrdinalIgnoreCase) < 0)
                return;

            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            foreach (var method in comp.GetType().GetMethods(bf))
            {
                var mn = method.Name;
                if (!LooksLikeSafeWheelDriverMethod(mn))
                    continue;

                try
                {
                    var ps = method.GetParameters();
                    if (ps.Length == 0 && method.ReturnType == typeof(void))
                    {
                        method.Invoke(comp, null);
                    }
                    else if (ps.Length == 1)
                    {
                        if (ps[0].ParameterType == typeof(float))
                            method.Invoke(comp, new object[] { 1f });
                        else if (typeof(BasePlayer).IsAssignableFrom(ps[0].ParameterType))
                            method.Invoke(comp, new object[] { npc });
                        else if (typeof(InputState).IsAssignableFrom(ps[0].ParameterType))
                            method.Invoke(comp, new object[] { npc.serverInput });
                    }
                    else if (ps.Length == 2)
                    {
                        if (typeof(BasePlayer).IsAssignableFrom(ps[0].ParameterType) &&
                            typeof(InputState).IsAssignableFrom(ps[1].ParameterType))
                            method.Invoke(comp, new object[] { npc, npc.serverInput });
                        else if (typeof(BasePlayer).IsAssignableFrom(ps[0].ParameterType) &&
                                 ps[1].ParameterType == typeof(float))
                            method.Invoke(comp, new object[] { npc, 1f });
                    }
                }
                catch
                {
                    // ignored
                }
            }
        }

        private static bool LooksLikeSafeWheelDriverMethod(string methodName)
        {
            if (string.IsNullOrEmpty(methodName)) return false;
            // Never call lifecycle / mount management methods from blind reflection.
            if (methodName.IndexOf("mount", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (methodName.IndexOf("dismount", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (methodName.IndexOf("unmount", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (methodName.IndexOf("detach", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (methodName.IndexOf("eject", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (methodName.IndexOf("drop", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (methodName.IndexOf("remove", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (methodName.IndexOf("kill", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (methodName.IndexOf("destroy", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (methodName.IndexOf("exit", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            if (methodName.IndexOf("leave", StringComparison.OrdinalIgnoreCase) >= 0) return false;

            if (methodName.IndexOf("pedal", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (methodName.IndexOf("spin", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (methodName.IndexOf("power", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (methodName.IndexOf("human", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (methodName.IndexOf("manual", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (methodName.IndexOf("drive", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            // Avoid broad "player"/"input" names by default; those often include enter/exit hooks.
            return false;
        }

        private static void TryForceMovementModelState(BasePlayer npc)
        {
            if (npc?.modelState == null) return;
            var ms = npc.modelState;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            try
            {
                foreach (var p in ms.GetType().GetProperties(bf))
                {
                    if (!p.CanWrite || p.PropertyType != typeof(bool)) continue;
                    var n = p.Name;
                    if (n.IndexOf("sprint", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        n.IndexOf("run", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        n.IndexOf("moving", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        n.IndexOf("onground", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        p.SetValue(ms, true, null);
                    }
                }

                foreach (var f in ms.GetType().GetFields(bf))
                {
                    if (f.FieldType != typeof(bool)) continue;
                    var n = f.Name;
                    if (n.IndexOf("sprint", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        n.IndexOf("run", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        n.IndexOf("moving", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        n.IndexOf("onground", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        f.SetValue(ms, true);
                    }
                }
            }
            catch
            {
                // ignored
            }
        }

        private static bool FieldNameLooksLikePowerSignal(string fn)
        {
            if (fn.IndexOf("power", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("output", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("energy", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("spin", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("rpm", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("torque", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("human", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("manual", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("pedal", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("flow", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("generat", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("watts", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("charge", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("velocity", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("watt", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("generate", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("produc", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("desired", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (fn.IndexOf("target", StringComparison.OrdinalIgnoreCase) >= 0 &&
                (fn.IndexOf("power", StringComparison.OrdinalIgnoreCase) >= 0 ||
                 fn.IndexOf("rate", StringComparison.OrdinalIgnoreCase) >= 0 ||
                 fn.IndexOf("rpm", StringComparison.OrdinalIgnoreCase) >= 0)) return true;
            if (fn.IndexOf("rate", StringComparison.OrdinalIgnoreCase) >= 0 &&
                fn.IndexOf("separate", StringComparison.OrdinalIgnoreCase) < 0) return true;
            if (fn.IndexOf("current", StringComparison.OrdinalIgnoreCase) >= 0 &&
                (fn.IndexOf("power", StringComparison.OrdinalIgnoreCase) >= 0 ||
                 fn.IndexOf("energy", StringComparison.OrdinalIgnoreCase) >= 0 ||
                 fn.IndexOf("flow", StringComparison.OrdinalIgnoreCase) >= 0)) return true;
            return false;
        }

        private static bool ComponentTypeLooksWheelRelated(string tn)
        {
            if (tn.IndexOf("Water", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (tn.IndexOf("Wheel", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (tn.IndexOf("Generator", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (tn.IndexOf("Electric", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (tn.IndexOf("Human", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (tn.IndexOf("Hamster", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (tn.IndexOf("IOEntity", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            return false;
        }

        private static bool BoolNameLooksLikeRunSignal(string name)
        {
            if (name.IndexOf("running", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (name.IndexOf("isrunning", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (name.IndexOf("active", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (name.IndexOf("producing", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (name.IndexOf("generating", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (name.IndexOf("spinning", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            return false;
        }

        private static void TryInvokeIoEntityRefresh(Component comp)
        {
            if (comp == null) return;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            try
            {
                foreach (var m in comp.GetType().GetMethods(bf))
                {
                    if (m.ReturnType != typeof(void)) continue;
                    if (m.GetParameters().Length != 0) continue;
                    var n = m.Name;
                    if (n.IndexOf("MarkDirty", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        n.IndexOf("UpdateOutputs", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        n.IndexOf("UpdateHasPower", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        n.IndexOf("Refresh", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        n.IndexOf("NetworkUpdate", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        n.IndexOf("SendChanged", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        m.Invoke(comp, null);
                    }
                }
            }
            catch
            {
                // ignored
            }
        }

        private void TryLogAutorunDebug(BasePlayer npc, BaseMountable mount, bool wrote)
        {
            if (npc?.net == null) return;
            var id = npc.net.ID.Value;
            var now = Time.realtimeSinceStartup;
            if (_nextAutorunDebugAt.TryGetValue(id, out var nextAt) && now < nextAt) return;
            _nextAutorunDebugAt[id] = now + 4f;

            var nav = TryGetNavigatorFromPlayer(npc);
            var canNavMounted = TryGetCanNavigateMounted(nav);
            var mountPrefab = (mount as BaseEntity)?.PrefabName ?? "(null)";
            Puts($"[BaseBotch][debug] npc={npc.displayName}/{id} wrote={wrote} mounted={npc.isMounted} mount={mountPrefab} navType={nav?.GetType().Name ?? "none"} canNavigateMounted={(canNavMounted?.ToString() ?? "n/a")}");
        }

        private void DumpWheelComponentsForDebug(ulong mountId, Component[] comps)
        {
            try
            {
                var names = new List<string>();
                var mountableMethodHints = new List<string>();
                var electricMethodHints = new List<string>();
                foreach (var c in comps)
                {
                    if (c == null) continue;
                    var n = c.GetType().Name;
                    if (!names.Contains(n))
                        names.Add(n);
                    if (n.IndexOf("WaterWheel", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        n.IndexOf("ElectricWaterWheel", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
                        foreach (var m in c.GetType().GetMethods(bf))
                        {
                            var mn = m.Name;
                            if (mn.IndexOf("input", StringComparison.OrdinalIgnoreCase) < 0 &&
                                mn.IndexOf("player", StringComparison.OrdinalIgnoreCase) < 0 &&
                                mn.IndexOf("rider", StringComparison.OrdinalIgnoreCase) < 0 &&
                                mn.IndexOf("pedal", StringComparison.OrdinalIgnoreCase) < 0 &&
                                mn.IndexOf("human", StringComparison.OrdinalIgnoreCase) < 0 &&
                                mn.IndexOf("spin", StringComparison.OrdinalIgnoreCase) < 0 &&
                                mn.IndexOf("drive", StringComparison.OrdinalIgnoreCase) < 0 &&
                                mn.IndexOf("update", StringComparison.OrdinalIgnoreCase) < 0 &&
                                mn.IndexOf("refresh", StringComparison.OrdinalIgnoreCase) < 0 &&
                                mn.IndexOf("tick", StringComparison.OrdinalIgnoreCase) < 0 &&
                                mn.IndexOf("output", StringComparison.OrdinalIgnoreCase) < 0 &&
                                mn.IndexOf("power", StringComparison.OrdinalIgnoreCase) < 0)
                                continue;
                            var sig = $"{n}.{mn}({m.GetParameters().Length})";
                            if (n.IndexOf("ElectricWaterWheel", StringComparison.OrdinalIgnoreCase) >= 0)
                            {
                                if (!electricMethodHints.Contains(sig))
                                    electricMethodHints.Add(sig);
                            }
                            else
                            {
                                if (!mountableMethodHints.Contains(sig))
                                    mountableMethodHints.Add(sig);
                            }
                        }
                    }
                    if (names.Count >= 24)
                        break;
                }

                Puts($"[BaseBotch][debug] wheelComponents mount={mountId} count={comps?.Length ?? 0} types=[{string.Join(", ", names.ToArray())}]");
                if (mountableMethodHints.Count > 0)
                    Puts($"[BaseBotch][debug] wheelMethodsMountable mount={mountId} methods=[{string.Join(", ", mountableMethodHints.ToArray())}]");
                if (electricMethodHints.Count > 0)
                    Puts($"[BaseBotch][debug] wheelMethodsElectric mount={mountId} methods=[{string.Join(", ", electricMethodHints.ToArray())}]");
                DumpAllElectricWheelMethodsForDebug(mountId, comps);
            }
            catch
            {
                // ignored
            }
        }

        private void DumpAllElectricWheelMethodsForDebug(ulong mountId, Component[] comps)
        {
            try
            {
                const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
                foreach (var c in comps)
                {
                    if (c == null) continue;
                    var tn = c.GetType().Name;
                    if (tn.IndexOf("ElectricWaterWheel", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    var all = new List<string>();
                    foreach (var m in c.GetType().GetMethods(bf))
                    {
                        all.Add($"{m.Name}({m.GetParameters().Length})");
                        if (all.Count >= 160) break;
                    }
                    const int chunkSize = 18;
                    var chunkIndex = 0;
                    for (var i = 0; i < all.Count; i += chunkSize)
                    {
                        var count = Math.Min(chunkSize, all.Count - i);
                        var slice = all.GetRange(i, count);
                        Puts($"[BaseBotch][debug] wheelMethodsElectricAll mount={mountId} chunk={chunkIndex} methods=[{string.Join(", ", slice.ToArray())}]");
                        chunkIndex++;
                    }
                    break;
                }
            }
            catch
            {
                // ignored
            }
        }

        private void DumpElectricWheelMembersForDebug(ulong mountId, Component[] comps)
        {
            try
            {
                const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
                foreach (var c in comps)
                {
                    if (c == null) continue;
                    var tn = c.GetType().Name;
                    if (tn.IndexOf("ElectricWaterWheel", StringComparison.OrdinalIgnoreCase) < 0 &&
                        tn.IndexOf("WaterWheelMountable", StringComparison.OrdinalIgnoreCase) < 0)
                        continue;

                    var fields = new List<string>();
                    foreach (var f in c.GetType().GetFields(bf))
                    {
                        if (f.FieldType == typeof(float) || f.FieldType == typeof(double) || f.FieldType == typeof(bool))
                            fields.Add($"{f.Name}:{f.FieldType.Name}");
                        if (fields.Count >= 40) break;
                    }

                    var props = new List<string>();
                    foreach (var p in c.GetType().GetProperties(bf))
                    {
                        if (!p.CanRead) continue;
                        var pt = p.PropertyType;
                        if (pt == typeof(float) || pt == typeof(double) || pt == typeof(bool))
                            props.Add($"{p.Name}:{pt.Name}:{(p.CanWrite ? "rw" : "ro")}");
                        if (props.Count >= 40) break;
                    }

                    Puts($"[BaseBotch][debug] wheelMembers mount={mountId} type={tn} fields=[{string.Join(", ", fields.ToArray())}] props=[{string.Join(", ", props.ToArray())}]");
                }
            }
            catch
            {
                // ignored
            }
        }

        private bool PrefabChainLooksLikeWaterWheel(BaseMountable mount)
        {
            if (mount == null) return false;
            var sub = _cfg.WaterWheelPrefabSubstring ?? "waterwheel";
            for (var ent = mount as BaseEntity; ent != null; ent = ent.GetParentEntity())
            {
                var pn = ent.PrefabName ?? "";
                if (pn.IndexOf(sub, StringComparison.OrdinalIgnoreCase) >= 0)
                    return true;
            }

            return false;
        }

        private void RememberMountForNpc(BasePlayer npc, BaseMountable mount)
        {
            if (npc?.net == null || mount?.net == null) return;
            _npcToTrackedMountNetId[npc.net.ID.Value] = mount.net.ID.Value;
        }

        private void ForgetNpc(BasePlayer npc)
        {
            if (npc?.net == null) return;
            var id = npc.net.ID.Value;
            if (_npcToTrackedMountNetId.TryGetValue(id, out var mountId))
            {
                _wheelBumpComponentCache.Remove(mountId);
                _wheelComponentDumped.Remove(mountId);
                _wheelMemberDumped.Remove(mountId);
                _wheelMountedSyncEnabled.Remove(mountId);
                _nextWheelPublishDebugAt.Remove(mountId);
                _nextWheelPublishErrorDebugAt.Remove(mountId);
            }
            _autorunNpcNetIds.Remove(id);
            _npcToTrackedMountNetId.Remove(id);
        }

        private static ulong ParseAnchorSteam(object anchorSteamObj, BasePlayer issuer)
        {
            if (anchorSteamObj != null)
            {
                if (anchorSteamObj is ulong u) return u;
                if (anchorSteamObj is long l && l >= 0) return (ulong)l;
                if (ulong.TryParse(anchorSteamObj.ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture,
                        out var p)) return p;
            }

            return issuer != null ? issuer.userID : 0UL;
        }

        private static string NormalizeTaskKeyword(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return "gather";
            var t = raw.Trim().ToLowerInvariant();
            switch (t)
            {
                case "wood":
                case "stone":
                case "cloth":
                case "hunt":
                case "protect":
                case "follow":
                case "guard":
                case "deposit":
                case "gather":
                case "mixed":
                case "idle":
                case "all":
                    return t == "all" ? "gather" : t;
                default:
                    return "gather";
            }
        }

        /// <summary>Snapshot bridge task (before idle) and apply idle so Roaming AI does not fight wheel input.</summary>
        private void SaveWheelSessionAndPauseRoam(BasePlayer npc, ulong anchorSteam)
        {
            if (npc?.net == null) return;
            var id = npc.net.ID.Value;
            _wheelRestorePending.Remove(id);

            var taskKw = "gather";
            if (RoamingNPCs != null && RoamingNPCs.IsLoaded)
            {
                try
                {
                    var raw = RoamingNPCs.Call("GetBridgeTaskLabel", id);
                    taskKw = NormalizeTaskKeyword(raw?.ToString() ?? "");
                }
                catch
                {
                    taskKw = "gather";
                }
            }

            _wheelRestorePending[id] = new WheelRestoreState
            {
                TaskKeyword = taskKw,
                AnchorSteam = anchorSteam,
                SnapshotBridgeTask = true
            };

            if (!_cfg.PauseRoamingAiWhileOnWheel || RoamingNPCs == null || !RoamingNPCs.IsLoaded) return;
            try
            {
                RoamingNPCs.Call("ApplyBridgeTask", id, anchorSteam, "idle");
            }
            catch (Exception ex)
            {
                PrintWarning($"[BaseBotch] ApplyBridgeTask idle before wheel: {ex.Message}");
            }
        }

        private void TryRestoreWheelRoamTask(ulong npcNetId)
        {
            if (!_wheelRestorePending.TryGetValue(npcNetId, out var st)) return;
            _wheelRestorePending.Remove(npcNetId);
            TryRestoreNavigatorFromWheelState(npcNetId, st);
            if (RoamingNPCs == null || !RoamingNPCs.IsLoaded) return;
            if (!st.SnapshotBridgeTask) return;
            // Never restore literal "idle" — snapshot may have read idle while RoamingNPCs was already paused,
            // leaving bots doing nothing after dismount. Empty/bad snapshots fall back to mixed.
            var kw = (st.TaskKeyword ?? "").Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(kw) || kw == "idle")
                kw = "mixed";
            try
            {
                RoamingNPCs.Call("ApplyBridgeTask", npcNetId, st.AnchorSteam, kw);
            }
            catch (Exception ex)
            {
                PrintWarning($"[BaseBotch] Restore bridge task after wheel: {ex.Message}");
            }
        }

        private void TryRestoreNavigatorFromWheelState(ulong npcNetId, WheelRestoreState st)
        {
            if (st?.PriorCanNavigateMounted == null) return;
            var npc = BaseNetworkable.serverEntities.Find(new NetworkableId(npcNetId)) as BasePlayer;
            if (npc == null || npc.IsDestroyed) return;
            var nav = TryGetNavigatorFromPlayer(npc);
            TrySetCanNavigateMounted(nav, st.PriorCanNavigateMounted.Value);
        }

        private static object TryGetNavigatorFromPlayer(BasePlayer npc)
        {
            if (npc == null) return null;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            try
            {
                var brainProp = npc.GetType().GetProperty("Brain", bf);
                var brain = brainProp?.GetValue(npc);
                if (brain == null) return null;
                var navProp = brain.GetType().GetProperty("Navigator", bf);
                return navProp?.GetValue(brain);
            }
            catch
            {
                return null;
            }
        }

        private static bool? TryGetCanNavigateMounted(object navigator)
        {
            if (navigator == null) return null;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            try
            {
                var p = navigator.GetType().GetProperty("CanNavigateMounted", bf);
                if (p != null && p.CanRead)
                    return (bool)p.GetValue(navigator, null);
                var f = navigator.GetType().GetField("CanNavigateMounted", bf) ??
                        navigator.GetType().GetField("canNavigateMounted", bf);
                if (f != null && f.FieldType == typeof(bool))
                    return (bool)f.GetValue(navigator);
                return null;
            }
            catch
            {
                return null;
            }
        }

        private static void TrySetCanNavigateMounted(object navigator, bool value)
        {
            if (navigator == null) return;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            try
            {
                var p = navigator.GetType().GetProperty("CanNavigateMounted", bf);
                if (p != null && p.CanWrite)
                {
                    p.SetValue(navigator, value, null);
                    return;
                }
                var f = navigator.GetType().GetField("CanNavigateMounted", bf) ??
                        navigator.GetType().GetField("canNavigateMounted", bf);
                if (f != null && f.FieldType == typeof(bool))
                    f.SetValue(navigator, value);
            }
            catch
            {
                // ignored
            }
        }

        private static void TryNavigatorStop(object navigator)
        {
            if (navigator == null) return;
            try
            {
                var m = navigator.GetType().GetMethod("Stop", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic, null, Type.EmptyTypes, null);
                m?.Invoke(navigator, null);
            }
            catch
            {
                // ignored
            }
        }

        private void TryCaptureAndApplyNavigatorForWheel(BasePlayer npc)
        {
            if (!_cfg.TameNavigatorWhileOnWheel || npc?.net == null) return;
            var id = npc.net.ID.Value;
            // Do not insert an empty wheel session here — mount path must have run SaveWheelSessionAndPauseRoam first.
            // A bogus SnapshotBridgeTask=false entry would skip Roaming task restore and leave bots stuck on idle.
            if (!_wheelRestorePending.TryGetValue(id, out var st))
                return;

            var nav = TryGetNavigatorFromPlayer(npc);
            if (nav == null) return;
            if (st.PriorCanNavigateMounted == null)
                st.PriorCanNavigateMounted = TryGetCanNavigateMounted(nav);
            TrySetCanNavigateMounted(nav, _cfg.WheelSessionCanNavigateMounted);
        }

        private void TryStifleNavigatorWhileAutorunning(BasePlayer npc)
        {
            if (!_cfg.TameNavigatorWhileOnWheel || npc == null) return;
            TryNavigatorStop(TryGetNavigatorFromPlayer(npc));
        }

        private void TrySyncModelStateAfterWheelMount(BasePlayer npc, BaseMountable mount)
        {
            if (!_cfg.SyncModelStateAfterWheelMount || npc?.modelState == null || mount == null) return;
            try
            {
                npc.modelState.mounted = true;
                int? pose = null;
                var mp = mount.GetType().GetProperty("mountPose");
                if (mp != null)
                {
                    var v = mp.GetValue(mount);
                    if (v != null) pose = Convert.ToInt32(v);
                }

                if (pose == null)
                {
                    for (var e = mount as BaseEntity; e != null && pose == null; e = e.GetParentEntity())
                    {
                        foreach (var propName in new[] { "mountPose", "vehicleMountPose" })
                        {
                            var p = e.GetType().GetProperty(propName);
                            if (p == null) continue;
                            var v = p.GetValue(e);
                            if (v == null) continue;
                            pose = Convert.ToInt32(v);
                            break;
                        }
                    }
                }

                if (pose != null)
                    npc.modelState.poseType = pose.Value;
                npc.SendNetworkUpdate();
                foreach (var m in typeof(BaseNetworkable).GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
                {
                    if (m.Name != "SendNetworkUpdateImmediate" || m.GetParameters().Length != 0) continue;
                    m.Invoke(npc, null);
                    break;
                }
            }
            catch
            {
                // ignored
            }
        }

        [HookMethod("MountWaterWheelFromLook")]
        public object MountWaterWheelFromLook(ulong npcEntityNetId, BasePlayer issuer, object anchorSteamObj = null)
        {
            if (issuer == null || !issuer.IsConnected) return false;
            var anchorSteam = ParseAnchorSteam(anchorSteamObj, issuer);
            var npc = BaseNetworkable.serverEntities.Find(new NetworkableId(npcEntityNetId)) as BasePlayer;
            if (npc == null || npc.IsDestroyed)
            {
                issuer.ChatMessage("[BaseBotch] NPC not found.");
                return false;
            }

            if (!npc.IsNpc)
            {
                issuer.ChatMessage("[BaseBotch] That entity is not an NPC bot.");
                return false;
            }

            if (issuer.eyes == null)
                return false;

            if (!Physics.Raycast(
                    issuer.eyes.HeadRay(),
                    out RaycastHit hit,
                    _cfg.LookRayDistanceMeters,
                    Physics.DefaultRaycastLayers,
                    QueryTriggerInteraction.Ignore))
            {
                issuer.ChatMessage(
                    $"[BaseBotch] Nothing hit within {_cfg.LookRayDistanceMeters:F0}m — look at the water wheel.");
                return false;
            }

            var hitEnt = hit.GetEntity();
            if (hitEnt == null)
            {
                issuer.ChatMessage("[BaseBotch] Ray hit has no entity.");
                return false;
            }

            var mount = ResolveWaterWheelMountable(hitEnt, _cfg.WaterWheelPrefabSubstring);
            if (mount == null || mount.IsDestroyed)
            {
                issuer.ChatMessage("[BaseBotch] Not looking at an electric water wheel (mountable).");
                return false;
            }

            SaveWheelSessionAndPauseRoam(npc, anchorSteam);

            ForgetNpc(npc);

            if (npc.isMounted)
                TryDismountNpc(npc);

            mount.MountPlayer(npc);
            var ok = npc.GetMounted() != null;
            if (!ok)
            {
                TryRestoreWheelRoamTask(npc.net.ID.Value);
                issuer.ChatMessage("[BaseBotch] Mount failed (seat busy or blocked).");
                return false;
            }

            RememberMountForNpc(npc, mount);
            TrySyncModelStateAfterWheelMount(npc, mount);
            TryCaptureAndApplyNavigatorForWheel(npc);
            if (_cfg.AutorunAfterMount)
            {
                _autorunNpcNetIds.Add(npc.net.ID.Value);
                ApplyAutorunInput(npc.net.ID.Value, true);
            }

            return true;
        }

        [HookMethod("StartWaterWheelAutorun")]
        public object StartWaterWheelAutorun(ulong npcEntityNetId, BasePlayer issuer)
        {
            var npc = BaseNetworkable.serverEntities.Find(new NetworkableId(npcEntityNetId)) as BasePlayer;
            if (npc == null || npc.IsDestroyed)
            {
                issuer?.ChatMessage("[BaseBotch] NPC not found.");
                return false;
            }

            // If autorun was started without MountWaterWheelFromLook, ensure we snapshot + pause roam so dismount can restore.
            if (npc.net != null && !_wheelRestorePending.ContainsKey(npc.net.ID.Value))
                SaveWheelSessionAndPauseRoam(npc, issuer != null ? issuer.userID : 0UL);

            if (!npc.isMounted)
            {
                issuer?.ChatMessage("[BaseBotch] Bot must be mounted.");
                return false;
            }

            var m = npc.GetMounted();
            if (m == null || m.net == null)
            {
                issuer?.ChatMessage("[BaseBotch] No active mount.");
                return false;
            }

            if (!_npcToTrackedMountNetId.ContainsKey(npc.net.ID.Value) && !PrefabChainLooksLikeWaterWheel(m))
            {
                issuer?.ChatMessage("[BaseBotch] Mount does not look like the electric water wheel.");
                return false;
            }

            RememberMountForNpc(npc, m);
            TrySyncModelStateAfterWheelMount(npc, m);
            TryCaptureAndApplyNavigatorForWheel(npc);
            _autorunNpcNetIds.Add(npc.net.ID.Value);
            ApplyAutorunInput(npc.net.ID.Value, true);
            return true;
        }

        [HookMethod("StopWaterWheelAutorun")]
        public object StopWaterWheelAutorun(ulong npcEntityNetId, BasePlayer issuer)
        {
            _autorunNpcNetIds.Remove(npcEntityNetId);
            return true;
        }

        [HookMethod("DismountWaterWheel")]
        public object DismountWaterWheel(ulong npcEntityNetId, BasePlayer issuer, object anchorSteamObj = null)
        {
            if (npcEntityNetId == 0UL) return false;
            if (_npcToTrackedMountNetId.TryGetValue(npcEntityNetId, out var mountCacheId))
            {
                _wheelBumpComponentCache.Remove(mountCacheId);
                _wheelComponentDumped.Remove(mountCacheId);
                _wheelMemberDumped.Remove(mountCacheId);
                _wheelMountedSyncEnabled.Remove(mountCacheId);
                _nextWheelPublishDebugAt.Remove(mountCacheId);
                _nextWheelPublishErrorDebugAt.Remove(mountCacheId);
            }
            _autorunNpcNetIds.Remove(npcEntityNetId);
            _npcToTrackedMountNetId.Remove(npcEntityNetId);

            var npc = BaseNetworkable.serverEntities.Find(new NetworkableId(npcEntityNetId)) as BasePlayer;
            if (npc == null || npc.IsDestroyed)
            {
                issuer?.ChatMessage("[BaseBotch] NPC not found.");
                TryRestoreWheelRoamTask(npcEntityNetId);
                return false;
            }

            TryDismountNpc(npc);
            TryRestoreWheelRoamTask(npcEntityNetId);
            return true;
        }

        private static void TryDismountNpc(BasePlayer npc)
        {
            if (npc == null || npc.IsDestroyed || !npc.isMounted) return;
            var mount = npc.GetMounted();
            if (mount != null && !mount.IsDestroyed)
                mount.DismountPlayer(npc);
            if (npc.isMounted)
                npc.DismountObject();
        }

        private static BaseMountable ResolveWaterWheelMountable(BaseEntity start, string prefabSub)
        {
            if (string.IsNullOrEmpty(prefabSub)) prefabSub = "waterwheel";
            var ent = start;
            for (var i = 0; i < 16 && ent != null; i++)
            {
                var pn = ent.PrefabName ?? "";
                if (pn.IndexOf(prefabSub, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    var m = ent.GetComponentInChildren<BaseMountable>();
                    if (m != null && !m.IsDestroyed) return m;
                }

                ent = ent.GetParentEntity();
            }

            return null;
        }

        #region Mixing table workstation

        private void RemoveMixingSessionsForTable(ulong tableNetId)
        {
            var toClear = new List<ulong>();
            foreach (var kv in _mixingByNpcNetId)
            {
                if (kv.Value != null && kv.Value.TableNetId == tableNetId)
                    toClear.Add(kv.Key);
            }

            foreach (var nid in toClear)
                StopMixingSessionInternal(nid, restoreRoam: true, issuer: null);
        }

        private void StopMixingSessionInternal(ulong npcNetId, bool restoreRoam, BasePlayer issuer)
        {
            _mixingByNpcNetId.Remove(npcNetId);
            if (restoreRoam)
                TryRestoreMixingRoamTask(npcNetId);
            if (issuer != null && !issuer.IsDestroyed)
                issuer.ChatMessage("[BaseBotch] Mixing station duty stopped for that bot.");
        }

        private void SaveMixingSessionAndPauseRoam(BasePlayer npc, ulong anchorSteam)
        {
            if (npc?.net == null) return;
            var id = npc.net.ID.Value;
            _mixingRestorePending.Remove(id);
            var taskKw = "gather";
            if (RoamingNPCs != null && RoamingNPCs.IsLoaded)
            {
                try
                {
                    var raw = RoamingNPCs.Call("GetBridgeTaskLabel", id);
                    taskKw = NormalizeTaskKeyword(raw?.ToString() ?? "");
                }
                catch
                {
                    taskKw = "gather";
                }
            }

            _mixingRestorePending[id] = new MixingRestoreState { TaskKeyword = taskKw, AnchorSteam = anchorSteam };
            if (!_cfg.MixingPauseRoamingAi || RoamingNPCs == null || !RoamingNPCs.IsLoaded) return;
            try
            {
                RoamingNPCs.Call("ApplyBridgeTask", id, anchorSteam, "idle");
            }
            catch (Exception ex)
            {
                PrintWarning($"[BaseBotch] ApplyBridgeTask idle before mixing: {ex.Message}");
            }
        }

        private void TryRestoreMixingRoamTask(ulong npcNetId)
        {
            if (!_mixingRestorePending.TryGetValue(npcNetId, out var st)) return;
            _mixingRestorePending.Remove(npcNetId);
            if (RoamingNPCs == null || !RoamingNPCs.IsLoaded) return;
            var kw = (st.TaskKeyword ?? "").Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(kw) || kw == "idle")
                kw = "mixed";
            try
            {
                RoamingNPCs.Call("ApplyBridgeTask", npcNetId, st.AnchorSteam, kw);
            }
            catch (Exception ex)
            {
                PrintWarning($"[BaseBotch] Restore bridge task after mixing: {ex.Message}");
            }
        }

        private void MixingStationPollTick()
        {
            if (_mixingByNpcNetId.Count == 0) return;
            var copy = new List<KeyValuePair<ulong, MixingStationSession>>(_mixingByNpcNetId);
            foreach (var kv in copy)
                ProcessOneMixingSession(kv.Key, kv.Value);
        }

        private void ProcessOneMixingSession(ulong npcNetId, MixingStationSession session)
        {
            if (session == null) return;
            var npc = BaseNetworkable.serverEntities.Find(new NetworkableId(npcNetId)) as BasePlayer;
            if (npc == null || npc.IsDestroyed || !npc.IsNpc)
            {
                _mixingByNpcNetId.Remove(npcNetId);
                return;
            }

            var tableEnt = BaseNetworkable.serverEntities.Find(new NetworkableId(session.TableNetId));
            var table = tableEnt as MixingTable;
            if (table == null || table.IsDestroyed)
            {
                StopMixingSessionInternal(npcNetId, restoreRoam: true, issuer: null);
                return;
            }

            if (_cfg.MixingTeleportNpcToStand &&
                Vector3.Distance(npc.transform.position, table.transform.position) > 3.2f)
                TryTeleportNpcNearMixingTable(npc, table);

            if (!TryResolveMixingContainers(table, out var ingredientContainer, out var outputContainer))
            {
                if (_cfg.MixingDebugReflection)
                    PrintWarning("[BaseBotch] Mixing: could not resolve ingredient/output ItemContainers (check game build).");
                return;
            }

            if (MixingTableIsBusy(table))
                return;

            if (outputContainer != null)
                MoveAllItemsToPlayer(npc, outputContainer);

            if (!_cfg.MixingRecipes.TryGetValue(session.RecipeId ?? "", out var recipe) || recipe?.Ingredients == null ||
                recipe.Ingredients.Count == 0)
                return;

            if (_cfg.MixingPullFromAnchorStorage && session.AnchorSteam != 0UL)
                TryPullMissingRecipeIngredientsFromAnchorStorage(npc, recipe, session.AnchorSteam, session.TableNetId);

            if (!PlayerMainHasFullRecipe(npc, recipe))
                return;

            if (!TryClearContainer(ingredientContainer))
                return;

            if (!TryDepositRecipeFromPlayer(npc, ingredientContainer, recipe))
                return;

            if (!TryInvokeStartMix(table, npc) && !_mixingStartMixLoggedFail)
            {
                _mixingStartMixLoggedFail = true;
                PrintWarning(
                    "[BaseBotch] Mixing: could not invoke a StartMix-style method on MixingTable via reflection. " +
                    "Ingredients are placed; you may need a game update or report your Rust build to RustMaxx.");
            }
        }

        private static void MoveAllItemsToPlayer(BasePlayer npc, ItemContainer container)
        {
            if (npc?.inventory?.containerMain == null || container == null) return;
            var dest = npc.inventory.containerMain;
            for (var i = container.itemList.Count - 1; i >= 0; i--)
            {
                var it = container.itemList[i];
                if (it == null) continue;
                if (!it.MoveToContainer(dest)) it.Drop(npc.transform.position, npc.GetDropVelocity());
            }
        }

        private static bool TryClearContainer(ItemContainer c)
        {
            if (c == null) return false;
            try
            {
                for (var i = c.itemList.Count - 1; i >= 0; i--)
                {
                    var it = c.itemList[i];
                    it?.RemoveFromContainer();
                    it?.Remove();
                }

                return true;
            }
            catch
            {
                return false;
            }
        }

        private static bool TryDepositRecipeFromPlayer(BasePlayer npc, ItemContainer dest, MixingRecipeCfg recipe)
        {
            if (npc?.inventory?.containerMain == null || dest == null) return false;
            var src = npc.inventory.containerMain;
            var slot = 0;
            foreach (var ing in recipe.Ingredients)
            {
                if (ing == null || string.IsNullOrWhiteSpace(ing.ShortName) || ing.Amount <= 0) continue;
                var def = ItemManager.FindItemDefinition(ing.ShortName.Trim());
                if (def == null) return false;
                var need = ing.Amount;
                while (need > 0)
                {
                    var item = FindItemInContainer(src, def);
                    if (item == null) return false;
                    var take = Mathf.Min(need, item.amount);
                    var stack = take >= item.amount ? item : item.SplitItem(take);
                    if (stack == null || stack.amount < take) return false;
                    if (!stack.MoveToContainer(dest, slot, true))
                    {
                        stack.Drop(npc.transform.position, npc.GetDropVelocity());
                        return false;
                    }

                    need -= take;
                }

                slot++;
            }

            return true;
        }

        private static bool PlayerMainHasFullRecipe(BasePlayer npc, MixingRecipeCfg recipe)
        {
            if (npc?.inventory?.containerMain == null || recipe?.Ingredients == null) return false;
            var main = npc.inventory.containerMain;
            foreach (var ing in recipe.Ingredients)
            {
                if (ing == null || string.IsNullOrWhiteSpace(ing.ShortName) || ing.Amount <= 0) continue;
                var def = ItemManager.FindItemDefinition(ing.ShortName.Trim());
                if (def == null) return false;
                if (CountItemsInContainer(main, def) < ing.Amount) return false;
            }

            return true;
        }

        private static int CountItemsInContainer(ItemContainer c, ItemDefinition def)
        {
            if (c == null || def == null) return 0;
            var n = 0;
            foreach (var it in c.itemList)
            {
                if (it != null && it.info == def) n += it.amount;
            }

            return n;
        }

        /// <summary>Move missing stacks from anchor-owned <see cref="StorageContainer"/>s near the table into the bot main bag.</summary>
        private void TryPullMissingRecipeIngredientsFromAnchorStorage(BasePlayer npc, MixingRecipeCfg recipe, ulong anchorSteamId,
            ulong mixingTableNetId)
        {
            if (npc?.inventory?.containerMain == null || recipe?.Ingredients == null || anchorSteamId == 0UL) return;
            var main = npc.inventory.containerMain;
            var center = npc.transform.position;
            var radius = Mathf.Clamp(_cfg.MixingIngredientSearchRadiusMeters, 4f, 80f);
            var maxEnt = Mathf.Clamp(_cfg.MixingIngredientSearchMaxEntities, 16, 256);
            var list = Pool.Get<List<BaseEntity>>();
            try
            {
                Vis.Entities(center, radius, list,
                    LayerMask.GetMask("Deployed", "Construction", "Default", "World"), QueryTriggerInteraction.Ignore);
                var storages = new List<StorageContainer>();
                foreach (var ent in list)
                {
                    if (ent == null || ent.IsDestroyed || ent.net == null) continue;
                    if (ent.net.ID.Value == mixingTableNetId) continue;
                    if (ent is not StorageContainer sc) continue;
                    if (sc.inventory == null) continue;
                    if (sc.OwnerID != anchorSteamId) continue;
                    if (storages.Count >= maxEnt) break;
                    storages.Add(sc);
                }

                storages.Sort((a, b) => Vector3.Distance(center, a.transform.position)
                    .CompareTo(Vector3.Distance(center, b.transform.position)));

                foreach (var ing in recipe.Ingredients)
                {
                    if (ing == null || string.IsNullOrWhiteSpace(ing.ShortName) || ing.Amount <= 0) continue;
                    var def = ItemManager.FindItemDefinition(ing.ShortName.Trim());
                    if (def == null) continue;
                    var have = CountItemsInContainer(main, def);
                    var missing = ing.Amount - have;
                    if (missing <= 0) continue;
                    foreach (var sc in storages)
                    {
                        if (missing <= 0) break;
                        missing -= TryMoveItemAmountBetweenContainers(sc.inventory, def, missing, main, npc);
                    }
                }
            }
            finally
            {
                Pool.FreeUnmanaged(ref list);
            }
        }

        /// <summary>Returns amount actually moved.</summary>
        private static int TryMoveItemAmountBetweenContainers(ItemContainer src, ItemDefinition def, int need,
            ItemContainer dest, BasePlayer npcForDropFallback)
        {
            if (src == null || dest == null || def == null || need <= 0) return 0;
            var moved = 0;
            while (need > 0)
            {
                var item = FindItemInContainer(src, def);
                if (item == null) break;
                var take = Mathf.Min(need, item.amount);
                var stack = take >= item.amount ? item : item.SplitItem(take);
                if (stack == null) break;
                if (!stack.MoveToContainer(dest))
                {
                    if (npcForDropFallback != null)
                        stack.Drop(npcForDropFallback.transform.position, npcForDropFallback.GetDropVelocity());
                    else
                        stack.Remove();
                    break;
                }

                moved += take;
                need -= take;
            }

            return moved;
        }

        private static Item FindItemInContainer(ItemContainer c, ItemDefinition def)
        {
            if (c == null || def == null) return null;
            foreach (var it in c.itemList)
            {
                if (it != null && it.info == def) return it;
            }

            return null;
        }

        private void TryTeleportNpcNearMixingTable(BasePlayer npc, MixingTable table)
        {
            if (npc == null || table == null) return;
            try
            {
                var tpos = table.transform.position;
                var flatFwd = table.transform.forward;
                flatFwd.y = 0f;
                if (flatFwd.sqrMagnitude < 0.01f) flatFwd = Vector3.forward;
                flatFwd.Normalize();
                var stand = tpos - flatFwd * Mathf.Clamp(_cfg.MixingStandOffsetMeters, 0.4f, 3f);
                stand.y = TerrainMeta.HeightMap.GetHeight(stand);
                npc.transform.position = stand;
                npc.transform.LookAt(new Vector3(tpos.x, npc.transform.position.y, tpos.z));
                npc.SendNetworkUpdate();
            }
            catch
            {
                // ignored
            }
        }

        private static bool TryResolveMixingContainers(MixingTable table, out ItemContainer ingredients, out ItemContainer output)
        {
            ingredients = null;
            output = null;
            if (table == null) return false;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            foreach (var f in typeof(MixingTable).GetFields(bf))
            {
                if (f.FieldType != typeof(ItemContainer)) continue;
                var n = f.Name.ToLowerInvariant();
                var ic = f.GetValue(table) as ItemContainer;
                if (ic == null) continue;
                if (n.Contains("output") || n.Contains("result") || n.Contains("product"))
                    output = ic;
                else
                    ingredients = ic;
            }

            if (ingredients != null && output != null && !ReferenceEquals(ingredients, output))
                return true;

            var list = new List<ItemContainer>();
            foreach (var f in typeof(MixingTable).GetFields(bf))
            {
                if (f.FieldType != typeof(ItemContainer)) continue;
                if (f.GetValue(table) is ItemContainer ic && !list.Contains(ic)) list.Add(ic);
            }

            if (list.Count >= 2)
            {
                list.Sort((a, b) => b.capacity.CompareTo(a.capacity));
                ingredients = list[0];
                output = list[1];
                return true;
            }

            if (table is StorageContainer sc && sc.inventory != null)
            {
                ingredients = sc.inventory;
                output = sc.inventory;
                return true;
            }

            return false;
        }

        private static bool MixingTableIsBusy(MixingTable table)
        {
            if (table == null) return false;
            foreach (var name in new[] { "IsMixing", "mixingInProgress", "isMixing", "Mixing" })
            {
                var v = TryGetMemberValue(table, name);
                if (v is bool b) return b;
            }

            return false;
        }

        private static object TryGetMemberValue(object target, string name)
        {
            if (target == null) return null;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            var t = target.GetType();
            var p = t.GetProperty(name, bf);
            if (p != null && p.CanRead)
                return p.GetValue(target);
            var f = t.GetField(name, bf);
            return f?.GetValue(target);
        }

        private static bool TryInvokeStartMix(MixingTable table, BasePlayer player)
        {
            if (table == null || player == null) return false;
            const BindingFlags bf = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            var t = typeof(MixingTable);
            foreach (var methodName in new[]
                     {
                         "StartMixing", "BeginMix", "TryStartMix", "StartMix", "ServerStartMix", "SVStartMix",
                     })
            {
                foreach (var m in t.GetMethods(bf))
                {
                    if (!string.Equals(m.Name, methodName, StringComparison.Ordinal)) continue;
                    try
                    {
                        var ps = m.GetParameters();
                        if (ps.Length == 1 && ps[0].ParameterType == typeof(BasePlayer))
                        {
                            m.Invoke(table, new object[] { player });
                            return true;
                        }

                        if (ps.Length == 0)
                        {
                            m.Invoke(table, null);
                            return true;
                        }
                    }
                    catch
                    {
                        // try next
                    }
                }
            }

            foreach (var m in t.GetMethods(bf))
            {
                if (m.IsSpecialName) continue;
                if (m.Name.IndexOf("mix", StringComparison.OrdinalIgnoreCase) < 0) continue;
                var ps = m.GetParameters();
                if (ps.Length != 1 || ps[0].ParameterType != typeof(BasePlayer)) continue;
                try
                {
                    m.Invoke(table, new object[] { player });
                    return true;
                }
                catch
                {
                    // ignored
                }
            }

            return false;
        }

        private ulong ResolveMixingAnchorForNpc(ulong npcEntityNetId, BasePlayer issuer, object anchorSteamObj)
        {
            var anchorSteam = ParseAnchorSteam(anchorSteamObj, issuer);
            if (anchorSteam == 0UL && RoamingNPCs != null && RoamingNPCs.IsLoaded)
            {
                try
                {
                    var rawA = RoamingNPCs.Call("GetBridgeProtectAnchorUserId", npcEntityNetId);
                    if (rawA is ulong ua && ua != 0UL) anchorSteam = ua;
                    else if (rawA is long la && la > 0) anchorSteam = (ulong)la;
                }
                catch
                {
                    /* ignored */
                }
            }

            if (anchorSteam == 0UL && issuer != null) anchorSteam = issuer.userID;
            return anchorSteam;
        }

        /// <summary>Nearest <see cref="MixingTable"/> to <paramref name="center"/> (for GUI assign without look ray).</summary>
        private MixingTable FindNearestMixingTable(Vector3 center, float maxRadiusMeters)
        {
            maxRadiusMeters = Mathf.Clamp(maxRadiusMeters, 2f, 40f);
            var maxSqr = maxRadiusMeters * maxRadiusMeters;
            var list = Pool.Get<List<BaseEntity>>();
            try
            {
                Vis.Entities(center, maxRadiusMeters, list,
                    LayerMask.GetMask("Deployed", "Construction", "Default", "World"), QueryTriggerInteraction.Ignore);
                MixingTable best = null;
                var bestSqr = float.MaxValue;
                foreach (var ent in list)
                {
                    if (ent == null || ent.IsDestroyed) continue;
                    var mt = ent as MixingTable ?? ent.GetComponent<MixingTable>();
                    if (mt == null || mt.IsDestroyed || mt.net == null) continue;
                    var sqr = (center - mt.transform.position).sqrMagnitude;
                    if (sqr <= maxSqr && sqr < bestSqr)
                    {
                        bestSqr = sqr;
                        best = mt;
                    }
                }

                return best;
            }
            finally
            {
                Pool.FreeUnmanaged(ref list);
            }
        }

        private bool TryCompleteMixingTableAssignment(BasePlayer npc, MixingTable table, BasePlayer issuer, ulong anchorSteam,
            object recipeIdObj)
        {
            if (npc == null || table == null || table.IsDestroyed || table.net == null || issuer == null) return false;

            var rid = string.IsNullOrWhiteSpace(recipeIdObj?.ToString())
                ? "lowgrade_fuel"
                : recipeIdObj.ToString().Trim().ToLowerInvariant();
            if (!_cfg.MixingRecipes.ContainsKey(rid))
            {
                issuer.ChatMessage($"[BaseBotch] Unknown recipe id '{rid}'. Add it under MixingRecipes in BaseBotch.json.");
                return false;
            }

            SaveMixingSessionAndPauseRoam(npc, anchorSteam);
            _mixingByNpcNetId[npc.net.ID.Value] = new MixingStationSession
            {
                TableNetId = table.net.ID.Value,
                RecipeId = rid,
                AnchorSteam = anchorSteam,
            };

            issuer.ChatMessage(
                anchorSteam != 0UL
                    ? $"[BaseBotch] Mixing duty (recipe: {rid}). Mats are pulled from your boxes within ~{_cfg.MixingIngredientSearchRadiusMeters:F0} m (OwnerID). Outputs go to the bot's bag."
                    : $"[BaseBotch] Mixing duty (recipe: {rid}). Set anchor Steam ID (MaxxInvaders bot) so mats can auto-pull from your storage; else keep mats in the bot's bag.");
            return true;
        }

        /// <summary>
        /// MaxxInvaders / RCON: assign an NPC bot to the mixing table you are looking at. Ingredients are pulled from anchor-owned storage when configured.
        /// Optional <paramref name="recipeIdObj"/> is recipe key from config (default lowgrade_fuel).
        /// </summary>
        [HookMethod("AssignNpcToMixingTableFromLook")]
        public object AssignNpcToMixingTableFromLook(ulong npcEntityNetId, BasePlayer issuer, object anchorSteamObj = null,
            object recipeIdObj = null)
        {
            if (issuer == null || !issuer.IsConnected) return false;
            var npc = BaseNetworkable.serverEntities.Find(new NetworkableId(npcEntityNetId)) as BasePlayer;
            if (npc == null || npc.IsDestroyed)
            {
                issuer.ChatMessage("[BaseBotch] NPC not found.");
                return false;
            }

            if (!npc.IsNpc)
            {
                issuer.ChatMessage("[BaseBotch] That entity is not an NPC bot.");
                return false;
            }

            if (npc.isMounted)
            {
                issuer.ChatMessage("[BaseBotch] Dismount the bot from vehicles/wheel before assigning a workstation.");
                return false;
            }

            var anchorSteam = ResolveMixingAnchorForNpc(npcEntityNetId, issuer, anchorSteamObj);

            if (issuer.eyes == null) return false;
            if (!Physics.Raycast(
                    issuer.eyes.HeadRay(),
                    out RaycastHit hit,
                    _cfg.MixingLookRayDistanceMeters,
                    Physics.DefaultRaycastLayers,
                    QueryTriggerInteraction.Ignore))
            {
                issuer.ChatMessage(
                    $"[BaseBotch] Nothing hit within {_cfg.MixingLookRayDistanceMeters:F0}m — look at the mixing table.");
                return false;
            }

            var hitEnt = hit.GetEntity();
            var table = ResolveMixingTableFromEntity(hitEnt);
            if (table == null || table.IsDestroyed || table.net == null)
            {
                issuer.ChatMessage("[BaseBotch] Not looking at a mixing table.");
                return false;
            }

            return TryCompleteMixingTableAssignment(npc, table, issuer, anchorSteam, recipeIdObj);
        }

        /// <summary>
        /// MaxxInvaders GUI: assign bot to the nearest mixing table within <see cref="ConfigData.MixingNearPlayerAssignRadiusMeters"/> of the player (stand next to the table). Same anchor/recipe rules as <see cref="AssignNpcToMixingTableFromLook"/>.
        /// </summary>
        [HookMethod("AssignNpcToMixingTableNearPlayer")]
        public object AssignNpcToMixingTableNearPlayer(ulong npcEntityNetId, BasePlayer issuer, object anchorSteamObj = null,
            object recipeIdObj = null)
        {
            if (issuer == null || !issuer.IsConnected) return false;
            var npc = BaseNetworkable.serverEntities.Find(new NetworkableId(npcEntityNetId)) as BasePlayer;
            if (npc == null || npc.IsDestroyed)
            {
                issuer.ChatMessage("[BaseBotch] NPC not found.");
                return false;
            }

            if (!npc.IsNpc)
            {
                issuer.ChatMessage("[BaseBotch] That entity is not an NPC bot.");
                return false;
            }

            if (npc.isMounted)
            {
                issuer.ChatMessage("[BaseBotch] Dismount the bot from vehicles/wheel before assigning a workstation.");
                return false;
            }

            var anchorSteam = ResolveMixingAnchorForNpc(npcEntityNetId, issuer, anchorSteamObj);
            var radius = Mathf.Clamp(_cfg.MixingNearPlayerAssignRadiusMeters, 2f, 40f);
            var table = FindNearestMixingTable(issuer.transform.position, radius);
            if (table == null)
            {
                issuer.ChatMessage(
                    $"[BaseBotch] No mixing table within {radius:F0} m — stand next to the table or use /bmix.assign while looking at it.");
                return false;
            }

            return TryCompleteMixingTableAssignment(npc, table, issuer, anchorSteam, recipeIdObj);
        }

        [HookMethod("StopNpcMixingStation")]
        public object StopNpcMixingStation(ulong npcEntityNetId, BasePlayer issuer)
        {
            if (!_mixingByNpcNetId.ContainsKey(npcEntityNetId))
            {
                issuer?.ChatMessage("[BaseBotch] That bot is not on mixing duty.");
                return false;
            }

            StopMixingSessionInternal(npcEntityNetId, restoreRoam: true, issuer);
            return true;
        }

        private static MixingTable ResolveMixingTableFromEntity(BaseEntity ent)
        {
            for (var i = 0; i < 14 && ent != null; i++)
            {
                if (ent is MixingTable mt && !mt.IsDestroyed) return mt;
                var c = ent.GetComponent<MixingTable>();
                if (c != null && !c.IsDestroyed) return c;
                ent = ent.GetParentEntity();
            }

            return null;
        }

        [ChatCommand("bmix.assign")]
        private void ChatMixAssign(BasePlayer player, string command, string[] args)
        {
            if (player == null) return;
            if (!player.IsAdmin)
            {
                player.ChatMessage("[BaseBotch] Admin only.");
                return;
            }

            if (args == null || args.Length < 1)
            {
                player.ChatMessage(
                    "Usage: /bmix.assign <entityNetId> [recipeId] [anchorSteam64]  —  look at mixing table. Anchor defaults to bridge streamer (RoamingNPCs) or your Steam ID.");
                return;
            }

            var npcId = args[0].Trim();
            var recipe = args.Length >= 2 ? args[1].Trim() : null;
            // Default 0: AssignNpcToMixingTableFromLook resolves Roaming bridge anchor first, then issuer.
            object anchorObj = 0UL;
            if (args.Length >= 3 &&
                ulong.TryParse(args[2].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var explicitAnchor) &&
                explicitAnchor > 0UL)
                anchorObj = explicitAnchor;

            if (!ulong.TryParse(npcId, NumberStyles.Integer, CultureInfo.InvariantCulture, out var eid))
            {
                player.ChatMessage("[BaseBotch] npcId must be the entity net ID (use MaxxInvaders npc list / F1 debug).");
                return;
            }

            AssignNpcToMixingTableFromLook(eid, player, anchorObj, recipe);
        }

        [ChatCommand("bmix.stop")]
        private void ChatMixStop(BasePlayer player, string command, string[] args)
        {
            if (player == null) return;
            if (!player.IsAdmin)
            {
                player.ChatMessage("[BaseBotch] Admin only.");
                return;
            }

            if (args == null || args.Length < 1)
            {
                player.ChatMessage("Usage: /bmix.stop <npcEntityNetId>");
                return;
            }

            if (!ulong.TryParse(args[0].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var eid))
            {
                player.ChatMessage("[BaseBotch] Invalid entity id.");
                return;
            }

            StopNpcMixingStation(eid, player);
        }

        #endregion
    }
}
