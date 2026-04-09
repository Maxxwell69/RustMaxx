import { NextRequest, NextResponse } from "next/server";
import { requireCanManageAdmins } from "@/lib/api-auth";
import { query } from "@/lib/db";
import { isBaseStreamerAction } from "@/lib/streamer-action-policy";

/**
 * Merge action keys into streamer_allowed_actions for all or selected servers.
 * Only keys that are active in the platform catalog are applied.
 */
export async function POST(request: NextRequest) {
  const err = await requireCanManageAdmins(request);
  if (err) return err;
  let body: { actionKeys?: unknown; serverIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.actionKeys) || body.actionKeys.length === 0) {
    return NextResponse.json({ error: "actionKeys must be a non-empty array" }, { status: 400 });
  }
  const keys: string[] = [];
  for (const k of body.actionKeys) {
    if (typeof k !== "string" || !k.trim()) {
      return NextResponse.json({ error: "Each action key must be a string" }, { status: 400 });
    }
    const t = k.trim();
    if (!isBaseStreamerAction(t)) {
      return NextResponse.json(
        { error: `Action "${t}" is not in the streamer base set (RustChaos / social only).` },
        { status: 400 }
      );
    }
    if (!keys.includes(t)) keys.push(t);
  }

  const { rows: activeRows } = await query<{ action_key: string }>(
    `SELECT action_key FROM streamer_platform_action_catalog
     WHERE is_active = true AND action_key = ANY($1::text[])`,
    [keys]
  );
  const active = new Set(activeRows.map((r) => r.action_key));
  const toMerge = keys.filter((k) => active.has(k));
  if (toMerge.length === 0) {
    return NextResponse.json(
      { error: "None of those actions are active in the catalog. Enable them first." },
      { status: 400 }
    );
  }

  const all = body.serverIds === "all";
  const idsRaw = body.serverIds;
  let serverIds: string[];
  if (all) {
    const { rows: srows } = await query<{ id: string }>(`SELECT id FROM servers`);
    serverIds = srows.map((r) => r.id);
  } else if (Array.isArray(idsRaw)) {
    serverIds = idsRaw.filter((x): x is string => typeof x === "string" && x.length > 0);
    if (serverIds.length === 0) {
      return NextResponse.json(
        { error: 'Use serverIds: "all" or a non-empty array of server UUIDs' },
        { status: 400 }
      );
    }
  } else {
    return NextResponse.json(
      { error: 'serverIds must be "all" or an array of server ids' },
      { status: 400 }
    );
  }

  let updated = 0;
  for (const sid of serverIds) {
    const { rows } = await query<{ streamer_allowed_actions: string[] | null }>(
      `SELECT streamer_allowed_actions FROM servers WHERE id = $1`,
      [sid]
    );
    const cur = rows[0]?.streamer_allowed_actions ?? [];
    const merged = [...new Set([...cur, ...toMerge])].sort();
    await query(`UPDATE servers SET streamer_allowed_actions = $1 WHERE id = $2`, [
      merged,
      sid,
    ]);
    updated += 1;
  }

  return NextResponse.json({
    ok: true,
    mergedActions: toMerge,
    serversUpdated: updated,
  });
}
