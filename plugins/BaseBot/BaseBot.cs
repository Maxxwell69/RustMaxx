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
    [Info("BaseBot", "RustMaxx", "1.1.0")]
    [Description("Base automation: mount Roaming NPCs on deployables (e.g. electric water wheel), autorun input, dismount.")]
    public class BaseBot : RustPlugin
    {
        private ConfigData _cfg;
        private readonly HashSet<ulong> _autorunNpcNetIds = new();
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
            if (_autorunTimer != null && !_autorunTimer.Destroyed)
                _autorunTimer.Destroy();
            _autorunTimer = null;
        }

        private void OnEntityKill(BaseNetworkable entity)
        {
            if (entity is BasePlayer bp && bp.net != null)
                _autorunNpcNetIds.Remove(bp.net.ID.Value);
        }

        private void AutorunTick()
        {
            if (_autorunNpcNetIds.Count == 0) return;
            var copy = new List<ulong>(_autorunNpcNetIds);
            foreach (var id in copy)
                ApplyAutorunInput(id);
        }

        private void ApplyAutorunInput(ulong npcNetId)
        {
            var npc = BaseNetworkable.serverEntities.Find(new NetworkableId(npcNetId)) as BasePlayer;
            if (npc == null || npc.IsDestroyed || !npc.isMounted)
            {
                _autorunNpcNetIds.Remove(npcNetId);
                return;
            }

            if (!IsNpcOnWaterWheelMount(npc))
            {
                _autorunNpcNetIds.Remove(npcNetId);
                return;
            }

            var inp = npc.serverInput;
            if (inp?.current == null) return;

            inp.current.buttons |= BUTTON.FORWARD;
            if (_cfg.AutorunUseSprint)
                inp.current.buttons |= BUTTON.SPRINT;
        }

        private bool IsNpcOnWaterWheelMount(BasePlayer npc)
        {
            if (npc == null || !npc.isMounted) return false;
            var m = npc.GetMounted();
            if (m == null) return false;
            var ent = m as BaseEntity;
            for (var i = 0; i < 16 && ent != null; i++)
            {
                var pn = ent.PrefabName ?? "";
                if (pn.IndexOf(_cfg.WaterWheelPrefabSubstring ?? "waterwheel", StringComparison.OrdinalIgnoreCase) >= 0)
                    return true;
                ent = ent.GetParentEntity();
            }

            return false;
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

            if (npc.isMounted)
                npc.DismountObject();

            mount.MountPlayer(npc);
            var ok = npc.GetMounted() != null;
            if (!ok)
            {
                issuer.ChatMessage("[BaseBot] Mount failed (seat busy or blocked).");
                return false;
            }

            if (_cfg.AutorunAfterMount)
                _autorunNpcNetIds.Add(npc.net.ID.Value);
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

            if (!npc.isMounted || !IsNpcOnWaterWheelMount(npc))
            {
                issuer?.ChatMessage("[BaseBot] Bot must be mounted on the electric water wheel.");
                return false;
            }

            _autorunNpcNetIds.Add(npc.net.ID.Value);
            return true;
        }

        /// <summary>Stop applying autorun input; bot stays on the wheel.</summary>
        [HookMethod("StopWaterWheelAutorun")]
        public object StopWaterWheelAutorun(ulong npcEntityNetId, BasePlayer issuer)
        {
            var npc = BaseNetworkable.serverEntities.Find(new NetworkableId(npcEntityNetId)) as BasePlayer;
            if (npc != null && npc.net != null)
                _autorunNpcNetIds.Remove(npc.net.ID.Value);
            else
                _autorunNpcNetIds.Remove(npcEntityNetId);
            return true;
        }

        /// <summary>Stop autorun and dismount the NPC.</summary>
        [HookMethod("DismountWaterWheel")]
        public object DismountWaterWheel(ulong npcEntityNetId, BasePlayer issuer)
        {
            if (npcEntityNetId == 0UL) return false;
            _autorunNpcNetIds.Remove(npcEntityNetId);

            var npc = BaseNetworkable.serverEntities.Find(new NetworkableId(npcEntityNetId)) as BasePlayer;
            if (npc == null || npc.IsDestroyed)
            {
                issuer?.ChatMessage("[BaseBot] NPC not found.");
                return false;
            }

            if (npc.isMounted)
                npc.DismountObject();
            return true;
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
