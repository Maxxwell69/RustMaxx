import { query } from "@/lib/db";

/**
 * When `streamer_allowed_user_ids` is empty, any eligible streamer may use hooks (legacy).
 * When non-empty, only listed users may create webhooks or have hooks honored.
 */
export async function isStreamerAllowedForServerHooks(
  serverId: string,
  userId: string
): Promise<boolean> {
  const { rows } = await query<{ ids: string[] | null }>(
    `SELECT streamer_allowed_user_ids AS ids FROM servers WHERE id = $1 LIMIT 1`,
    [serverId]
  );
  const ids = rows[0]?.ids;
  if (!ids || ids.length === 0) return true;
  return ids.includes(userId);
}
