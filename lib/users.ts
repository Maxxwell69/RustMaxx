import { query } from "./db";
import bcrypt from "bcryptjs";
import type { UserRole } from "./permissions";
import type { MembershipLevel } from "./membership-level";
import { MEMBERSHIP_LEVELS } from "./membership-level";
import { isOurHostedUploadPublicPath } from "./upload-files";
import { coerceDirectorySocialsFromDb, parseDirectorySocialOverrides } from "./streamer-directory-socials";
import type { StreamerBillingTier } from "./billing-tiers";
import { parseStreamerBillingTier } from "./billing-tiers";

const SALT_ROUNDS = 10;

/**
 * Accepts full http(s) URLs or same-origin paths from POST /api/upload (`/api/uploads/…` or legacy `/uploads/…`).
 */
function isAllowedStreamerDirectoryAvatarUrl(t: string): boolean {
  const trimmed = t.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  if (isOurHostedUploadPublicPath(trimmed)) return true;
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

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
  signup_interested_server_owner: boolean;
  signup_interested_streamer: boolean;
  signup_interested_fan: boolean;
  last_login_at?: Date | null;
  streamer_directory_visible?: boolean;
  streamer_directory_avatar_url?: string | null;
  streamer_directory_bio?: string | null;
  streamer_directory_socials?: Record<string, string> | null;
  streamer_directory_show_servers?: boolean;
  streamer_tier?: StreamerBillingTier;
  created_at: Date;
  updated_at: Date;
};

export type UserProfile = {
  id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
  membership_level: MembershipLevel;
  membership_packages?: string[];
  signup_interested_server_owner: boolean;
  signup_interested_streamer: boolean;
  signup_interested_fan: boolean;
  created_at: string;
};

const USER_SELECT = `id, email, password_hash, role, display_name,
    steam_id, steam_linked_at, stripe_customer_id, stripe_subscription_id, subscription_status,
    membership_level,
    signup_interested_server_owner, signup_interested_streamer, signup_interested_fan,
    last_login_at, streamer_directory_visible, streamer_directory_avatar_url, streamer_directory_bio,
    streamer_directory_socials, streamer_directory_show_servers,
    streamer_tier,
    created_at, updated_at`;

/** Same row shape before migration 023 (signup intent columns). */
const USER_SELECT_LEGACY = `id, email, password_hash, role, display_name,
    steam_id, steam_linked_at, stripe_customer_id, stripe_subscription_id, subscription_status,
    membership_level,
    created_at, updated_at`;

function isPgUndefinedColumnError(e: unknown): boolean {
  if (e === null || typeof e !== "object") return false;
  const err = e as { code?: string; message?: string };
  if (err.code === "42703") return true;
  if (
    typeof err.message === "string" &&
    err.message.includes("signup_interested")
  ) {
    return true;
  }
  return false;
}

function mapRowToUserRow(row: Record<string, unknown>): UserRow {
  const base = row as unknown as UserRow;
  return {
    ...base,
    signup_interested_server_owner: row.signup_interested_server_owner === true,
    signup_interested_streamer: row.signup_interested_streamer === true,
    signup_interested_fan: row.signup_interested_fan === true,
    last_login_at:
      row.last_login_at == null
        ? null
        : row.last_login_at instanceof Date
          ? row.last_login_at
          : typeof row.last_login_at === "string"
            ? new Date(row.last_login_at)
            : null,
    streamer_directory_visible: Boolean(row.streamer_directory_visible),
    streamer_directory_avatar_url:
      typeof row.streamer_directory_avatar_url === "string"
        ? row.streamer_directory_avatar_url
        : null,
    streamer_directory_bio:
      typeof row.streamer_directory_bio === "string" ? row.streamer_directory_bio : null,
    streamer_directory_socials: coerceDirectorySocialsFromDb(row.streamer_directory_socials),
    streamer_directory_show_servers: row.streamer_directory_show_servers === true,
    streamer_tier: parseStreamerBillingTier(row.streamer_tier) ?? "free",
  };
}

/**
 * Runs a query that returns full user rows. If DB is missing signup-intent columns (migration 023),
 * retries with USER_SELECT_LEGACY and defaults those flags to false.
 */
