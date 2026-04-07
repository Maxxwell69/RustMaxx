// BaseBot — automation helpers for RustMaxx bots (water wheel mount, etc.).
using System;
using System.Collections.Generic;
using Facepunch;
using Oxide.Core;
using Oxide.Core.Plugins;
using Rust;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("BaseBot", "RustMaxx", "1.1.2")]
    [Description("Base automation: mount Roaming NPCs on deployables (e.g. electric water wheel), autorun input, dismount.")]
    public class BaseBot : RustPlugin
    {
        private ConfigData _cfg;
        private readonly HashSet<ulong> _autorunNpcNetIds = new();
        /// <summary>Tracks which mountable the bot was placed on so autorun/dismount work even when prefab names do not include "waterwheel" on the seat entity.</summary>
        private readonly Dictionary<ulong, ulong> _npcToTrackedMountNetId = new();
        private Timer _autorunTimer;

        private sealed class ConfigData
        {
            public float LookRayDistanceMeters = 8f;

            /// <summary>Matched against <see cref="BaseEntity.PrefabName"/> (case-insensitive), e.g. waterwheel.</summary>
            public string WaterWheelPrefabSubstring = "waterwheel";

            /// <summary>After a successful water wheel mount, start holding forward/sprint input.</summary>
            public bool AutorunAfterMount = true;

            /// <summary>How often to re-apply movement buttons (seconds).</summary>
            public float AutorunTickSeconds = 0.05f;

            /// <summary>Hold sprint as well as forward (typical “autorun”).</summary>
            public bool AutorunUseSprint = true;

            /// <summary>Apply the same button mask again on the next tick (helps if RoamingNPCs/AI clears input between frames).</summary>
            public bool AutorunDoubleApplyNextTick = true;
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
            if (_autorunTimer != null && !_autorunTimer.Destroyed)
                _autorunTimer.Destroy();
            var interval = Mathf.Clamp(_cfg.AutorunTickSeconds, 0.02f, 0.25f);
            _autorunTimer = timer.Every(interval, AutorunTick);
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

            if (!TryWriteMovementButtons(npc))
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
            var inp = npc.serverInput;
            if (inp?.current == null) return false;

            inp.current.buttons |= (int)BUTTON.FORWARD;
            if (_cfg.AutorunUseSprint)
                inp.current.buttons |= (int)BUTTON.SPRINT;
            npc.SendNetworkUpdate();
            return true;
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

        /// <summary>
        /// Mounts the NPC identified by <paramref name="npcEntityNetId"/> onto the electric water wheel the issuer is looking at.
        /// </summary>
        [HookMethod("MountWaterWheelFromLook")]
        public object MountWaterWheelFromLook(ulong npcEntityNetId, BasePlayer issuer)
        {
            if (issuer == null || !issuer.IsConnected) return false;
            var npc = BaseNetworkable.serverEntities.Find(new NetworkableId(npcEntityNetId)) as BasePlayer;
            if (npc == null || npc.IsDestroyed)
            {
                issuer.ChatMessage("[BaseBot] NPC not found.");
                return false;
            }

            if (!npc.IsNpc)
            {
                issuer.ChatMessage("[BaseBot] That entity is not an NPC bot.");
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
                    $"[BaseBot] Nothing hit within {_cfg.LookRayDistanceMeters:F0}m — look at the water wheel.");
                return false;
            }

            var hitEnt = hit.GetEntity();
            if (hitEnt == null)
            {
                issuer.ChatMessage("[BaseBot] Ray hit has no entity.");
                return false;
            }

            var mount = ResolveWaterWheelMountable(hitEnt, _cfg.WaterWheelPrefabSubstring);
            if (mount == null || mount.IsDestroyed)
            {
                issuer.ChatMessage("[BaseBot] Not looking at an electric water wheel (mountable).");
                return false;
            }

            ForgetNpc(npc);

            if (npc.isMounted)
                TryDismountNpc(npc);

            mount.MountPlayer(npc);
            var ok = npc.GetMounted() != null;
            if (!ok)
            {
                issuer.ChatMessage("[BaseBot] Mount failed (seat busy or blocked).");
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

        /// <summary>Resume forward/sprint input while still mounted on the water wheel (after STOP).</summary>
        [HookMethod("StartWaterWheelAutorun")]
        public object StartWaterWheelAutorun(ulong npcEntityNetId, BasePlayer issuer)
        {
            var npc = BaseNetworkable.serverEntities.Find(new NetworkableId(npcEntityNetId)) as BasePlayer;
            if (npc == null || npc.IsDestroyed)
            {
                issuer?.ChatMessage("[BaseBot] NPC not found.");
                return false;
            }

            if (!npc.isMounted)
            {
                issuer?.ChatMessage("[BaseBot] Bot must be mounted.");
                return false;
            }

            var m = npc.GetMounted();
            if (m == null || m.net == null)
            {
                issuer?.ChatMessage("[BaseBot] No active mount.");
                return false;
            }

            if (!_npcToTrackedMountNetId.ContainsKey(npc.net.ID.Value) && !PrefabChainLooksLikeWaterWheel(m))
            {
                issuer?.ChatMessage("[BaseBot] Mount does not look like the electric water wheel.");
                return false;
            }

            RememberMountForNpc(npc, m);
            _autorunNpcNetIds.Add(npc.net.ID.Value);
            ApplyAutorunInput(npc.net.ID.Value, true);
            return true;
        }

        /// <summary>Stop applying autorun input; bot stays on the wheel.</summary>
        [HookMethod("StopWaterWheelAutorun")]
        public object StopWaterWheelAutorun(ulong npcEntityNetId, BasePlayer issuer)
        {
            _autorunNpcNetIds.Remove(npcEntityNetId);
            return true;
        }

        /// <summary>Stop autorun and dismount the NPC.</summary>
        [HookMethod("DismountWaterWheel")]
        public object DismountWaterWheel(ulong npcEntityNetId, BasePlayer issuer)
        {
            if (npcEntityNetId == 0UL) return false;
            _autorunNpcNetIds.Remove(npcEntityNetId);
            _npcToTrackedMountNetId.Remove(npcEntityNetId);

            var npc = BaseNetworkable.serverEntities.Find(new NetworkableId(npcEntityNetId)) as BasePlayer;
            if (npc == null || npc.IsDestroyed)
            {
                issuer?.ChatMessage("[BaseBot] NPC not found.");
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
