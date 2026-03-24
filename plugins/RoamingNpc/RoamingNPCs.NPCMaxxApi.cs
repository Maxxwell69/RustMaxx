using System;
using System.Linq;
using System.Text;
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

        /// <summary>Human-readable RoamingNPCs config summary for MaxxInvaders admin GUI (Setup tab).</summary>
        public object GetMaxxInvadersGuiSummary()
        {
            var sb = new StringBuilder();
            try
            {
                sb.AppendLine("<b>RoamingNPCs</b>  oxide/config/RoamingNPCs.json");
                sb.AppendLine();
                sb.AppendLine($"Version: {Version}");
                sb.AppendLine("Bridge API: SpawnFromTemplateForBridge, IsBridgeTemplateReady, GetMaxxInvadersGuiSummary");
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
                sb.AppendLine("Display names from MaxxInvaders are sanitized (max 24 chars, no angle brackets).");
            }
            catch (Exception ex)
            {
                sb.AppendLine($"Summary error: {ex.Message}");
            }

            return sb.ToString();
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
