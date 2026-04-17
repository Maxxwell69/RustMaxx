import { query } from "@/lib/db";
import type { FanBoardTier } from "@/lib/streamer-fan-board";

/**
 * Seconds until this viewer may trigger another action on this board tier (0 = allowed now).
 */
export async function getFanBoardCooldownRemaining(
  viewerUserId: string,
  streamerUserId: string,
  boardTier: FanBoardTier,
  cooldownSeconds: number
): Promise<number> {
  if (cooldownSeconds <= 0) return 0;
  const { rows } = await query<{ last_trigger_at: Date }>(
    `SELECT last_trigger_at FROM viewer_fan_board_last_trigger
     WHERE viewer_user_id = $1::uuid AND streamer_user_id = $2::uuid AND board_tier = $3`,
    [viewerUserId, streamerUserId, boardTier]
  );
  const row = rows[0];
  if (!row) return 0;
  const elapsed = (Date.now() - new Date(row.last_trigger_at).getTime()) / 1000;
  if (elapsed >= cooldownSeconds) return 0;
  return Math.max(1, Math.ceil(cooldownSeconds - elapsed));
}

/** Call after a successful RCON so the next trigger respects cooldown. */
export async function recordFanBoardTriggerSuccess(
  viewerUserId: string,
  streamerUserId: string,
  boardTier: FanBoardTier,
  cooldownSeconds: number
): Promise<void> {
  if (cooldownSeconds <= 0) return;
  await query(
    `INSERT INTO viewer_fan_board_last_trigger (viewer_user_id, streamer_user_id, board_tier, last_trigger_at)
     VALUES ($1::uuid, $2::uuid, $3, now())
     ON CONFLICT (viewer_user_id, streamer_user_id, board_tier)
     DO UPDATE SET last_trigger_at = now()`,
    [viewerUserId, streamerUserId, boardTier]
  );
}
