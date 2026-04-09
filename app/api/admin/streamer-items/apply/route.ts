import { NextRequest, NextResponse } from "next/server";
import { requireCanManageAdmins } from "@/lib/api-auth";
import { query } from "@/lib/db";

/**
 * Merge item shortnames into servers.streamer_allowed_item_shortnames for all or selected servers.
 * Only shortnames that exist and are active in streamer_platform_items are merged.
 */
export async function POST(request: NextRequest) {
  const err = await requireCanManageAdmins(request);
  if (err) return err;
  let body: { shortnames?: unknown; serverIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.shortnames) || body.shortnames.length === 0) {
    return NextResponse.json({ error: "shortnames must be a non-empty array" }, { status: 400 });
  }
  const names: string[] = [];
  for (const s of body.shortnames) {
    if (typeof s !== "string" || !s.trim()) {
      return NextResponse.json({ error: "Invalid shortname" }, { status: 400 });
    }
    const t = s.trim();
    if (!names.includes(t)) names.push(t);
  }

  const { rows: activeRows } = await query<{ shortname: string }>(
    `SELECT shortname FROM streamer_platform_items WHERE is_active = true AND shortname = ANY($1::text[])`,
    [names]
  );
  const active = new Set(activeRows.map((r) => r.shortname));
  const toMerge = names.filter((n) => active.has(n));
  if (toMerge.length === 0) {
    return NextResponse.json(
      { error: "None of those items are active in the streamer catalog." },
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
    const { rows } = await query<{ streamer_allowed_item_shortnames: string[] | null }>(
      `SELECT streamer_allowed_item_shortnames FROM servers WHERE id = $1`,
      [sid]
    );
    const cur = rows[0]?.streamer_allowed_item_shortnames ?? [];
    const merged = [...new Set([...cur, ...toMerge])].sort();
    await query(`UPDATE servers SET streamer_allowed_item_shortnames = $1 WHERE id = $2`, [
      merged,
      sid,
    ]);
    updated += 1;
  }

  return NextResponse.json({
    ok: true,
    mergedShortnames: toMerge,
    serversUpdated: updated,
  });
}
