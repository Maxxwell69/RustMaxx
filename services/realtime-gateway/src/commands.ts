import type { CommandAckMessage, GatewayCommandMessage } from "@rustmaxx/shared";

/**
 * Command dispatch interface: send whitelist commands to a connection,
 * and record acks from the plugin.
 */
export const handleCommandDispatch = {
  /** Send a command to a connected plugin (by serverId). Call from API or event pipeline. */
  send(_serverId: string, _message: GatewayCommandMessage): boolean {
    // Stub: in production look up WebSocket by serverId and ws.send(JSON.stringify(message)).
    return false;
  },

  /** Record ack from plugin (for logging / idempotency). */
  ack(_message: CommandAckMessage): void {
    // Stub: in production write to command_logs.
  },
};
