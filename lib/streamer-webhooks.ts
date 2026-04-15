import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { findUserById } from "@/lib/users";
import { billingSkippedInEnv, getStreamerWebhookLimit } from "@/lib/billing-tiers";

const SALT_ROUNDS = 10;

export type StreamerWebhookRow = {
  id: string;
  user_id: string;
  server_id: string;
  public_id: string;
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
    "SELECT id, user_id, server_id, public_id::text, secret_hash, created_at, updated_at FROM streamer_webhooks WHERE public_id = $1 LIMIT 1",
    [trimmed]
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
    `SELECT id, user_id, server_id, public_id::text, secret_hash, created_at, updated_at
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
    `SELECT id, user_id, server_id, public_id::text, secret_hash, created_at, updated_at
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
    `SELECT id, user_id, server_id, public_id::text, secret_hash, created_at, updated_at
     FROM streamer_webhooks WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [webhookId, userId]
  );
  return rows[0] ?? null;
}

/**
 * Ensure a webhook row exists for this user+server. New rows get a plaintext secret once.
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
  const { rows } = await query<StreamerWebhookRow>(
    `INSERT INTO streamer_webhooks (user_id, server_id, secret_hash)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, server_id, public_id::text, secret_hash, created_at, updated_at`,
    [userId, serverId, secret_hash]
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

export async function rotateStreamerWebhookSecret(
  userId: string,
  webhookId: string
): Promise<{ secretPlain: string } | null> {
  const hook = await getWebhookByIdForUser(userId, webhookId);
  if (!hook) return null;
  const plain = generatePlainSecret();
  const secret_hash = await hashWebhookSecret(plain);
  await query(
    "UPDATE streamer_webhooks SET secret_hash = $1, updated_at = now() WHERE id = $2 AND user_id = $3",
    [secret_hash, webhookId, userId]
  );
  return { secretPlain: plain };
}
