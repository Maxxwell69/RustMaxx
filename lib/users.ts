import { query } from "./db";
import bcrypt from "bcryptjs";
import type { UserRole } from "./permissions";
import type { MembershipLevel } from "./membership-level";
import { MEMBERSHIP_LEVELS } from "./membership-level";

const SALT_ROUNDS = 10;

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  display_name: string | null;
  steam_id: string | null;
  steam_linked_at: Date | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string;
  membership_level: MembershipLevel;
  created_at: Date;
  updated_at: Date;
};

export type UserProfile = {
  id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
  membership_level: MembershipLevel;
  created_at: string;
};

const USER_SELECT = `id, email, password_hash, role, display_name,
    steam_id, steam_linked_at, stripe_customer_id, stripe_subscription_id, subscription_status,
    membership_level,
    created_at, updated_at`;

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>(
    `SELECT ${USER_SELECT} FROM users WHERE lower(email) = lower($1)`,
    [email.trim()]
  );
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>(
    `SELECT ${USER_SELECT} FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function verifyCredentials(
  email: string,
  password: string
): Promise<UserRow | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  return ok ? user : null;
}

export async function createUser(
  email: string,
  password: string,
  role: UserRole = "guest",
  displayName?: string | null
): Promise<UserRow> {
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const { rows } = await query<UserRow>(
    `INSERT INTO users (email, password_hash, role, display_name, membership_level)
     VALUES ($1, $2, $3, $4, 'standard')
     RETURNING ${USER_SELECT}`,
    [email.trim().toLowerCase(), hash, role, displayName ?? null]
  );
  if (!rows[0]) throw new Error("Insert user failed");
  return rows[0];
}

export async function userCount(): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM users"
  );
  return parseInt(rows[0]?.count ?? "0", 10);
}

export function toProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    display_name: row.display_name,
    membership_level: row.membership_level ?? "standard",
    created_at: row.created_at.toISOString(),
  };
}

export async function listUsers(): Promise<UserProfile[]> {
  const { rows } = await query<UserRow>(
    `SELECT ${USER_SELECT} FROM users ORDER BY created_at ASC`
  );
  return rows.map(toProfile);
}

const ALLOWED_ROLES: UserRole[] = [
  "guest",
  "player",
  "streamer",
  "support",
  "moderator",
  "admin",
  "super_admin",
];

export async function updateUserRole(
  userId: string,
  newRole: UserRole
): Promise<UserRow | null> {
  if (!ALLOWED_ROLES.includes(newRole)) return null;
  const { rows } = await query<UserRow>(
    `UPDATE users SET role = $1, updated_at = now() WHERE id = $2 RETURNING ${USER_SELECT}`,
    [newRole, userId]
  );
  return rows[0] ?? null;
}

/** Set or clear Steam64 on the user (manual entry). Empty string clears. */
export async function setUserSteamId(
  userId: string,
  steamId: string
): Promise<{ ok: true } | { error: string }> {
  const trimmed = steamId.trim();
  if (trimmed === "") {
    const { rows } = await query<UserRow>(
      `UPDATE users SET steam_id = NULL, steam_linked_at = NULL, updated_at = now() WHERE id = $1 RETURNING ${USER_SELECT}`,
      [userId]
    );
    if (!rows[0]) return { error: "User not found" };
    return { ok: true };
  }
  if (!/^\d{17}$/.test(trimmed)) return { error: "Steam id must be 17 digits (Steam64)." };
  const { rows: taken } = await query<{ id: string }>(
    "SELECT id FROM users WHERE steam_id = $1 AND id <> $2 LIMIT 1",
    [trimmed, userId]
  );
  if (taken.length > 0) return { error: "This Steam account is already linked to another user." };
  const { rows } = await query<UserRow>(
    `UPDATE users SET steam_id = $1, steam_linked_at = now(), updated_at = now() WHERE id = $2
     RETURNING ${USER_SELECT}`,
    [trimmed, userId]
  );
  if (!rows[0]) return { error: "User not found" };
  return { ok: true };
}

export async function updateUserMembershipLevel(
  userId: string,
  level: MembershipLevel
): Promise<UserRow | null> {
  if (!MEMBERSHIP_LEVELS.includes(level)) return null;
  const { rows } = await query<UserRow>(
    `UPDATE users SET membership_level = $1, updated_at = now() WHERE id = $2 RETURNING ${USER_SELECT}`,
    [level, userId]
  );
  return rows[0] ?? null;
}
