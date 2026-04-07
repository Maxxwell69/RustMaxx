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
    [Info("BaseBotch", "RustMaxx", "1.3.1")]
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
        private Timer _autorunTimer;

        private sealed class WheelRestoreState
        {
            public string TaskKeyword;
            public ulong AnchorSteam;
        }

        private static Type _cachedInputMessageType;
        private static PropertyInfo _cachedInputStateCurrentProp;
        private static FieldInfo _cachedInputStateCurrentField;
        private static PropertyInfo _cachedInputStatePreviousProp;
        private static FieldInfo _cachedInputStatePreviousField;
        private static int _autorunTickPhase;

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
            if (_autorunTimer != null && !_autorunTimer.Destroyed)
                _autorunTimer.Destroy();
            _autorunTimer = null;
        }

        private void OnEntityKill(BaseNetworkable entity)
        {
            if (entity is BasePlayer bp && bp.net != null)
            {
                var id = bp.net.ID.Value;
                _autorunNpcNetIds.Remove(id);
                _npcToTrackedMountNetId.Remove(id);
                _wheelRestorePending.Remove(id);
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

            var wrote = TryWriteMovementButtons(npc);
            if (_cfg.AutorunTryWheelPowerReflection)
                TryBumpWheelPowerViaReflection(npc);

            TryInvokeInputFlush(npc, _cfg);

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

            foreach (var comp in comps)
                BumpWheelComponentFieldsAndMethods(comp);
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

        private void BumpWheelComponentFieldsAndMethods(Component comp)
        {
            if (comp == null) return;
            var tn = comp.GetType().Name;
            var scanAll = ComponentTypeLooksWheelRelated(tn);
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

            if (!scanAll) return;
            foreach (var method in comp.GetType().GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
            {
                if (method.ReturnType != typeof(void)) continue;
                var ps = method.GetParameters();
                if (ps.Length != 1 || ps[0].ParameterType != typeof(float)) continue;
                var mn = method.Name;
                if (mn.IndexOf("power", StringComparison.OrdinalIgnoreCase) < 0 &&
                    mn.IndexOf("spin", StringComparison.OrdinalIgnoreCase) < 0 &&
                    mn.IndexOf("human", StringComparison.OrdinalIgnoreCase) < 0 &&
                    mn.IndexOf("manual", StringComparison.OrdinalIgnoreCase) < 0 &&
                    mn.IndexOf("input", StringComparison.OrdinalIgnoreCase) < 0 &&
                    mn.IndexOf("drive", StringComparison.OrdinalIgnoreCase) < 0)
                    continue;
                try
                {
                    method.Invoke(comp, new object[] { 1f });
                }
                catch
                {
                    // ignored
                }
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
                _wheelBumpComponentCache.Remove(mountId);
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

            _wheelRestorePending[id] = new WheelRestoreState { TaskKeyword = taskKw, AnchorSteam = anchorSteam };

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
            if (RoamingNPCs == null || !RoamingNPCs.IsLoaded) return;
            if (string.IsNullOrEmpty(st.TaskKeyword)) return;
            try
            {
                RoamingNPCs.Call("ApplyBridgeTask", npcNetId, st.AnchorSteam, st.TaskKeyword);
            }
            catch (Exception ex)
            {
                PrintWarning($"[BaseBotch] Restore bridge task after wheel: {ex.Message}");
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
