/**
 * User roles in ascending order of privilege (guest = lowest).
 * super_admin can make admin; admin can make servers; moderator can create server users.
 */
export const ROLES = [
  "guest",
  "player",
  "streamer",
  "support",
  "moderator",
  "admin",
  "super_admin",
] as const;

export type UserRole = (typeof ROLES)[number];

export const ROLE_ORDER: Record<UserRole, number> = {
  guest: 0,
  player: 1,
  streamer: 2,
  support: 3,
  moderator: 4,
  admin: 5,
  super_admin: 6,
};

export function hasRoleAtLeast(userRole: UserRole, required: UserRole): boolean {
  return ROLE_ORDER[userRole] >= ROLE_ORDER[required];
}

/** Who can create/edit/delete servers */
export const CAN_MANAGE_SERVERS: UserRole[] = ["admin", "super_admin"];

/** Who can create server users (assign users to servers) */
export const CAN_MANAGE_SERVER_USERS: UserRole[] = ["moderator", "admin", "super_admin"];

/** Who can change user roles (e.g. make admin) */
export const CAN_MANAGE_ADMINS: UserRole[] = ["super_admin"];

export function canManageServers(role: UserRole): boolean {
  return CAN_MANAGE_SERVERS.includes(role);
}

export function canManageServerUsers(role: UserRole): boolean {
  return CAN_MANAGE_SERVER_USERS.includes(role);
}

export function canManageAdmins(role: UserRole): boolean {
  return CAN_MANAGE_ADMINS.includes(role);
}
