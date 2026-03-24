// NPCMaxx — Oxide bridge for webhooks / RCON to spawn Roaming NPCs with a viewer display name.
// Requires: RoamingNPCs (SpawnFromTemplateForBridge lives in RoamingNPCs.cs MaxxInvaders bridge region).
// Install: copy this folder into servers/Rust/oxide/plugins/
//
// Webhook flow: listener → RCON: npcmaxx.spawn <templateKey> <displayName...>
// Example: npcmaxx.spawn bob_resources_farmer PirateMaxx

using System.Linq;
using Oxide.Core;

namespace Oxide.Plugins
{
    [Info("NPCMaxx", "RustMaxx", "1.0.0")]
    [Description("RCON bridge: spawn Roaming NPCs from a config template with a custom display name.")]
    public class NPCMaxx : RustPlugin
    {
        private const string LogPrefix = "[NPCMaxx]";

        [ConsoleCommand("npcmaxx.spawn")]
        private void CmdNpcmaxxSpawn(ConsoleSystem.Arg arg)
        {
            if (arg.Connection != null)
            {
                arg.ReplyWith("This command can only be run from server console or RCON.");
                return;
            }

            if (arg.Args == null || arg.Args.Length < 2)
            {
                arg.ReplyWith("Usage: npcmaxx.spawn <templateKey> <displayName ...>");
                arg.ReplyWith("Example: npcmaxx.spawn bob_resources_farmer Pirate Maxx");
                return;
            }

            string templateKey = arg.Args[0];
            string displayName = string.Join(" ", arg.Args.Skip(1).ToArray());
            if (string.IsNullOrWhiteSpace(displayName))
            {
                arg.ReplyWith("Error: empty display name.");
                return;
            }

            var roaming = plugins.Find("RoamingNPCs");
            if (roaming == null)
            {
                PrintWarning($"{LogPrefix} RoamingNPCs plugin is not loaded.");
                arg.ReplyWith("Error: RoamingNPCs not loaded.");
                return;
            }

            object result = roaming.Call("SpawnFromTemplateForBridge", templateKey, displayName, null);
            if (result == null)
            {
                PrintWarning($"{LogPrefix} Spawn failed (unknown template, disabled, blocked hook, or invalid name). template={templateKey} name={displayName}");
                arg.ReplyWith("Error: spawn failed.");
                return;
            }

            Puts($"{LogPrefix} Spawned roaming NPC template='{templateKey}' displayName='{displayName}'");
            arg.ReplyWith($"OK: spawned roaming NPC as '{displayName}'");
        }
    }
}
