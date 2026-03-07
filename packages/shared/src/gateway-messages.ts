/**
 * Gateway → Plugin: commands (whitelist actions only).
 * Plugin → Gateway: command acks.
 */

export type GatewayCommandPayload =
  | { action: "give_item"; shortname: string; amount: number; steamId?: string }
  | { action: "effect"; effectId: string; params?: Record<string, unknown> }
  | { action: "custom"; id: string; params?: Record<string, unknown> };

export type GatewayCommandMessage = {
  type: "command";
  id: string;
  payload: GatewayCommandPayload;
  /** Unix ms */
  at: number;
};

export type CommandAckStatus = "ok" | "error" | "rejected";

export type CommandAckMessage = {
  type: "ack";
  commandId: string;
  status: CommandAckStatus;
  /** Optional error or rejection reason */
  message?: string;
  /** Unix ms */
  at: number;
};

export type GatewayToPluginMessage = GatewayCommandMessage;

export type PluginToGatewayAckMessage = CommandAckMessage;

export function isGatewayCommandMessage(
  m: unknown
): m is GatewayCommandMessage {
  if (typeof m !== "object" || m === null) return false;
  const x = m as GatewayCommandMessage;
  return (
    x.type === "command" &&
    typeof x.id === "string" &&
    typeof x.payload === "object" &&
    x.payload !== null &&
    typeof (x.payload as { action?: string }).action === "string" &&
    typeof x.at === "number"
  );
}

export function isCommandAckMessage(m: unknown): m is CommandAckMessage {
  if (typeof m !== "object" || m === null) return false;
  const x = m as CommandAckMessage;
  return (
    x.type === "ack" &&
    typeof x.commandId === "string" &&
    (x.status === "ok" || x.status === "error" || x.status === "rejected") &&
    typeof x.at === "number"
  );
}
