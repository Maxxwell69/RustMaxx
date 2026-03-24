using System;
using Newtonsoft.Json;
using UnityEngine;

namespace Oxide.Plugins
{
    /// <summary>Bridge API for NPCMaxx — spawn a roaming NPC from a config template with a custom display name.</summary>
    public partial class RoamingNPCs
    {
        /// <summary>
        /// Spawns one NPC using a clone of <paramref name="templateKey"/> from config (Amount forced to 1).
        /// Returns the spawned <see cref="CustomPet"/> or null on failure.
        /// </summary>
        public object SpawnFromTemplateForBridge(string templateKey, string displayName, string uniqueSuffix)
        {
            if (string.IsNullOrWhiteSpace(templateKey) || config?.bots == null)
                return null;
            string key = templateKey.Trim();
            if (!config.bots.TryGetValue(key, out BotSetup baseSetup) || baseSetup == null || !baseSetup.Enable)
                return null;

            string safe = SanitizeBridgeDisplayName(displayName);
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

            setup.Init();
            setup.Amount = 1;
            setup.Name = safe;

            string suffix = string.IsNullOrWhiteSpace(uniqueSuffix)
                ? $"{DateTime.UtcNow.Ticks}_{UnityEngine.Random.Range(1000, 9999)}"
                : uniqueSuffix.Trim();
            string uniqueKey = $"{key}_{suffix}";

            var data = new DataBot(uniqueKey, setup);
            data.DisplayName = safe;

            return Respawn(data);
        }

        /// <summary>
        /// Lightweight check for MaxxInvaders GUI / diagnostics: does this key exist in Bots settings and is it enabled?
        /// Returns: <c>ok</c>, <c>missing</c>, <c>disabled</c>, or <c>no_config</c>.
        /// </summary>
        public object IsBridgeTemplateReady(string templateKey)
        {
            if (string.IsNullOrWhiteSpace(templateKey) || config?.bots == null)
                return "no_config";
            var key = templateKey.Trim();
            if (!config.bots.TryGetValue(key, out BotSetup baseSetup) || baseSetup == null)
                return "missing";
            if (!baseSetup.Enable)
                return "disabled";
            return "ok";
        }

        private static string SanitizeBridgeDisplayName(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
                return null;
            string s = raw.Trim();
            if (s.Length > 24)
                s = s.Substring(0, 24);
            s = s.Replace("<", "").Replace(">", "");
            return string.IsNullOrEmpty(s) ? null : s;
        }
    }
}
