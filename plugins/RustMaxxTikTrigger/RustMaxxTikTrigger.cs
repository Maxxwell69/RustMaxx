// RustMaxxTikTrigger - uMod/Oxide plugin for Rust
//
// Purpose: Safe command interface for external systems (e.g. webhook listener connected to TikFinity)
// to trigger controlled in-game events via RCON.
//
// Webhook flow:
//   TikFinity → webhook listener → RCON command → tiktrigger <action> <viewerName> <giftName>
//   → RustMaxxTikTrigger executes the whitelisted action (effects, chat, NPC spawn).
//
// Install: copy RustMaxxTikTrigger.cs into servers/Rust/oxide/plugins/

using System;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("RustMaxxTikTrigger", "RustMaxx", "1.1.0")]
    [Description("RCON-only command for TikFinity webhook: tiktrigger <action> <viewerName> <giftName>. Effects target the configured streamer.")]
    public class RustMaxxTikTrigger : RustPlugin
    {
        #region Configuration

        private class PluginConfig
        {
            public string StreamerName { get; set; } = "pirate maxx";
        }

        private PluginConfig _config;

        protected override void LoadDefaultConfig() => _config = new PluginConfig();

        protected override void LoadConfig()
        {
            base.LoadConfig();
            try
            {
                _config = Config.ReadObject<PluginConfig>();
                if (_config == null || string.IsNullOrWhiteSpace(_config.StreamerName))
                    _config = new PluginConfig();
            }
            catch
            {
                LoadDefaultConfig();
            }
            SaveConfig();
        }

        private void SaveConfig() => Config.WriteObject(_config);

        #endregion

        #region Constants

        private const string LogPrefix = "[RustMaxxTikTrigger]";

        // Whitelist of allowed actions. Only these are executed; no arbitrary commands.
        private static readonly string[] AllowedActions = { "test", "rose", "smoke", "fireworks", "npcwave", "wolf" };

        // Effect prefab paths (full paths; short names like "fx/..." are not valid in current Rust).
        private const string EffectSmoke = "assets/bundled/prefabs/fx/smoke_signal_full.prefab";
        private const string EffectFireworks = "assets/bundled/prefabs/fx/fireball_small.prefab";

        private const string ScientistPrefab = "assets/prefabs/npc/scientist/scientist.prefab";
        private const string WolfPrefab = "assets/rust.ai/agents/wolf/wolf.prefab";

        #endregion

        #region Command

        [ConsoleCommand("tiktrigger")]
        private void CmdTikTrigger(ConsoleSystem.Arg arg)
        {
            // Only allow from server console or RCON (no in-game player execution).
            if (arg.Connection != null)
            {
                arg.ReplyWith("This command can only be run from server console or RCON.");
                return;
            }

            if (!arg.HasArgs(3))
            {
                arg.ReplyWith("Usage: tiktrigger <action> <viewerName> <giftName> [scrapAmount]");
                return;
            }

            string action = arg.GetString(0).ToLowerInvariant();
            string viewerName = arg.GetString(1);
            string giftName = arg.GetString(2);
            int scrapAmount = arg.HasArgs(4) ? arg.GetInt(3, 0) : 0;

            if (!IsAllowedAction(action))
            {
                PrintWarning($"{LogPrefix} Unknown action '{action}' from viewer '{viewerName}' gift '{giftName}'. Ignored.");
                arg.ReplyWith($"Unknown action: {action}");
                return;
            }

            // Log every trigger to server console.
            Puts($"{LogPrefix} {viewerName} triggered action '{action}' from gift '{giftName}'" + (scrapAmount > 0 ? $" (+{scrapAmount} scrap)" : ""));

            ExecuteAction(action, viewerName, giftName, scrapAmount);
            arg.ReplyWith($"OK: {action}" + (scrapAmount > 0 ? $" +{scrapAmount} scrap" : ""));
        }

        private static bool IsAllowedAction(string action)
        {
            foreach (string a in AllowedActions)
                if (a == action) return true;
            return false;
        }

        #endregion

        #region Action execution

        private void ExecuteAction(string action, string viewerName, string giftName, int scrapAmount)
        {
            BasePlayer target = GetStreamerPlayer();
            if (target == null && ActionRequiresPlayer(action))
            {
                PrintWarning($"{LogPrefix} Streamer '{_config.StreamerName}' not online. Action '{action}' cancelled.");
                return;
            }

            switch (action)
            {
                case "test":
                    BroadcastChat($"{viewerName} triggered a TikTok test event!");
                    break;

                case "rose":
                    BroadcastChat($"{viewerName} sent a {giftName}!");
                    break;

                case "smoke":
                    if (target != null)
                    {
                        BroadcastChat($"{viewerName} sent a {giftName}!");
                        SpawnEffect(EffectSmoke, GetPositionNear(target));
                    }
                    break;

                case "fireworks":
                    if (target != null)
                    {
                        BroadcastChat($"{viewerName} sent a {giftName}!");
                        Vector3 pos = GetPositionNear(target);
                        SpawnEffect(EffectFireworks, pos);
                    }
                    break;

                case "npcwave":
                    if (target != null)
                    {
                        BroadcastChat($"{viewerName} sent a {giftName}!");
                        SpawnNPC(ScientistPrefab, GetPositionNear(target));
                    }
                    break;

                case "wolf":
                    if (target != null)
                    {
                        BroadcastChat($"{viewerName} sent a {giftName}!");
                        SpawnNPC(WolfPrefab, GetPositionNear(target));
                    }
                    break;

                default:
                    // Whitelist guarantees we don't reach here; defensive.
                    PrintWarning($"{LogPrefix} Unhandled action: {action}");
                    break;
            }

            if (scrapAmount > 0 && target != null)
                GiveScrapToPlayer(target, scrapAmount);
        }

        /// <summary>
        /// Gives scrap to the streamer (gift value from TikTok). Capped per call to avoid abuse.
        /// </summary>
        private static void GiveScrapToPlayer(BasePlayer player, int amount)
        {
            if (player == null || !player.IsValid() || amount <= 0) return;
            const int maxScrapPerTrigger = 10000;
            int give = Math.Min(amount, maxScrapPerTrigger);
            ItemDefinition scrapDef = ItemManager.FindItemDefinition("scrap");
            if (scrapDef == null) return;
            Item item = ItemManager.Create(scrapDef, give, 0ul);
            if (item == null) return;
            item.MoveToContainer(player.inventory.containerMain);
        }

        private static bool ActionRequiresPlayer(string action)
        {
            return action == "smoke" || action == "fireworks" || action == "npcwave" || action == "wolf";
        }

        private static Vector3 GetPositionNear(BasePlayer player)
        {
            if (player == null || !player.IsValid()) return Vector3.zero;
            Vector3 pos = player.transform.position;
            // Offset slightly so effect/NPC is visible beside the player.
            return pos + UnityEngine.Random.insideUnitSphere * 2f;
        }

        #endregion

        #region Helpers

        /// <summary>
        /// Returns the streamer (player whose display name matches config). Effects and NPCs spawn at/near this player.
        /// If not found or not online, returns null.
        /// </summary>
        private BasePlayer GetStreamerPlayer()
        {
            if (string.IsNullOrWhiteSpace(_config?.StreamerName)) return null;
            string name = _config.StreamerName.Trim();
            foreach (var player in BasePlayer.activePlayerList)
            {
                if (player == null || !player.IsConnected || player.IsDead()) continue;
                if (string.Equals(player.displayName, name, StringComparison.OrdinalIgnoreCase))
                    return player;
            }
            return null;
        }

        /// <summary>
        /// Spawns a one-shot effect at the given world position.
        /// Effect names are from the game manifest (e.g. fx/gas_explosion_small, fx/explosion_01).
        /// </summary>
        private static void SpawnEffect(string effectName, Vector3 position)
        {
            if (string.IsNullOrEmpty(effectName) || position == Vector3.zero) return;
            Effect.server.Run(effectName, position, Vector3.up, null, true);
        }

        /// <summary>
        /// Spawns an NPC (e.g. scientist) at the given position. Clean entry point to add more NPC types later.
        /// </summary>
        private static void SpawnNPC(string prefabPath, Vector3 position)
        {
            if (string.IsNullOrEmpty(prefabPath) || position == Vector3.zero) return;
            BaseEntity entity = GameManager.server.CreateEntity(prefabPath, position, Quaternion.identity, true);
            if (entity != null)
                entity.Spawn();
        }

        #endregion

        #region Chat

        private void BroadcastChat(string message)
        {
            if (string.IsNullOrEmpty(message)) return;
            foreach (var player in BasePlayer.activePlayerList)
                if (player != null && player.IsConnected)
                    PrintToChat(player, message);
        }

        #endregion
    }
}
