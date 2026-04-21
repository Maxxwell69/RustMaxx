import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { findUserById } from "@/lib/users";
import { billingSkippedInEnv, getStreamerWebhookLimit } from "@/lib/billing-tiers";

const SALT_ROUNDS = 10;

/** 32 bytes as hex — unique URL segment; authenticates without ?token=. */
export function generateHookKey(): string {
  return randomBytes(32).toString("hex");
}

export type StreamerWebhookRow = {
  id: string;
  user_id: string;
  server_id: string;
  public_id: string;
  hook_key: string;
  secret_hash: string;
  created_at: Date;
  updated_at: Date;
};

function generatePlainSecret(): string {
  return randomBytes(24).toString("hex");
}

export async function hashWebhookSecret(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyWebhookSecret(
  plain: string,
  hash: string
): Promise<boolean> {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain, hash);
}

export async function getStreamerWebhookByPublicId(
  publicId: string
): Promise<StreamerWebhookRow | null> {
  // Guard invalid path probes (e.g. "....md") to avoid Postgres UUID cast errors.
  const trimmed = publicId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return null;
  }
  const { rows } = await query<StreamerWebhookRow>(
    "SELECT id, user_id, server_id, public_id::text, hook_key, secret_hash, created_at, updated_at FROM streamer_webhooks WHERE public_id = $1 LIMIT 1",
    [trimmed]
  );
  return rows[0] ?? null;
}

/** Lookup by opaque path segment (64-char lowercase hex). */
export async function getStreamerWebhookByHookKey(
  hookKey: string
): Promise<StreamerWebhookRow | null> {
  const k = hookKey.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(k)) return null;
  const { rows } = await query<StreamerWebhookRow>(
    "SELECT id, user_id, server_id, public_id::text, hook_key, secret_hash, created_at, updated_at FROM streamer_webhooks WHERE hook_key = $1 LIMIT 1",
    [k]
  );
  return rows[0] ?? null;
}

export async function countStreamerWebhooksForUser(userId: string): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM streamer_webhooks WHERE user_id = $1`,
    [userId]
  );
  return parseInt(rows[0]?.n ?? "0", 10);
}

export async function listStreamerWebhooksForUser(
  userId: string
): Promise<StreamerWebhookRow[]> {
  const { rows } = await query<StreamerWebhookRow>(
    `SELECT id, user_id, server_id, public_id::text, hook_key, secret_hash, created_at, updated_at
     FROM streamer_webhooks WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId]
  );
  return rows;
}

/** @deprecated Prefer listStreamerWebhooksForUser — kept for single-hook call sites. */
export async function getStreamerWebhookForUser(
  userId: string
): Promise<StreamerWebhookRow | null> {
  const list = await listStreamerWebhooksForUser(userId);
  return list[0] ?? null;
}

export async function getWebhookByUserAndServer(
  userId: string,
  serverId: string
): Promise<StreamerWebhookRow | null> {
  const { rows } = await query<StreamerWebhookRow>(
    `SELECT id, user_id, server_id, public_id::text, hook_key, secret_hash, created_at, updated_at
     FROM streamer_webhooks WHERE user_id = $1 AND server_id = $2 LIMIT 1`,
    [userId, serverId]
  );
  return rows[0] ?? null;
}

export async function getWebhookByIdForUser(
  userId: string,
  webhookId: string
): Promise<StreamerWebhookRow | null> {
  const { rows } = await query<StreamerWebhookRow>(
    `SELECT id, user_id, server_id, public_id::text, hook_key, secret_hash, created_at, updated_at
     FROM streamer_webhooks WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [webhookId, userId]
  );
  return rows[0] ?? null;
}

/**
 * Ensure a webhook row exists for this user+server.
 * New rows get an opaque hook_key (paste one URL into TikFinity) plus legacy bcrypt secret for old UUID+token URLs.
 */
export async function createWebhookForServer(
  userId: string,
  serverId: string
): Promise<{ row: StreamerWebhookRow; secretPlain?: string }> {
  const existing = await getWebhookByUserAndServer(userId, serverId);
  if (existing) {
    return { row: existing };
  }

  const user = await findUserById(userId);
  if (!user) throw new Error("User not found");
  const limit = getStreamerWebhookLimit(user.streamer_tier);
  const n = await countStreamerWebhooksForUser(userId);
  if (!billingSkippedInEnv() && n >= limit) {
    throw new Error(
      `WEBHOOK_LIMIT: Your plan allows ${limit} server webhook(s). Upgrade your streamer plan for more.`
    );
  }

  const plain = generatePlainSecret();
  const secret_hash = await hashWebhookSecret(plain);
  const hook_key = generateHookKey();
  const { rows } = await query<StreamerWebhookRow>(
    `INSERT INTO streamer_webhooks (user_id, server_id, secret_hash, hook_key)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, server_id, public_id::text, hook_key, secret_hash, created_at, updated_at`,
    [userId, serverId, secret_hash, hook_key]
  );
  const row = rows[0];
  if (!row) throw new Error("insert streamer_webhooks failed");
  return { row, secretPlain: plain };
}

export async function deleteWebhookForUser(
  userId: string,
  webhookId: string
): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM streamer_webhooks WHERE id = $1 AND user_id = $2`,
    [webhookId, userId]
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Regenerates both opaque URL segment and legacy bcrypt token (old URLs stop working).
 */
export async function rotateStreamerWebhookSecret(
  userId: string,
  webhookId: string
): Promise<{ secretPlain: string; hookKey: string } | null> {
  const hook = await getWebhookByIdForUser(userId, webhookId);
  if (!hook) return null;
  const plain = generatePlainSecret();
  const secret_hash = await hashWebhookSecret(plain);
  const hook_key = generateHookKey();
  await query(
    "UPDATE streamer_webhooks SET secret_hash = $1, hook_key = $2, updated_at = now() WHERE id = $3 AND user_id = $4",
    [secret_hash, hook_key, webhookId, userId]
  );
  return { secretPlain: plain, hookKey: hook_key };
}
