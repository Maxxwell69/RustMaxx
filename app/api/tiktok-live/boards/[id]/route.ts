import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession, requireCanManageServersFromDb } from "@/lib/api-auth";
import { query } from "@/lib/db";
import { tiktokDirectEnabled, isUuidLike } from "@/lib/tiktok-live";

async function canAccessBoard(boardId: string, userId: string, canAdmin: boolean): Promise<boolean> {
  const { rows } = await query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM tiktok_event_boards b
     LEFT JOIN server_users su ON su.server_id = b.server_id AND su.user_id = $2::uuid
     LEFT JOIN servers s ON s.id = b.server_id
     WHERE b.id = $1::uuid
       AND (
         b.user_id = $2::uuid
         OR s.owner_id = $2::uuid
         OR su.user_id = $2::uuid
         OR ($3 = true AND b.scope_kind = 'admin_template')
       )
     LIMIT 1`,
    [boardId, userId, canAdmin]
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
  if (!isUuidLike(id)) return NextResponse.json({ error: "Invalid board id" }, { status: 400 });
  const adminErr = await requireCanManageServersFromDb(request);
  const canAdmin = !adminErr;
  const allowed = await canAccessBoard(id, session.userId, canAdmin);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: { name?: string; isEnabled?: boolean; isDefault?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const updates: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (typeof body.name === "string") {
    updates.push(`name = $${i++}`);
    vals.push(body.name.trim());
  }
  if (typeof body.isEnabled === "boolean") {
    updates.push(`is_enabled = $${i++}`);
    vals.push(body.isEnabled);
  }
  if (typeof body.isDefault === "boolean") {
    updates.push(`is_default = $${i++}`);
    vals.push(body.isDefault);
  }
  if (updates.length === 0) return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  updates.push("updated_at = now()");
  vals.push(id);
  await query(`UPDATE tiktok_event_boards SET ${updates.join(", ")} WHERE id = $${i}::uuid`, vals);
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
  if (!isUuidLike(id)) return NextResponse.json({ error: "Invalid board id" }, { status: 400 });
  const adminErr = await requireCanManageServersFromDb(request);
  const canAdmin = !adminErr;
  const allowed = await canAccessBoard(id, session.userId, canAdmin);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await query("DELETE FROM tiktok_event_boards WHERE id = $1::uuid", [id]);
  return NextResponse.json({ ok: true });
}
