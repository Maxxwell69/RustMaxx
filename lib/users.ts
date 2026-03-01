import { query } from "./db";
import bcrypt from "bcryptjs";
import type { UserRole } from "./permissions";

const SALT_ROUNDS = 10;

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  display_name: string | null;
  created_at: Date;
  updated_at: Date;
};

export type UserProfile = {
  id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
  created_at: string;
};

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>(
    "SELECT id, email, password_hash, role, display_name, created_at, updated_at FROM users WHERE lower(email) = lower($1)",
    [email.trim()]
  );
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>(
    "SELECT id, email, password_hash, role, display_name, created_at, updated_at FROM users WHERE id = $1",
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
    `INSERT INTO users (email, password_hash, role, display_name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, password_hash, role, display_name, created_at, updated_at`,
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
    created_at: row.created_at.toISOString(),
  };
}
