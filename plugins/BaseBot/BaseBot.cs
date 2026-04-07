// BaseBot — automation helpers for RustMaxx bots (water wheel mount, etc.).
using System;
using Facepunch;
using Oxide.Core.Plugins;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("BaseBot", "RustMaxx", "1.0.0")]
    [Description("Base automation: mount Roaming NPCs on deployables (e.g. electric water wheel) from admin look ray.")]
    public class BaseBot : RustPlugin
    {
        private ConfigData _cfg;

        private sealed class ConfigData
        {
            public float LookRayDistanceMeters = 8f;

            /// <summary>Matched against <see cref="BaseEntity.PrefabName"/> (case-insensitive), e.g. waterwheel.</summary>
            public string WaterWheelPrefabSubstring = "waterwheel";
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
                issuer.ChatMessage("[BaseBot] Mount failed (seat busy or blocked).");
            return ok;
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
