/**
 * Per-streamer TikFinity rules (same whitelist as admin tikfinity_connections).
 */

import { query } from "@/lib/db";
import {
  TIKTRIGGER_ACTIONS,
  type TikTriggerAction,
  isRustChaosStatusEffectAction,
  isRustChaosSoloScrapSpawnAction,
  clampSoloSpawnRepeatCount,
} from "@/lib/tikfinity";
import {
  parseNpcTemplateKey,
  type TikfinityConnectionForWebhook,
} from "@/lib/tikfinity-connections";

export type StreamerTikfinityRuleRow = {
  id: string;
  streamer_webhook_id: string;
  name: string;
  server_action: string;
  message: string | null;
  scrap_amount: number;
  duration_seconds: number;
  spawn_count: number;
  npc_template_key: string | null;
  created_at: Date;
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/^!+/, "");
}

function canonicalizeName(name: string): string {
  return normalizeName(name).replace(/[^a-z0-9]+/g, "");
}

const SCRAP_MAX = 10000;

export async function getStreamerRuleByEventName(
  streamerWebhookId: string,
  name: string
): Promise<TikfinityConnectionForWebhook | null> {
  const key = normalizeName(name);
  const canonical = canonicalizeName(name);
  if (!key) return null;
  const { rows } = await query<StreamerTikfinityRuleRow>(
    `SELECT id, streamer_webhook_id, name, server_action, COALESCE(scrap_amount, 0) AS scrap_amount,
            COALESCE(duration_seconds, 10) AS duration_seconds, COALESCE(spawn_count, 1) AS spawn_count, message, npc_template_key
     FROM streamer_tikfinity_rules
     WHERE streamer_webhook_id = $1
       AND (
         lower(trim(name)) = $2
         OR regexp_replace(lower(trim(name)), '[^a-z0-9]+', '', 'g') = $3
       )
     LIMIT 1`,
    [streamerWebhookId, key, canonical]
  );
  const row = rows[0];
  if (
    !row?.server_action ||
    !(TIKTRIGGER_ACTIONS as readonly string[]).includes(row.server_action)
  )
    return null;
  const dur = Number(row.duration_seconds);
  const sp = Number(row.spawn_count);
  return {
    id: row.id,
    server_action: row.server_action as TikTriggerAction,
    scrap_amount: Number(row.scrap_amount) || 0,
    message: row.message ?? null,
    npc_template_key: row.npc_template_key ?? null,
    duration_seconds:
      Number.isFinite(dur) && dur >= 1 && dur <= 120 ? Math.trunc(dur) : 10,
    spawn_count:
      Number.isFinite(sp) && sp >= 1 ? clampSoloSpawnRepeatCount(sp) : 1,
  };
}

export async function listStreamerRules(
  streamerWebhookId: string
): Promise<StreamerTikfinityRuleRow[]> {
  const { rows } = await query<StreamerTikfinityRuleRow>(
    `SELECT id, streamer_webhook_id, name, server_action, message, COALESCE(scrap_amount, 0) AS scrap_amount,
            COALESCE(duration_seconds, 10) AS duration_seconds, COALESCE(spawn_count, 1) AS spawn_count, npc_template_key, created_at
     FROM streamer_tikfinity_rules WHERE streamer_webhook_id = $1 ORDER BY created_at DESC`,
    [streamerWebhookId]
  );
  return rows.map((r) => ({
    ...r,
    scrap_amount: Number(r.scrap_amount) || 0,
    spawn_count: clampSoloSpawnRepeatCount(Number(r.spawn_count) || 1),
    duration_seconds: (() => {
      const d = Number(r.duration_seconds);
      return Number.isFinite(d) && d >= 1 && d <= 120 ? Math.trunc(d) : 10;
    })(),
  }));
}

export async function createStreamerRule(
  streamerWebhookId: string,
  name: string,
  serverAction: TikTriggerAction,
  options: {
    message?: string | null;
    scrapAmount?: number;
    durationSeconds?: number;
    npcTemplateKey?: string | null;
    spawnCount?: number;
  } = {}
): Promise<{ id: string } | { error: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Name is required" };
  if (!(TIKTRIGGER_ACTIONS as readonly string[]).includes(serverAction))
    return { error: "Invalid server action" };
  const scrap = Math.min(SCRAP_MAX, Math.max(0, Number(options.scrapAmount) || 0));
  let durationSeconds = Math.trunc(Number(options.durationSeconds) || 10);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1) durationSeconds = 10;
  if (durationSeconds > 120) durationSeconds = 120;
  if (!isRustChaosStatusEffectAction(serverAction)) durationSeconds = 10;
  let spawnCount = clampSoloSpawnRepeatCount(Number(options.spawnCount) || 1);
  if (!isRustChaosSoloScrapSpawnAction(serverAction)) spawnCount = 1;
  const message =
    options.message != null ? String(options.message).trim() || null : null;
  let npcTemplateKey: string | null = null;
  if (serverAction === "npcmaxx") {
    const parsed = parseNpcTemplateKey(options.npcTemplateKey);
    if (!parsed) {
      return {
        error:
          "Roaming template key is required for Roaming NPC (1–64 chars, letters, numbers, _, -).",
      };
    }
    npcTemplateKey = parsed;
  } else if (serverAction === "maxxinvaders") {
    if (options.npcTemplateKey != null && String(options.npcTemplateKey).trim()) {
      const parsed = parseNpcTemplateKey(options.npcTemplateKey);
      if (!parsed) {
        return {
          error:
            "Optional Roaming template key is invalid (1–64 chars, letters, numbers, _, -). Leave blank for default streamer_patrol.",
        };
      }
      npcTemplateKey = parsed;
    }
  }
  const { rows: existing } = await query<{ n: string }>(
    `SELECT 1 AS n
     FROM streamer_tikfinity_rules
     WHERE streamer_webhook_id = $1
       AND (
         lower(trim(name)) = $2
         OR regexp_replace(lower(trim(name)), '[^a-z0-9]+', '', 'g') = $3
       )
     LIMIT 1`,
    [streamerWebhookId, normalizeName(trimmed), canonicalizeName(trimmed)]
  );
  if (existing.length > 0) return { error: "A rule with this event name already exists" };
  const { rows } = await query<{ id: string }>(
    `INSERT INTO streamer_tikfinity_rules (streamer_webhook_id, name, server_action, message, scrap_amount, duration_seconds, spawn_count, npc_template_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      streamerWebhookId,
      trimmed,
      serverAction,
      message,
      scrap,
      durationSeconds,
      spawnCount,
      npcTemplateKey,
    ]
  );
  if (!rows[0]) return { error: "Insert failed" };
  return { id: rows[0].id };
}

export async function deleteStreamerRule(
  ruleId: string,
  streamerWebhookId: string
): Promise<{ deleted: boolean }> {
  const { rowCount } = await query(
    "DELETE FROM streamer_tikfinity_rules WHERE id = $1 AND streamer_webhook_id = $2",
    [ruleId, streamerWebhookId]
  );
  return { deleted: (rowCount ?? 0) > 0 };
}

/** Delete a rule if it belongs to any of this user's webhooks. */
export async function deleteStreamerRuleForUser(
  ruleId: string,
  userId: string
): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM streamer_tikfinity_rules r
     USING streamer_webhooks w
     WHERE r.id = $1::uuid AND r.streamer_webhook_id = w.id AND w.user_id = $2::uuid`,
    [ruleId, userId]
  );
  return (rowCount ?? 0) > 0;
}
