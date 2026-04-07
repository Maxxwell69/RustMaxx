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
    [Info("BaseBotch", "RustMaxx", "1.3.8")]
    [Description("Base automation: mount Roaming NPCs on deployables (e.g. electric water wheel), autorun input, dismount.")]
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

        private sealed class ConfigData
        {
            public float LookRayDistanceMeters = 8f;
            public string WaterWheelPrefabSubstring = "waterwheel";
            public bool AutorunAfterMount = true;
            public float AutorunTickSeconds = 0.02f;
            public bool AutorunUseSprint = true;
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
                }
                _autorunNpcNetIds.Remove(id);
                _npcToTrackedMountNetId.Remove(id);
                TryRestoreWheelRoamTask(id);
            }
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
                BumpWheelComponentFieldsAndMethods(comp, npc);
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
                TryInvokeIoEntityRefresh(comp);
            }

            if (_cfg.AutorunInvokeWheelMethods)
                TryInvokeWheelInputLikeMethods(comp, npc);

            TryDriveWaterWheelMountablePlayerInput(comp, npc);
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
                var wheelMethodHints = new List<string>();
                foreach (var c in comps)
                {
                    if (c == null) continue;
                    var n = c.GetType().Name;
                    if (!names.Contains(n))
                        names.Add(n);
                    if ((n.IndexOf("WaterWheel", StringComparison.OrdinalIgnoreCase) >= 0 ||
                         n.IndexOf("ElectricWaterWheel", StringComparison.OrdinalIgnoreCase) >= 0) &&
                        wheelMethodHints.Count == 0)
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
                                mn.IndexOf("drive", StringComparison.OrdinalIgnoreCase) < 0)
                                continue;
                            wheelMethodHints.Add($"{mn}({m.GetParameters().Length})");
                            if (wheelMethodHints.Count >= 20) break;
                        }
                    }
                    if (names.Count >= 24)
                        break;
                }

                Puts($"[BaseBotch][debug] wheelComponents mount={mountId} count={comps?.Length ?? 0} types=[{string.Join(", ", names.ToArray())}]");
                if (wheelMethodHints.Count > 0)
                    Puts($"[BaseBotch][debug] wheelMethods mount={mountId} methods=[{string.Join(", ", wheelMethodHints.ToArray())}]");
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
            if (!st.SnapshotBridgeTask || string.IsNullOrEmpty(st.TaskKeyword)) return;
            try
            {
                RoamingNPCs.Call("ApplyBridgeTask", npcNetId, st.AnchorSteam, st.TaskKeyword);
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
            if (!_wheelRestorePending.TryGetValue(id, out var st))
            {
                st = new WheelRestoreState { TaskKeyword = "", AnchorSteam = 0, SnapshotBridgeTask = false };
                _wheelRestorePending[id] = st;
            }

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
    }
}
