import type { PluginHeartbeatMessage } from "@rustmaxx/shared";

/**
 * Handle heartbeat from plugin (update last_seen, optional DB update).
 */
export function handleHeartbeat(
  _serverId: string,
  message: PluginHeartbeatMessage
): void {
  // Stub: in production update server_connections.last_heartbeat_at, last_seen_at.
  void _serverId;
  void message;
}
