// BaseBotch — automation helpers for RustMaxx bots (water wheel mount, etc.).
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Facepunch;
using Oxide.Core;
using Oxide.Core.Plugins;
using Rust;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("BaseBotch", "RustMaxx", "1.2.0")]
    [Description("Base automation: mount Roaming NPCs on deployables (e.g. electric water wheel), autorun input, dismount.")]
    public class BaseBotch : RustPlugin
    {
        private ConfigData _cfg;
        private readonly HashSet<ulong> _autorunNpcNetIds = new();
        private readonly Dictionary<ulong, ulong> _npcToTrackedMountNetId = new();
        private Timer _autorunTimer;

        private static Type _cachedInputMessageType;
        private static PropertyInfo _cachedInputStateCurrentProp;
        private static FieldInfo _cachedInputStateCurrentField;

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
            if (npc == null || npc.IsDestroyed || !npc.isMounted)
            {
                _autorunNpcNetIds.Remove(npcNetId);
                _npcToTrackedMountNetId.Remove(npcNetId);
                return;
            }

            var m = npc.GetMounted();
            if (m == null || m.net == null)
            {
                _autorunNpcNetIds.Remove(npcNetId);
                _npcToTrackedMountNetId.Remove(npcNetId);
                return;
            }

            if (_npcToTrackedMountNetId.TryGetValue(npcNetId, out var expectedMountId))
            {
                if (m.net.ID.Value != expectedMountId)
                {
                    _autorunNpcNetIds.Remove(npcNetId);
                    _npcToTrackedMountNetId.Remove(npcNetId);
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

            if (!wrote)
                return;

            if (scheduleDoubleApply && _cfg.AutorunDoubleApplyNextTick)
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

            inp.current.buttons |= (int)BUTTON.FORWARD;
            if (_cfg.AutorunUseSprint)
                inp.current.buttons |= (int)BUTTON.SPRINT;
            npc.SendNetworkUpdate();
            return true;
        }

        private bool TryEnsureInputCurrent(InputState inp)
        {
            if (inp?.current != null) return true;
            if (_cachedInputMessageType == null || _cachedInputStateCurrentProp == null) return false;
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
                alt.current.buttons |= (int)BUTTON.FORWARD;
                if (_cfg.AutorunUseSprint)
                    alt.current.buttons |= (int)BUTTON.SPRINT;
                npc.SendNetworkUpdate();
                return true;
            }

            return false;
        }

        /// <summary>Best-effort: some builds expose generator power as floats on the wheel root.</summary>
        private void TryBumpWheelPowerViaReflection(BasePlayer npc)
        {
            var m = npc?.GetMounted();
            if (m == null) return;
            for (var ent = m as BaseEntity; ent != null; ent = ent.GetParentEntity())
            {
                foreach (var comp in ent.GetComponents<Component>())
                {
                    if (comp == null) continue;
                    var tn = comp.GetType().Name;
                    if (tn.IndexOf("Water", StringComparison.OrdinalIgnoreCase) < 0 &&
                        tn.IndexOf("Wheel", StringComparison.OrdinalIgnoreCase) < 0 &&
                        tn.IndexOf("Generator", StringComparison.OrdinalIgnoreCase) < 0 &&
                        tn.IndexOf("Electric", StringComparison.OrdinalIgnoreCase) < 0)
                        continue;

                    foreach (var f in comp.GetType().GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
                    {
                        if (f.FieldType != typeof(float) && f.FieldType != typeof(double)) continue;
                        var fn = f.Name;
                        if (fn.IndexOf("power", StringComparison.OrdinalIgnoreCase) < 0 &&
                            fn.IndexOf("output", StringComparison.OrdinalIgnoreCase) < 0 &&
                            fn.IndexOf("energy", StringComparison.OrdinalIgnoreCase) < 0 &&
                            fn.IndexOf("spin", StringComparison.OrdinalIgnoreCase) < 0)
                            continue;
                        try
                        {
                            if (f.FieldType == typeof(float))
                            {
                                var v = (float)f.GetValue(comp);
                                f.SetValue(comp, Mathf.Clamp(v + 2f, 0f, 500f));
                            }
                            else
                            {
                                var v = (double)f.GetValue(comp);
                                f.SetValue(comp, v + 2.0);
                            }
                        }
                        catch
                        {
                            // ignored
                        }
                    }
                }
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
            _autorunNpcNetIds.Remove(id);
            _npcToTrackedMountNetId.Remove(id);
        }

        [HookMethod("MountWaterWheelFromLook")]
        public object MountWaterWheelFromLook(ulong npcEntityNetId, BasePlayer issuer)
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

            ForgetNpc(npc);

            if (npc.isMounted)
                TryDismountNpc(npc);

            mount.MountPlayer(npc);
            var ok = npc.GetMounted() != null;
            if (!ok)
            {
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
        public object DismountWaterWheel(ulong npcEntityNetId, BasePlayer issuer)
        {
            if (npcEntityNetId == 0UL) return false;
            _autorunNpcNetIds.Remove(npcEntityNetId);
            _npcToTrackedMountNetId.Remove(npcEntityNetId);

            var npc = BaseNetworkable.serverEntities.Find(new NetworkableId(npcEntityNetId)) as BasePlayer;
            if (npc == null || npc.IsDestroyed)
            {
                issuer?.ChatMessage("[BaseBotch] NPC not found.");
                return false;
            }

            TryDismountNpc(npc);
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
