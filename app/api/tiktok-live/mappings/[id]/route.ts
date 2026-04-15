import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession, requireCanManageServersFromDb } from "@/lib/api-auth";
import { query } from "@/lib/db";
import { parseNpcTemplateKey } from "@/lib/tikfinity-connections";
import { tiktokDirectEnabled, isUuidLike } from "@/lib/tiktok-live";
import { TIKTRIGGER_ACTIONS } from "@/lib/tikfinity";

async function canAccessMapping(mappingId: string, userId: string, canAdmin: boolean): Promise<boolean> {
  const { rows } = await query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM tiktok_event_mappings m
     JOIN tiktok_event_boards b ON b.id = m.board_id
     LEFT JOIN server_users su ON su.server_id = b.server_id AND su.user_id = $2::uuid
     LEFT JOIN servers s ON s.id = b.server_id
     WHERE m.id = $1::uuid
       AND (
         b.user_id = $2::uuid
         OR s.owner_id = $2::uuid
         OR su.user_id = $2::uuid
         OR ($3 = true AND b.scope_kind = 'admin_template')
       )
     LIMIT 1`,
    [mappingId, userId, canAdmin]
  );
  return Boolean(rows[0]);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!tiktokDirectEnabled()) {
    return NextResponse.json({ error: "TikTok direct integration disabled" }, { status: 503 });
  }
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id } = await params;
  if (!isUuidLike(id)) return NextResponse.json({ error: "Invalid mapping id" }, { status: 400 });
  const adminErr = await requireCanManageServersFromDb(request);
  const canAdmin = !adminErr;
  const allowed = await canAccessMapping(id, session.userId, canAdmin);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const updates: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (typeof body.eventType === "string") {
    updates.push(`event_type = $${i++}`);
    vals.push(body.eventType.trim().toLowerCase());
  }
  if (typeof body.eventKey === "string" || body.eventKey === null) {
    updates.push(`event_key = $${i++}`);
    vals.push(typeof body.eventKey === "string" ? body.eventKey.trim() || null : null);
  }
  if (typeof body.minValue === "number") {
    updates.push(`min_value = $${i++}`);
    vals.push(Math.max(0, Math.trunc(body.minValue)));
  }
  if (typeof body.serverAction === "string") {
    const action = body.serverAction.trim();
    if (!(TIKTRIGGER_ACTIONS as readonly string[]).includes(action)) {
      return NextResponse.json({ error: "Invalid serverAction" }, { status: 400 });
    }
    updates.push(`server_action = $${i++}`);
    vals.push(action);
  }
  if (typeof body.message === "string" || body.message === null) {
    updates.push(`message = $${i++}`);
    vals.push(typeof body.message === "string" ? body.message.trim() || null : null);
  }
  if (typeof body.durationSeconds === "number") {
    updates.push(`duration_seconds = $${i++}`);
    vals.push(Math.max(1, Math.min(120, Math.trunc(body.durationSeconds))));
  }
  if (typeof body.npcTemplateKey === "string" || body.npcTemplateKey === null) {
    updates.push(`npc_template_key = $${i++}`);
    vals.push(body.npcTemplateKey == null ? null : parseNpcTemplateKey(body.npcTemplateKey));
  }
  if (typeof body.cooldownSeconds === "number") {
    updates.push(`cooldown_seconds = $${i++}`);
    vals.push(Math.max(0, Math.trunc(body.cooldownSeconds)));
  }
  if (typeof body.priority === "number") {
    updates.push(`priority = $${i++}`);
    vals.push(Math.trunc(body.priority));
  }
  if (typeof body.isEnabled === "boolean") {
    updates.push(`is_enabled = $${i++}`);
    vals.push(body.isEnabled);
  }
  if (updates.length === 0) return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  updates.push("updated_at = now()");
  vals.push(id);
  await query(`UPDATE tiktok_event_mappings SET ${updates.join(", ")} WHERE id = $${i}::uuid`, vals);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!tiktokDirectEnabled()) {
    return NextResponse.json({ error: "TikTok direct integration disabled" }, { status: 503 });
  }
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id } = await params;
  if (!isUuidLike(id)) return NextResponse.json({ error: "Invalid mapping id" }, { status: 400 });
  const adminErr = await requireCanManageServersFromDb(request);
  const canAdmin = !adminErr;
  const allowed = await canAccessMapping(id, session.userId, canAdmin);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await query("DELETE FROM tiktok_event_mappings WHERE id = $1::uuid", [id]);
  return NextResponse.json({ ok: true });
}
