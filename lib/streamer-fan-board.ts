import { query, pool } from "@/lib/db";
import { TIKTRIGGER_ACTIONS, isTikTokSocialOnlyAction } from "@/lib/tikfinity";
import { listStreamerWebhooksForUser } from "@/lib/streamer-webhooks";
import { getStreamerPolicyForServer } from "@/lib/streamer-action-policy";

export type FanBoardTier = "fan" | "superfan" | "mod";

/** Max action buttons per board tier (mod = no numeric cap — all allowed catalog actions). */
export const FAN_BOARD_MAX_BUTTONS: Record<FanBoardTier, number | null> = {
  fan: 5,
  superfan: 10,
  mod: null,
};

/** Defaults when no row in streamer_fan_board_settings. */
export const FAN_BOARD_DEFAULT_COOLDOWN_SECONDS: Record<FanBoardTier, number> = {
  fan: 30,
  superfan: 30,
  mod: 0,
};

export function maxButtonsForTier(tier: FanBoardTier): number | null {
  return FAN_BOARD_MAX_BUTTONS[tier];
}

/** Actions that need extra webhook/Roaming setup — excluded from fan-board picker. */
const FAN_BOARD_EXCLUDED = new Set<string>([
  "maxxinvaders",
  "npcmaxx",
  "bunny1npc",
  "gingynpc",
  "eggnpc",
  "vampnpc",
  "test",
]);

export function isActionAllowedOnFanBoards(action: string): boolean {
  if (!(TIKTRIGGER_ACTIONS as readonly string[]).includes(action)) return false;
  if (isTikTokSocialOnlyAction(action)) return false;
  if (FAN_BOARD_EXCLUDED.has(action)) return false;
  return true;
}

export type FanBoardSlotRow = {
  id: string;
  streamer_user_id: string;
  board_tier: FanBoardTier;
  action_key: string;
  sort_order: number;
  server_id: string | null;
  created_at: Date;
};

export async function listFanBoardSlotsForStreamer(streamerUserId: string): Promise<FanBoardSlotRow[]> {
  const { rows } = await query<FanBoardSlotRow>(
    `SELECT id, streamer_user_id, board_tier::text, action_key, sort_order, server_id::text, created_at
     FROM streamer_fan_board_slots
     WHERE streamer_user_id = $1::uuid
     ORDER BY board_tier, sort_order ASC, action_key ASC`,
    [streamerUserId]
  );
  return rows.map((r) => ({
    ...r,
    board_tier: r.board_tier as FanBoardTier,
    server_id: r.server_id ?? null,
  }));
}

/**
 * Union of action keys allowed on any of the streamer's webhook servers (owner policy).
 */
export async function getEffectiveFanBoardActionKeysForStreamer(streamerUserId: string): Promise<Set<string>> {
  const hooks = await listStreamerWebhooksForUser(streamerUserId);
  const allow = new Set<string>();
  for (const h of hooks) {
    const policy = await getStreamerPolicyForServer(h.server_id);
    for (const a of policy?.effectiveActions ?? []) {
      if (isActionAllowedOnFanBoards(a)) allow.add(a);
    }
  }
  return allow;
}

export async function getMergedFanBoardSettings(streamerUserId: string): Promise<
  Record<FanBoardTier, { cooldown_seconds: number; max_buttons: number | null }>
> {
  const { rows } = await query<{ board_tier: string; cooldown_seconds: number }>(
    `SELECT board_tier::text, cooldown_seconds FROM streamer_fan_board_settings
     WHERE streamer_user_id = $1::uuid`,
    [streamerUserId]
  );
  const byTier = new Map(
    rows.map((r) => [r.board_tier as FanBoardTier, typeof r.cooldown_seconds === "number" ? r.cooldown_seconds : 0])
  );
  const tiers: FanBoardTier[] = ["fan", "superfan", "mod"];
  const out = {} as Record<FanBoardTier, { cooldown_seconds: number; max_buttons: number | null }>;
  for (const t of tiers) {
    const cd = byTier.get(t);
    out[t] = {
      cooldown_seconds:
        cd !== undefined && Number.isFinite(cd) ? Math.min(3600, Math.max(0, cd)) : FAN_BOARD_DEFAULT_COOLDOWN_SECONDS[t],
      max_buttons: maxButtonsForTier(t),
    };
  }
  return out;
}

export async function getCooldownSecondsForTier(
  streamerUserId: string,
  tier: FanBoardTier
): Promise<number> {
  const merged = await getMergedFanBoardSettings(streamerUserId);
  return merged[tier].cooldown_seconds;
}

