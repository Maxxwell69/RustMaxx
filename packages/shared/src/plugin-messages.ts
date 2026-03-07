/**
 * Plugin → Gateway: auth and heartbeat messages (from Rust server plugin).
 */

export type PluginAuthMessage = {
  type: "auth";
  serverId: string;
  token: string;
  /** Optional plugin version for compatibility checks */
  version?: string;
};

export type PluginHeartbeatMessage = {
  type: "heartbeat";
  serverId: string;
  /** Unix ms */
  at: number;
  /** Optional status payload */
  status?: Record<string, unknown>;
};

export type PluginMessage = PluginAuthMessage | PluginHeartbeatMessage;

export function isPluginAuthMessage(
  m: unknown
): m is PluginAuthMessage {
  return (
    typeof m === "object" &&
    m !== null &&
    (m as PluginAuthMessage).type === "auth" &&
    typeof (m as PluginAuthMessage).serverId === "string" &&
    typeof (m as PluginAuthMessage).token === "string"
  );
}

export function isPluginHeartbeatMessage(
  m: unknown
): m is PluginHeartbeatMessage {
  return (
    typeof m === "object" &&
    m !== null &&
    (m as PluginHeartbeatMessage).type === "heartbeat" &&
    typeof (m as PluginHeartbeatMessage).serverId === "string" &&
    typeof (m as PluginHeartbeatMessage).at === "number"
  );
}
