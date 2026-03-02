import { query } from "./db";
import type { ServerRow } from "./db";
import type { UserRole } from "./permissions";

/** Per-server role: owner (full), admin (full except cannot transfer ownership), moderator (connect + give to players, no delete). */
export type ServerRole = "owner" | "admin" | "moderator";

export type ServerWithRole = { server: ServerRow; serverRole: ServerRole };

/**
 * Returns the server and the current user's role on it (owner, admin, or moderator), or null if no access.
 * Super_admin is treated as owner for any server.
 */
export async function getServerWithRole(
  serverId: string,
  userId: string,
  globalRole: UserRole
): Promise<ServerWithRole | null> {
  if (globalRole === "super_admin") {
    const { rows } = await query<ServerRow>(
      "SELECT id, name, rcon_host, rcon_port, rcon_password, created_at, owner_id, listed, listing_name, listing_description, game_host, game_port, location, logo_url FROM servers WHERE id = $1",
      [serverId]
    );
    const server = rows[0];
    return server ? { server, serverRole: "owner" } : null;
  }

  const { rows: serverRows } = await query<ServerRow>(
    "SELECT id, name, rcon_host, rcon_port, rcon_password, created_at, owner_id, listed, listing_name, listing_description, game_host, game_port, location, logo_url FROM servers WHERE id = $1",
    [serverId]
  );
  const server = serverRows[0];
  if (!server) return null;

  if (server.owner_id === userId) return { server, serverRole: "owner" };

  const { rows: suRows } = await query<{ role: string }>(
    "SELECT role FROM server_users WHERE server_id = $1 AND user_id = $2",
    [serverId, userId]
  );
  const su = suRows[0];
  if (!su) return null;
  if (su.role === "admin") return { server, serverRole: "admin" };
  if (su.role === "moderator") return { server, serverRole: "moderator" };
  return null;
}

/**
 * Returns the server row if the user owns it, is in server_users as admin/moderator, or is super_admin; otherwise null.
 */
export async function getServerIfAccessible(
  serverId: string,
  userId: string,
  role: UserRole
): Promise<ServerRow | null> {
  const result = await getServerWithRole(serverId, userId, role);
  return result?.server ?? null;
}

/** True if user can delete this server or manage server users (owner or server admin). */
export function canManageServerAccess(serverRole: ServerRole): boolean {
  return serverRole === "owner" || serverRole === "admin";
}

/** True if user can delete this server (owner or server admin). */
export function canDeleteServer(serverRole: ServerRole): boolean {
  return serverRole === "owner" || serverRole === "admin";
}

/** True if user can edit server listing/settings (owner or server admin). */
export function canEditServer(serverRole: ServerRole): boolean {
  return serverRole === "owner" || serverRole === "admin";
}

/** True if user can connect and run commands / give to players (owner, admin, or moderator). */
export function canUseServer(serverRole: ServerRole): boolean {
  return serverRole === "owner" || serverRole === "admin" || serverRole === "moderator";
}

export async function getServerOwnerId(serverId: string): Promise<string | null> {
  const { rows } = await query<{ owner_id: string | null }>(
    "SELECT owner_id FROM servers WHERE id = $1",
    [serverId]
  );
  return rows[0]?.owner_id ?? null;
}
