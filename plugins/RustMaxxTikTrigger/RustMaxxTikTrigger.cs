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
    [Info("RustMaxxTikTrigger", "RustMaxx", "1.0.0")]
    [Description("RCON-only command for TikFinity webhook: tiktrigger <action> <viewerName> <giftName>")]
    public class RustMaxxTikTrigger : RustPlugin
    {
        #region Constants

        private const string LogPrefix = "[RustMaxxTikTrigger]";

        // Whitelist of allowed actions. Only these are executed; no arbitrary commands.
        private static readonly string[] AllowedActions = { "test", "rose", "smoke", "fireworks", "npcwave" };

        // Effect prefab paths (short names used by Rust). Adjust if your server uses different assets.
        private const string EffectSmoke = "fx/gas_explosion_small";
        private const string EffectFireworks = "fx/explosion_01";

        private const string ScientistPrefab = "assets/prefabs/npc/scientist/scientist.prefab";

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
                arg.ReplyWith("Usage: tiktrigger <action> <viewerName> <giftName>");
                return;
            }

            string action = arg.GetString(0).ToLowerInvariant();
            string viewerName = arg.GetString(1);
            string giftName = arg.GetString(2);

            if (!IsAllowedAction(action))
            {
                PrintWarning($"{LogPrefix} Unknown action '{action}' from viewer '{viewerName}' gift '{giftName}'. Ignored.");
                arg.ReplyWith($"Unknown action: {action}");
                return;
            }

            // Log every trigger to server console.
            Puts($"{LogPrefix} {viewerName} triggered action '{action}' from gift '{giftName}'");

            ExecuteAction(action, viewerName, giftName);
            arg.ReplyWith($"OK: {action}");
        }

        private static bool IsAllowedAction(string action)
        {
            foreach (string a in AllowedActions)
                if (a == action) return true;
            return false;
        }

        #endregion

        #region Action execution

        private void ExecuteAction(string action, string viewerName, string giftName)
        {
            BasePlayer target = GetFirstOnlinePlayer();
            if (target == null && ActionRequiresPlayer(action))
            {
                PrintWarning($"{LogPrefix} No players online. Action '{action}' cancelled.");
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

                default:
                    // Whitelist guarantees we don't reach here; defensive.
                    PrintWarning($"{LogPrefix} Unhandled action: {action}");
                    break;
            }
        }

        private static bool ActionRequiresPlayer(string action)
        {
            return action == "smoke" || action == "fireworks" || action == "npcwave";
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
        /// Returns the first connected, alive player. Used as target for effects/NPC when no specific viewer is chosen.
        /// Easy to extend later (e.g. random player, closest to point).
        /// </summary>
        private static BasePlayer GetFirstOnlinePlayer()
        {
            foreach (var player in BasePlayer.activePlayerList)
                if (player != null && player.IsConnected && !player.IsDead)
                    return player;
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
