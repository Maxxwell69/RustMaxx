import { query } from "@/lib/db";
import { hasApprovedStreamerServerRequest } from "@/lib/streamer-server-requests";

/**
 * When `streamer_join_requires_owner_approval` is false (default):
 * - Empty `streamer_allowed_user_ids` → any eligible streamer may use hooks.
 * - Non-empty → only listed user IDs.
 *
 * When `streamer_join_requires_owner_approval` is true:
 * - User must be in `streamer_allowed_user_ids`, OR have an approved `streamer_server_requests` row.
 * - If the allowlist is empty and approval is required, only approved-request users pass (not “everyone”).
 */
export async function isStreamerAllowedForServerHooks(
  serverId: string,
  userId: string
): Promise<boolean> {
  const { rows } = await query<{
    ids: string[] | null;
    require_owner_approval: boolean;
  }>(
    `SELECT
      streamer_allowed_user_ids AS ids,
      COALESCE(streamer_join_requires_owner_approval, false) AS require_owner_approval
     FROM servers WHERE id = $1 LIMIT 1`,
    [serverId]
  );
  const row = rows[0];
  if (!row) return false;
  const ids = row.ids ?? [];
  const inAllowlist = ids.includes(userId);

  if (!row.require_owner_approval) {
    if (ids.length === 0) return true;
    return inAllowlist;
  }

  if (inAllowlist) return true;
  return hasApprovedStreamerServerRequest(serverId, userId);
}