export async function replaceFanBoardTierSlots(
  streamerUserId: string,
  tier: FanBoardTier,
  actionKeys: string[],
  defaultServerId: string | null,
  opts?: { cooldownSeconds?: number }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowedCatalog = new Set(TIKTRIGGER_ACTIONS as readonly string[]);
  const effective = await getEffectiveFanBoardActionKeysForStreamer(streamerUserId);

  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of actionKeys) {
    const k = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!k || seen.has(k)) continue;
    if (!allowedCatalog.has(k)) return { ok: false, error: `Unknown action: ${k}` };
    if (!isActionAllowedOnFanBoards(k)) return { ok: false, error: `Action not available on fan boards: ${k}` };
    if (!effective.has(k)) {
      return {
        ok: false,
        error: `Action "${k}" is not enabled for your streamer server policy. Enable it under server streamer interactions or pick another action.`,
      };
    }
    seen.add(k);
    cleaned.push(k);
  }

  const maxB = maxButtonsForTier(tier);
  if (maxB !== null && cleaned.length > maxB) {
    return {
      ok: false,
      error:
        tier === "fan"
          ? "Fan board allows at most 5 action buttons."
          : "Superfan board allows at most 10 action buttons.",
    };
  }

  if (defaultServerId) {
    const hooks = await listStreamerWebhooksForUser(streamerUserId);
    const ok = hooks.some((h) => h.server_id === defaultServerId);
    if (!ok) return { ok: false, error: "server_id must be one of your streamer webhook servers." };
  }

  const p = pool;
  if (!p) return { ok: false, error: "Database not configured." };
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    await c.query(`DELETE FROM streamer_fan_board_slots WHERE streamer_user_id = $1::uuid AND board_tier = $2`, [
      streamerUserId,
      tier,
    ]);
    let order = 0;
    for (const action_key of cleaned) {
      await c.query(
        `INSERT INTO streamer_fan_board_slots (streamer_user_id, board_tier, action_key, sort_order, server_id)
         VALUES ($1::uuid, $2, $3, $4, $5::uuid)`,
        [streamerUserId, tier, action_key, order++, defaultServerId]
      );
    }
    if (opts?.cooldownSeconds !== undefined) {
      const cs = Math.min(3600, Math.max(0, Math.trunc(Number(opts.cooldownSeconds))));
      await c.query(
        `INSERT INTO streamer_fan_board_settings (streamer_user_id, board_tier, cooldown_seconds)
         VALUES ($1::uuid, $2, $3)
         ON CONFLICT (streamer_user_id, board_tier) DO UPDATE SET cooldown_seconds = EXCLUDED.cooldown_seconds`,
        [streamerUserId, tier, cs]
      );
    }
    await c.query("COMMIT");
    return { ok: true };
  } catch (e) {
    await c.query("ROLLBACK");
    const msg = e instanceof Error ? e.message : "Save failed";
    return { ok: false, error: msg };
  } finally {
    c.release();
  }
}

export async function resolveRconServerIdForSlot(
  streamerUserId: string,
  slotServerId: string | null
): Promise<string | null> {
  if (slotServerId) {
    const hooks = await listStreamerWebhooksForUser(streamerUserId);
    if (hooks.some((h) => h.server_id === slotServerId)) return slotServerId;
    return null;
  }
  const hooks = await listStreamerWebhooksForUser(streamerUserId);
  return hooks[0]?.server_id ?? null;
}

export async function getSlotForStreamerAction(
  streamerUserId: string,
  boardTier: FanBoardTier,
  actionKey: string
): Promise<FanBoardSlotRow | null> {
  const { rows } = await query<FanBoardSlotRow>(
    `SELECT id, streamer_user_id, board_tier::text, action_key, sort_order, server_id::text, created_at
     FROM streamer_fan_board_slots
     WHERE streamer_user_id = $1::uuid AND board_tier = $2 AND action_key = $3
     LIMIT 1`,
    [streamerUserId, boardTier, actionKey.toLowerCase()]
  );
  const r = rows[0];
  if (!r) return null;
  return { ...r, board_tier: r.board_tier as FanBoardTier, server_id: r.server_id ?? null };
}

export function viewerTierCanAccessBoard(viewerTier: FanBoardTier, boardTier: FanBoardTier): boolean {
  if (viewerTier === "mod") return true;
  if (viewerTier === "superfan") return boardTier === "fan" || boardTier === "superfan";
  return boardTier === "fan";
}

export function parseFanBoardTier(v: unknown): FanBoardTier | null {
  if (v === "fan" || v === "superfan" || v === "mod") return v;
  return null;
}

export function parseClubTier(v: unknown): FanBoardTier | null {
  return parseFanBoardTier(v);
}
