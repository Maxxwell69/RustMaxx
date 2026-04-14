/**
 * Streamer-facing actions: RustChaos + TikTok social (Squawk) only.
 * No NPCMaxx, MaxxInvaders, RoamingNPC spawns, chaos waves, scientist boat, chaos heli, etc.
 */
import { query } from "@/lib/db";
import type { TikTriggerAction } from "@/lib/tikfinity";

export const STREAMER_BASE_ACTION_KEYS = [
  "test",
  "rose",
  "smoke",
  "fireworks",
  "scientist",
  "scientistflame",
  "wolf",
  "bear",
  "tiger",
  "panther",
  "shark",
  "pig",
  "chicken",
  "supply",
  "likes",
  "healinghands",
  "fullheal",
  "bunny1",
  "pistolammo50",
  "follow",
  "share",
  "subscribe",
  "sociallike",
] as const satisfies readonly TikTriggerAction[];

const BASE_SET = new Set<string>(STREAMER_BASE_ACTION_KEYS);

export function isBaseStreamerAction(key: string): boolean {
  return BASE_SET.has(key);
}

export type StreamerServerPolicy = {
  enabled: boolean;
  /** Actions a streamer may run on this server (intersection: owner selection ∩ platform catalog ∩ base list). */
  effectiveActions: string[];
};

export async function getStreamerPolicyForServer(
  serverId: string
): Promise<StreamerServerPolicy | null> {
  const { rows } = await query<{
    streamer_interactions_enabled: boolean;
    streamer_allowed_actions: string[];
  }>(
    `SELECT streamer_interactions_enabled, streamer_allowed_actions FROM servers WHERE id = $1`,
    [serverId]
  );
  const row = rows[0];
  if (!row) return null;
  if (!row.streamer_interactions_enabled) {
    return { enabled: false, effectiveActions: [] };
  }
  const { rows: catRows } = await query<{ action_key: string }>(
    `SELECT action_key FROM streamer_platform_action_catalog WHERE is_active = true`
  );
  const platform = new Set(catRows.map((r) => r.action_key));
  const owner = Array.isArray(row.streamer_allowed_actions)
    ? row.streamer_allowed_actions
    : [];
  const effective: string[] = [];
  for (const key of owner) {
    if (
      typeof key === "string" &&
      isBaseStreamerAction(key) &&
      platform.has(key)
    ) {
      effective.push(key);
    }
  }
  effective.sort();
  return { enabled: true, effectiveActions: effective };
}

export async function isActionAllowedForStreamerOnServer(
  serverId: string,
  action: string
): Promise<boolean> {
  const policy = await getStreamerPolicyForServer(serverId);
  if (!policy?.enabled) return false;
  return policy.effectiveActions.includes(action);
}

/** For server owner UI: selectable actions = base ∩ platform catalog (active). */
export async function getSelectableStreamerActionsForServer(): Promise<
  { action_key: string; label: string | null }[]
> {
  const { rows } = await query<{ action_key: string; label: string | null }>(
    `SELECT c.action_key, c.label
     FROM streamer_platform_action_catalog c
     WHERE c.is_active = true
     ORDER BY c.action_key ASC`
  );
  return rows.filter((r) => isBaseStreamerAction(r.action_key));
}

export async function assertOwnerActionsAllowedByCatalog(
  keys: string[]
): Promise<{ ok: true } | { error: string }> {
  if (keys.length === 0) return { ok: true };
  const { rows } = await query<{ action_key: string }>(
    `SELECT action_key FROM streamer_platform_action_catalog
     WHERE is_active = true AND action_key = ANY($1::text[])`,
    [keys]
  );
  const found = new Set(rows.map((r) => r.action_key));
  for (const k of keys) {
    if (!found.has(k)) {
      return {
        error: `Action "${k}" is not activated for streamers in the platform catalog.`,
      };
    }
  }
  return { ok: true };
}

export function validateAllowedActionsPayload(
  keys: unknown
): string[] | { error: string } {
  if (!Array.isArray(keys)) return { error: "streamer_allowed_actions must be an array of strings" };
  const out: string[] = [];
  for (const k of keys) {
    if (typeof k !== "string" || !k.trim()) {
      return { error: "Invalid action key in streamer_allowed_actions" };
    }
    const t = k.trim();
    if (!isBaseStreamerAction(t)) {
      return { error: `Action "${t}" is not allowed for streamers (RustChaos / social only).` };
    }
    if (!out.includes(t)) out.push(t);
  }
  return out;
}
