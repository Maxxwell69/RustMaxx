import type { PluginAuthMessage } from "@rustmaxx/shared";

/**
 * Stub: verify plugin auth (serverId + token).
 * In production: hash token and compare to server_connections.connection_token_hashed,
 * and ensure server_id matches.
 */
export function verifyAuth(_message: PluginAuthMessage): boolean {
  const secret = process.env.GATEWAY_SECRET;
  if (!secret) return false;
  // Stub: accept any token when GATEWAY_SECRET is set (for local dev).
  // Replace with: lookup server by id, verify token hash.
  return typeof _message.serverId === "string" && _message.token.length > 0;
}