async function queryReturningUserRows(
  sql: string,
  params?: unknown[]
): Promise<UserRow[]> {
  try {
    const { rows } = await query<UserRow>(sql, params);
    return rows;
  } catch (e) {
    if (!isPgUndefinedColumnError(e)) throw e;
    const legacySql = sql.split(USER_SELECT).join(USER_SELECT_LEGACY);
    try {
      const { rows } = await query<Record<string, unknown>>(legacySql, params);
      return rows.map(mapRowToUserRow);
    } catch {
      throw e;
    }
  }
}

async function queryOneUserRow(
  sql: string,
  params?: unknown[]
): Promise<UserRow | null> {
  const rows = await queryReturningUserRows(sql, params);
  return rows[0] ?? null;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  return queryOneUserRow(
    `SELECT ${USER_SELECT} FROM users WHERE lower(email) = lower($1)`,
    [email.trim()]
  );
}

export async function findUserById(id: string): Promise<UserRow | null> {
  return queryOneUserRow(`SELECT ${USER_SELECT} FROM users WHERE id = $1`, [id]);
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
  displayName?: string | null,
  signupIntent?: { serverOwner?: boolean; streamer?: boolean; fan?: boolean }
): Promise<UserRow> {
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const so = signupIntent?.serverOwner === true;
  const st = signupIntent?.streamer === true;
  const fan = signupIntent?.fan === true;
  try {
    const { rows } = await query<UserRow>(
      `INSERT INTO users (email, password_hash, role, display_name, membership_level,
        signup_interested_server_owner, signup_interested_streamer, signup_interested_fan)
     VALUES ($1, $2, $3, $4, 'standard', $5, $6, $7)
     RETURNING ${USER_SELECT}`,
      [email.trim().toLowerCase(), hash, role, displayName ?? null, so, st, fan]
    );
    if (!rows[0]) throw new Error("Insert user failed");
    return rows[0];
  } catch (e) {
    if (!isPgUndefinedColumnError(e)) throw e;
    const { rows } = await query<Record<string, unknown>>(
      `INSERT INTO users (email, password_hash, role, display_name, membership_level)
     VALUES ($1, $2, $3, $4, 'standard')
     RETURNING ${USER_SELECT_LEGACY}`,
      [email.trim().toLowerCase(), hash, role, displayName ?? null]
    );
    if (!rows[0]) throw new Error("Insert user failed");
    return mapRowToUserRow(rows[0]);
  }
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
    signup_interested_server_owner: row.signup_interested_server_owner ?? false,
    signup_interested_streamer: row.signup_interested_streamer ?? false,
    signup_interested_fan: row.signup_interested_fan ?? false,
    created_at: row.created_at.toISOString(),
  };
}

function isMissingRelationError(e: unknown): boolean {
  if (e === null || typeof e !== "object") return false;
  const err = e as { code?: string };
  return err.code === "42P01";
}

