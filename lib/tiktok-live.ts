import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { runTikfinityWebhook } from "@/lib/tikfinity-webhook-run";
import type { TikfinityConnectionForWebhook } from "@/lib/tikfinity-connections";
import { parseNpcTemplateKey } from "@/lib/tikfinity-connections";
import { TIKTRIGGER_ACTIONS, type TikTriggerAction } from "@/lib/tikfinity";

export type TikTokDirectEventInput = {
  dedupeKey?: string | null;
  connectionId?: string | null;
  userId: string;
  serverId: string;
  eventType: string;
  eventName?: string | null;
  viewerName?: string | null;
  viewerUniqueId?: string | null;
  giftName?: string | null;
  value?: number | null;
  payload?: Record<string, unknown>;
  receivedAt?: string | null;
};

export type TikTokBoardMapping = {
  id: string;
  server_action: string;
  message: string | null;
  duration_seconds: number;
  npc_template_key: string | null;
  min_value: number;
  cooldown_seconds: number;
};

export function tiktokDirectEnabled(): boolean {
  const v = process.env.TIKTOK_DIRECT_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function tiktokIngestSignatureSecret(): string | null {
  const v = process.env.TIKTOK_INGEST_SECRET?.trim();
  return v || null;
}

export function isUuidLike(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function findDefaultBoardForEvent(
  userId: string,
  serverId: string
): Promise<{ id: string; scope_kind: string } | null> {
  const { rows } = await query<{ id: string; scope_kind: string }>(
    `SELECT id, scope_kind
     FROM tiktok_event_boards
     WHERE is_enabled = true
       AND (
         (scope_kind = 'streamer' AND user_id = $1::uuid)
         OR (scope_kind = 'server' AND server_id = $2::uuid)
         OR (scope_kind = 'admin_template' AND is_default = true)
       )
     ORDER BY
       CASE scope_kind WHEN 'streamer' THEN 0 WHEN 'server' THEN 1 ELSE 2 END,
       is_default DESC,
       created_at ASC
     LIMIT 1`,
    [userId, serverId]
  );
  return rows[0] ?? null;
}

export async function findMatchingMapping(
  boardId: string,
  eventType: string,
  eventName: string | null,
  giftName: string | null,
  value: number
): Promise<TikTokBoardMapping | null> {
  const keyCandidates = [eventName, giftName].filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0
  );
  const { rows } = await query<TikTokBoardMapping>(
    `SELECT id, server_action, message,
            COALESCE(duration_seconds, 10) AS duration_seconds,
            npc_template_key, COALESCE(min_value, 0) AS min_value,
            COALESCE(cooldown_seconds, 0) AS cooldown_seconds
     FROM tiktok_event_mappings
     WHERE board_id = $1::uuid
       AND is_enabled = true
       AND lower(event_type) = lower($2)
       AND COALESCE(min_value, 0) <= $3
       AND (
         event_key IS NULL
         OR lower(event_key) = ANY($4::text[])
       )
     ORDER BY priority DESC, created_at ASC
     LIMIT 1`,
    [boardId, eventType, value, keyCandidates.map((k) => k.toLowerCase())]
  );
  return rows[0] ?? null;
}

export async function insertLiveEvent(input: TikTokDirectEventInput): Promise<{ eventId: string; jobId: string }> {
  const value = Number.isFinite(Number(input.value)) ? Math.max(0, Math.trunc(Number(input.value))) : 0;
  const dedupeKey = input.dedupeKey?.trim() || null;
  const payload = input.payload ?? {};
  const receivedAt =
    input.receivedAt && !Number.isNaN(Date.parse(input.receivedAt))
      ? new Date(input.receivedAt)
      : new Date();

  const board = await findDefaultBoardForEvent(input.userId, input.serverId);

  if (dedupeKey) {
    const { rows: existing } = await query<{ id: string }>(
      "SELECT id::text FROM tiktok_live_events WHERE dedupe_key = $1 LIMIT 1",
      [dedupeKey]
    );
    if (existing[0]?.id) {
      const { rows: jobs } = await query<{ id: string }>(
        "SELECT id::text FROM tiktok_event_jobs WHERE event_id = $1::uuid LIMIT 1",
        [existing[0].id]
      );
      return { eventId: existing[0].id, jobId: jobs[0]?.id ?? "" };
    }
  }

  const { rows } = await query<{ id: string }>(
    `INSERT INTO tiktok_live_events
      (dedupe_key, connection_id, user_id, server_id, board_id, event_type, event_name,
       viewer_name, viewer_unique_id, gift_name, value, payload, received_at)
     VALUES
      ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
     RETURNING id::text`,
    [
      dedupeKey,
      input.connectionId ?? null,
      input.userId,
      input.serverId,
      board?.id ?? null,
      input.eventType,
      input.eventName ?? null,
      input.viewerName ?? null,
      input.viewerUniqueId ?? null,
      input.giftName ?? null,
      value,
      JSON.stringify(payload),
      receivedAt.toISOString(),
    ]
  );
  const eventId = rows[0]?.id;
  if (!eventId) throw new Error("insert tiktok_live_events failed");
  const { rows: jr } = await query<{ id: string }>(
    `INSERT INTO tiktok_event_jobs (event_id, status, next_run_at)
     VALUES ($1::uuid, 'queued', now())
     RETURNING id::text`,
    [eventId]
  );
  return { eventId, jobId: jr[0]?.id ?? "" };
}

function toConnectionFromMapping(mapping: TikTokBoardMapping): TikfinityConnectionForWebhook | null {
  if (!(TIKTRIGGER_ACTIONS as readonly string[]).includes(mapping.server_action)) return null;
  return {
    id: mapping.id,
    server_action: mapping.server_action as TikTriggerAction,
    scrap_amount: 0,
    message: mapping.message ?? null,
    duration_seconds: mapping.duration_seconds,
    npc_template_key: parseNpcTemplateKey(mapping.npc_template_key),
  };
}

export async function processEventJob(jobId: string): Promise<{ status: "done" | "failed"; error?: string }> {
  const { rows } = await query<{
    id: string;
    event_id: string;
    attempts: number;
    status: string;
    user_id: string;
    server_id: string;
    event_type: string;
    event_name: string | null;
    gift_name: string | null;
    value: number;
    payload: Record<string, unknown>;
    board_id: string | null;
  }>(
    `SELECT j.id::text, j.event_id::text, j.attempts, j.status,
            e.user_id::text, e.server_id::text, e.event_type, e.event_name, e.gift_name,
            COALESCE(e.value, 0) AS value, e.payload, e.board_id::text
     FROM tiktok_event_jobs j
     JOIN tiktok_live_events e ON e.id = j.event_id
     WHERE j.id = $1::uuid
     LIMIT 1`,
    [jobId]
  );
  const job = rows[0];
  if (!job) return { status: "failed", error: "job not found" };

  try {
    await query(
      `UPDATE tiktok_event_jobs
       SET status = 'processing', attempts = attempts + 1, locked_at = now(), updated_at = now()
       WHERE id = $1::uuid`,
      [jobId]
    );
    const boardId = job.board_id ?? (await findDefaultBoardForEvent(job.user_id, job.server_id))?.id ?? null;
    let connection: TikfinityConnectionForWebhook | null = null;
    if (boardId) {
      const mapping = await findMatchingMapping(
        boardId,
        job.event_type,
        job.event_name,
        job.gift_name,
        Number(job.value) || 0
      );
      if (mapping) connection = toConnectionFromMapping(mapping);
    }

    const url = new URL(`https://direct.local/tiktok`);
    if (job.event_name) url.searchParams.set("event", job.event_name);
    if (job.gift_name) url.searchParams.set("giftName", job.gift_name);
    const req = new NextRequest(url, {
      method: "POST",
      body: JSON.stringify(job.payload ?? {}),
      headers: { "content-type": "application/json" },
    });
    const out = await runTikfinityWebhook(req, job.payload ?? {}, {
      serverId: job.server_id,
      resolveConnectionByEventName: async () => connection,
      streamerAllowedActions: null,
    });
    const outJson = await out.json().catch(() => ({}));
    const ok = out.ok && outJson && outJson.ok !== false;
    const actionStatus = ok ? "processed" : "failed";
    await query(
      `UPDATE tiktok_live_events
       SET board_id = COALESCE(board_id, $2::uuid),
           action_status = $3,
           action_error = $4,
           action_response = $5,
           processed_at = now()
       WHERE id = $1::uuid`,
      [
        job.event_id,
        boardId,
        actionStatus,
        ok ? null : (typeof outJson?.error === "string" ? outJson.error : `HTTP ${out.status}`),
        JSON.stringify(outJson ?? {}),
      ]
    );
    await query(
      `UPDATE tiktok_event_jobs
       SET status = $2, updated_at = now(), locked_at = NULL, last_error = $3
       WHERE id = $1::uuid`,
      [jobId, ok ? "done" : "failed", ok ? null : JSON.stringify(outJson ?? {})]
    );
    await upsertDailyAnalytics(job.event_id);
    return ok ? { status: "done" } : { status: "failed", error: "dispatch failed" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await query(
      `UPDATE tiktok_event_jobs
       SET status = CASE WHEN attempts >= 4 THEN 'dead' ELSE 'failed' END,
           next_run_at = CASE WHEN attempts >= 4 THEN next_run_at ELSE now() + interval '30 seconds' END,
           last_error = $2,
           updated_at = now(),
           locked_at = NULL
       WHERE id = $1::uuid`,
      [jobId, msg]
    );
    await query(
      `UPDATE tiktok_live_events
       SET action_status = 'failed', action_error = $2, processed_at = now()
       WHERE id = (SELECT event_id FROM tiktok_event_jobs WHERE id = $1::uuid)`,
      [jobId, msg]
    );
    return { status: "failed", error: msg };
  }
}

export async function processDueEventJobs(limit = 25): Promise<{ processed: number; failed: number }> {
  const { rows } = await query<{ id: string }>(
    `SELECT id::text
     FROM tiktok_event_jobs
     WHERE status IN ('queued', 'failed')
       AND next_run_at <= now()
     ORDER BY next_run_at ASC
     LIMIT $1`,
    [Math.max(1, Math.min(limit, 200))]
  );
  let processed = 0;
  let failed = 0;
  for (const r of rows) {
    const out = await processEventJob(r.id);
    if (out.status === "done") processed += 1;
    else failed += 1;
  }
  return { processed, failed };
}

export async function upsertDailyAnalytics(eventId: string): Promise<void> {
  await query(
    `INSERT INTO tiktok_event_analytics_daily
      (day, user_id, server_id, event_type, event_name, events_count, total_value,
       processed_count, failed_count, updated_at)
     SELECT
       date_trunc('day', e.received_at)::date AS day,
       e.user_id, e.server_id, e.event_type, e.event_name,
       1,
       COALESCE(e.value, 0),
       CASE WHEN e.action_status = 'processed' THEN 1 ELSE 0 END,
       CASE WHEN e.action_status = 'failed' THEN 1 ELSE 0 END,
       now()
     FROM tiktok_live_events e
     WHERE e.id = $1::uuid
     ON CONFLICT (day, user_id, server_id, event_type, event_name)
     DO UPDATE SET
       events_count = tiktok_event_analytics_daily.events_count + 1,
       total_value = tiktok_event_analytics_daily.total_value + EXCLUDED.total_value,
       processed_count = tiktok_event_analytics_daily.processed_count + EXCLUDED.processed_count,
       failed_count = tiktok_event_analytics_daily.failed_count + EXCLUDED.failed_count,
       updated_at = now()`,
    [eventId]
  );
}

export function verifyIngestSignature(rawBody: string, signature: string | null): boolean {
  const secret = tiktokIngestSignatureSecret();
  if (!secret) return false;
  if (!signature) return false;
  const crypto = require("crypto") as typeof import("crypto");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
