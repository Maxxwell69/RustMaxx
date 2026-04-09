import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { query } from "@/lib/db";

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
  const { rows } = await query<StreamerWebhookRow>(
    "SELECT id, user_id, server_id, public_id::text, secret_hash, created_at, updated_at FROM streamer_webhooks WHERE public_id = $1 LIMIT 1",
    [publicId]
  );
  return rows[0] ?? null;
}

export async function getStreamerWebhookForUser(
  userId: string
): Promise<StreamerWebhookRow | null> {
  const { rows } = await query<StreamerWebhookRow>(
    "SELECT id, user_id, server_id, public_id::text, secret_hash, created_at, updated_at FROM streamer_webhooks WHERE user_id = $1 LIMIT 1",
    [userId]
  );
  return rows[0] ?? null;
}

/**
 * Create or move webhook to another server. On first create, returns plaintext secret once.
 */
export async function upsertStreamerWebhook(
  userId: string,
  serverId: string
): Promise<{ row: StreamerWebhookRow; secretPlain?: string }> {
  const existing = await getStreamerWebhookForUser(userId);
  if (existing) {
    const { rows } = await query<StreamerWebhookRow>(
      `UPDATE streamer_webhooks SET server_id = $1, updated_at = now()
       WHERE user_id = $2
       RETURNING id, user_id, server_id, public_id::text, secret_hash, created_at, updated_at`,
      [serverId, userId]
    );
    const row = rows[0];
    if (!row) throw new Error("update streamer_webhooks failed");
    return { row };
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

/** Rotate secret; returns new plaintext once. */
export async function rotateStreamerWebhookSecret(
  userId: string
): Promise<{ secretPlain: string } | null> {
  const hook = await getStreamerWebhookForUser(userId);
  if (!hook) return null;
  const plain = generatePlainSecret();
  const secret_hash = await hashWebhookSecret(plain);
  await query(
    "UPDATE streamer_webhooks SET secret_hash = $1, updated_at = now() WHERE user_id = $2",
    [secret_hash, userId]
  );
  return { secretPlain: plain };
}