export async function listUserMembershipPackagesForUserIds(
  userIds: string[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (userIds.length === 0) return out;
  try {
    const { rows } = await query<{ user_id: string; package_kind: string; tier_key: string }>(
      `SELECT user_id, package_kind, tier_key
       FROM user_pricing_packages
       WHERE user_id = ANY($1::uuid[])
       ORDER BY package_kind ASC, tier_key ASC`,
      [userIds]
    );
    for (const r of rows) {
      const key = `${r.package_kind}:${r.tier_key}`;
      const list = out.get(r.user_id) ?? [];
      list.push(key);
      out.set(r.user_id, list);
    }
    return out;
  } catch (e) {
    if (isMissingRelationError(e)) return out;
    throw e;
  }
}

export async function replaceUserMembershipPackages(
  userId: string,
  packageKeys: string[]
): Promise<void> {
  const parsed = Array.from(
    new Set(
      packageKeys
        .map((x) => String(x).trim().toLowerCase())
        .filter(Boolean)
        .filter((x) => /^(server|streamer|combo):[a-z0-9_-]{1,64}$/.test(x))
    )
  ).map((key) => {
    const [packageKind, tierKey] = key.split(":");
    return { packageKind, tierKey };
  });
  try {
    await query("DELETE FROM user_pricing_packages WHERE user_id = $1::uuid", [userId]);
    for (const row of parsed) {
      await query(
        `INSERT INTO user_pricing_packages (user_id, package_kind, tier_key)
         VALUES ($1::uuid, $2, $3)
         ON CONFLICT (user_id, package_kind, tier_key) DO NOTHING`,
        [userId, row.packageKind, row.tierKey]
      );
    }
  } catch (e) {
    if (isMissingRelationError(e)) return;
    throw e;
  }
}

export async function listUsers(): Promise<UserProfile[]> {
  const rows = await queryReturningUserRows(
    `SELECT ${USER_SELECT} FROM users ORDER BY created_at ASC`
  );
  const base = rows.map(toProfile);
  const packageMap = await listUserMembershipPackagesForUserIds(base.map((u) => u.id));
  return base.map((u) => ({
    ...u,
    membership_packages: packageMap.get(u.id) ?? [],
  }));
}

export async function countUsersWithRole(role: UserRole): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM users WHERE role = $1::user_role`,
    [role]
  );
  return parseInt(rows[0]?.count ?? "0", 10);
}

/** Permanently removes the user row. FK CASCADE may delete owned servers and related data. */
export async function deleteUserById(userId: string): Promise<boolean> {
  const { rowCount } = await query("DELETE FROM users WHERE id = $1", [userId]);
  return (rowCount ?? 0) > 0;
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
  return queryOneUserRow(
    `UPDATE users SET role = $1, updated_at = now() WHERE id = $2 RETURNING ${USER_SELECT}`,
    [newRole, userId]
  );
}

/** Set or clear Steam64 on the user (manual entry). Empty string clears. */
export async function setUserSteamId(
  userId: string,
  steamId: string
): Promise<{ ok: true } | { error: string }> {
  const trimmed = steamId.trim();
  if (trimmed === "") {
    const row = await queryOneUserRow(
      `UPDATE users SET steam_id = NULL, steam_linked_at = NULL, updated_at = now() WHERE id = $1 RETURNING ${USER_SELECT}`,
      [userId]
    );
    if (!row) return { error: "User not found" };
    return { ok: true };
  }
  if (!/^\d{17}$/.test(trimmed)) return { error: "Steam id must be 17 digits (Steam64)." };
  const { rows: taken } = await query<{ id: string }>(
    "SELECT id FROM users WHERE steam_id = $1 AND id <> $2 LIMIT 1",
    [trimmed, userId]
  );
  if (taken.length > 0) return { error: "This Steam account is already linked to another user." };
  const row = await queryOneUserRow(
    `UPDATE users SET steam_id = $1, steam_linked_at = now(), updated_at = now() WHERE id = $2
     RETURNING ${USER_SELECT}`,
    [trimmed, userId]
  );
  if (!row) return { error: "User not found" };
  return { ok: true };
}

export async function updateUserMembershipLevel(
  userId: string,
  level: MembershipLevel
): Promise<UserRow | null> {
  if (!MEMBERSHIP_LEVELS.includes(level)) return null;
  return queryOneUserRow(
    `UPDATE users SET membership_level = $1, updated_at = now() WHERE id = $2 RETURNING ${USER_SELECT}`,
    [level, userId]
  );
}

export async function updateUserLastLogin(userId: string): Promise<void> {
  await query(`UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1`, [userId]);
}

/** Marks user as interested in streamer tools (dashboard / nav). Idempotent. */
export async function setSignupInterestedStreamer(userId: string): Promise<void> {
  try {
    await query(
      `UPDATE users SET signup_interested_streamer = true, updated_at = now() WHERE id = $1::uuid`,
      [userId]
    );
  } catch (e) {
    if (!isPgUndefinedColumnError(e)) throw e;
  }
}

/** Marks user as interested in fan / viewer tools (dashboard / nav). Idempotent. */
export async function setSignupInterestedFan(userId: string): Promise<void> {
  try {
    await query(
      `UPDATE users SET signup_interested_fan = true, updated_at = now() WHERE id = $1::uuid`,
      [userId]
    );
  } catch (e) {
    if (!isPgUndefinedColumnError(e)) throw e;
  }
}

const DISPLAY_NAME_MAX = 120;

/** Updates the signed-in user’s display label (dashboard, directory fallbacks). Empty or null clears it. */
export async function updateUserDisplayName(
  userId: string,
  raw: unknown
): Promise<{ ok: true; user: UserRow } | { ok: false; error: string }> {
  let value: string | null;
  if (raw === null) {
    value = null;
  } else if (typeof raw === "string") {
    const t = raw.trim();
    value = t.length === 0 ? null : t;
  } else {
    return { ok: false, error: "display_name must be a string or null" };
  }
  if (value !== null && value.length > DISPLAY_NAME_MAX) {
    return { ok: false, error: `Display name is too long (max ${DISPLAY_NAME_MAX} characters).` };
  }
  const row = await queryOneUserRow(
    `UPDATE users SET display_name = $1, updated_at = now() WHERE id = $2 RETURNING ${USER_SELECT}`,
    [value, userId]
  );
  if (!row) return { ok: false, error: "User not found" };
  return { ok: true, user: row };
}

export type StreamerDirectoryPatch = {
  streamer_directory_visible?: boolean;
  streamer_directory_avatar_url?: string | null;
  streamer_directory_bio?: string | null;
  streamer_directory_socials?: Record<string, string> | null;
  streamer_directory_show_servers?: boolean;
};

/** Updates public directory fields for the current user (validated). */
export async function updateStreamerDirectoryFields(
  userId: string,
  patch: StreamerDirectoryPatch
): Promise<{ ok: true; user: UserRow } | { ok: false; error: string }> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (patch.streamer_directory_visible !== undefined) {
    if (typeof patch.streamer_directory_visible !== "boolean") {
      return { ok: false, error: "streamer_directory_visible must be a boolean" };
    }
    updates.push(`streamer_directory_visible = $${idx++}`);
    values.push(patch.streamer_directory_visible);
  }
  if (patch.streamer_directory_avatar_url !== undefined) {
    const raw = patch.streamer_directory_avatar_url;
    if (raw === null || raw === "") {
      updates.push(`streamer_directory_avatar_url = $${idx++}`);
      values.push(null);
    } else if (typeof raw === "string") {
      const t = raw.trim();
      if (t.length > 2048) return { ok: false, error: "Avatar URL is too long" };
      if (!isAllowedStreamerDirectoryAvatarUrl(t)) {
        return {
          ok: false,
          error:
            "Avatar URL must be https (or http) or a path from Upload image, for example /api/uploads/your-file.png.",
        };
      }
      updates.push(`streamer_directory_avatar_url = $${idx++}`);
      values.push(t);
    } else {
      return { ok: false, error: "Invalid avatar URL" };
    }
  }
  if (patch.streamer_directory_bio !== undefined) {
    if (patch.streamer_directory_bio !== null && typeof patch.streamer_directory_bio !== "string") {
      return { ok: false, error: "Invalid bio" };
    }
    const bio =
      patch.streamer_directory_bio === null
        ? null
        : patch.streamer_directory_bio.trim().slice(0, 2000) || null;
    updates.push(`streamer_directory_bio = $${idx++}`);
    values.push(bio);
  }
  if (patch.streamer_directory_socials !== undefined) {
    if (patch.streamer_directory_socials === null) {
      updates.push(`streamer_directory_socials = '{}'::jsonb`);
    } else {
      const parsed = parseDirectorySocialOverrides(patch.streamer_directory_socials);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      updates.push(`streamer_directory_socials = $${idx++}::jsonb`);
      values.push(JSON.stringify(parsed.value));
    }
  }
  if (patch.streamer_directory_show_servers !== undefined) {
    if (typeof patch.streamer_directory_show_servers !== "boolean") {
      return { ok: false, error: "streamer_directory_show_servers must be a boolean" };
    }
    updates.push(`streamer_directory_show_servers = $${idx++}`);
    values.push(patch.streamer_directory_show_servers);
  }

  if (updates.length === 0) {
    return { ok: false, error: "No fields to update" };
  }

  updates.push(`updated_at = now()`);
  values.push(userId);
  const row = await queryOneUserRow(
    `UPDATE users SET ${updates.join(", ")} WHERE id = $${idx} RETURNING ${USER_SELECT}`,
    values
  );
  if (!row) return { ok: false, error: "User not found" };
  return { ok: true, user: row };
}
