/**
 * Whitelist action pipeline: only predefined actions are executed.
 * No raw RCON command execution from events.
 */

import { runAndWait, ensureConnection } from "@/lib/rcon-manager";
import { getServerIfAccessible } from "@/lib/server-access";
import type { UserRole } from "@/lib/permissions";

const MAX_BROADCAST_LENGTH = 200;
const ALLOWED_ACTION_IDS = ["broadcast"] as const;

export type WhitelistAction = { action_id: string; action_params: Record<string, unknown> | null };

/**
 * Sanitize message for in-game say: no newlines, no control chars, length limit.
 */
function sanitizeBroadcastMessage(msg: string): string {
  const trimmed = String(msg)
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return trimmed.slice(0, MAX_BROADCAST_LENGTH);
}

/**
 * Execute whitelist action "broadcast" on a server: sends in-game say command only.
 * Caller must have already verified the user has access to the server.
 */
export async function dispatchBroadcast(
  serverId: string,
  userId: string,
  role: UserRole,
  message: string
): Promise<{ ok: boolean; error?: string }> {
  const server = await getServerIfAccessible(serverId, userId, role);
  if (!server) return { ok: false, error: "Server not found or access denied" };

  const sanitized = sanitizeBroadcastMessage(message);
  if (!sanitized) return { ok: false, error: "Empty message" };

  const ensured = await ensureConnection(
    serverId,
    server.rcon_host,
    server.rcon_port,
    server.rcon_password,
    async () => {}
  );
  if (!ensured.ok) return { ok: false, error: ensured.error ?? "RCON not connected" };

  const command = `say ${sanitized}`;
  try {
    await runAndWait(serverId, command, 8000);
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}

/**
 * Build broadcast message from template and normalized event.
 * Template may use {user_name}, {user_login}, {user_id}.
 */
export function buildBroadcastMessage(
  template: string,
  event: { userLogin?: string; userName?: string; userId: string }
): string {
  return template
    .replace(/\{user_name\}/g, event.userName ?? event.userLogin ?? "Someone")
    .replace(/\{user_login\}/g, event.userLogin ?? "someone")
    .replace(/\{user_id\}/g, event.userId);
}

/**
 * Dispatch a whitelist action. Only "broadcast" is implemented.
 * Returns true if action was allowed and dispatched.
 */
export async function dispatchWhitelistAction(
  actionId: string,
  actionParams: Record<string, unknown> | null,
  serverId: string,
  userId: string,
  role: UserRole,
  event: { userLogin?: string; userName?: string; userId: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!ALLOWED_ACTION_IDS.includes(actionId as (typeof ALLOWED_ACTION_IDS)[number])) {
    return { ok: false, error: "Action not in whitelist" };
  }

  if (actionId === "broadcast") {
    const template = (actionParams?.message as string) ?? "New follower: {user_name}!";
    const message = buildBroadcastMessage(template, event);
    return dispatchBroadcast(serverId, userId, role, message);
  }

  return { ok: false, error: "Unknown action" };
}
