import { query } from "@/lib/db";
import type { FanBoardTier } from "@/lib/streamer-fan-board";
import { ACTION_META, TIKTRIGGER_ACTIONS, type TikTriggerAction } from "@/lib/tikfinity";

export function fanBoardTierDisplayName(tier: FanBoardTier): string {
  if (tier === "fan") return "Fan board";
  if (tier === "superfan") return "Superfan board";
  return "Mod board";
}

/** Catalog label for an action key (e.g. wolf → "Wolf"); falls back to the raw key. */
export function resolveActionLabelForKey(actionKey: string): string {
  const k = actionKey.trim().toLowerCase();
  if ((TIKTRIGGER_ACTIONS as readonly string[]).includes(k)) {
    return ACTION_META[k as TikTriggerAction].label;
  }
  return actionKey.trim() || actionKey;
}

/**
 * @example MaxxFan sent Wolf (wolf) via the Fan board.
 */
export function formatFanBoardActivitySummary(row: {
  viewer_label: string;
  board_tier: FanBoardTier;
  action_key: string;
  action_label: string | null;
}): string {
  const key = row.action_key.trim().toLowerCase();
  const label = row.action_label?.trim() || resolveActionLabelForKey(row.action_key);
  return `${row.viewer_label} sent ${label} (${key}) via the ${fanBoardTierDisplayName(row.board_tier)}.`;
}

export async function recordFanBoardActivity(params: {
  streamerUserId: string;
  viewerUserId: string;
  viewerLabel: string;
  boardTier: FanBoardTier;
  actionKey: string;
  actionLabel: string | null;
}): Promise<void> {
  const label = (params.viewerLabel.trim() || "Fan").slice(0, 200);
  await query(
    `INSERT INTO streamer_fan_board_activity
     (streamer_user_id, viewer_user_id, viewer_label, board_tier, action_key, action_label)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)`,
    [
      params.streamerUserId,
      params.viewerUserId,
      label,
      params.boardTier,
      params.actionKey.toLowerCase(),
      params.actionLabel?.trim() || resolveActionLabelForKey(params.actionKey),
    ]
  );
}

export type FanBoardActivityRow = {
  id: string;
  viewer_user_id: string;
  viewer_label: string;
  board_tier: FanBoardTier;
  action_key: string;
  action_label: string | null;
  created_at: Date;
};

export async function listFanBoardActivityForStreamer(
  streamerUserId: string,
  limit = 80
): Promise<FanBoardActivityRow[]> {
  const cap = Math.min(200, Math.max(1, Math.trunc(limit)));
  const { rows } = await query<{
    id: string;
    viewer_user_id: string;
    viewer_label: string;
    board_tier: string;
    action_key: string;
    action_label: string | null;
    created_at: Date;
  }>(
    `SELECT id, viewer_user_id::text, viewer_label, board_tier::text, action_key, action_label, created_at
     FROM streamer_fan_board_activity
     WHERE streamer_user_id = $1::uuid
     ORDER BY created_at DESC
     LIMIT $2`,
    [streamerUserId, cap]
  );
  return rows.map((r) => ({
    id: r.id,
    viewer_user_id: r.viewer_user_id,
    viewer_label: r.viewer_label,
    board_tier: r.board_tier as FanBoardTier,
    action_key: r.action_key,
    action_label: r.action_label,
    created_at: r.created_at,
  }));
}
