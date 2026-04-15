import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession, requireCanManageServersFromDb } from "@/lib/api-auth";
import { query } from "@/lib/db";
import { parseNpcTemplateKey } from "@/lib/tikfinity-connections";
import { tiktokDirectEnabled, isUuidLike } from "@/lib/tiktok-live";
import { TIKTRIGGER_ACTIONS } from "@/lib/tikfinity";

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

export async function GET(
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
  const { rows } = await query(
    `SELECT id::text, board_id::text, event_type, event_key, min_value, server_action, message,
            duration_seconds, npc_template_key, cooldown_seconds, priority, is_enabled, created_at, updated_at
     FROM tiktok_event_mappings
     WHERE board_id = $1::uuid
     ORDER BY priority DESC, created_at ASC`,
    [id]
  );
  return NextResponse.json({ mappings: rows });
}

export async function POST(
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

  let body: {
    eventType?: string;
    eventKey?: string | null;
    minValue?: number;
    serverAction?: string;
    message?: string | null;
    durationSeconds?: number;
    npcTemplateKey?: string | null;
    cooldownSeconds?: number;
    priority?: number;
    isEnabled?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const eventType = typeof body.eventType === "string" ? body.eventType.trim().toLowerCase() : "";
  if (!eventType) return NextResponse.json({ error: "eventType is required" }, { status: 400 });
  const eventKey = typeof body.eventKey === "string" ? body.eventKey.trim() || null : null;
  const action = typeof body.serverAction === "string" ? body.serverAction.trim() : "";
  if (!(TIKTRIGGER_ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: "Invalid serverAction" }, { status: 400 });
  }
  const minValue = typeof body.minValue === "number" ? Math.max(0, Math.trunc(body.minValue)) : 0;
  const durationSeconds = typeof body.durationSeconds === "number" ? Math.max(1, Math.min(120, Math.trunc(body.durationSeconds))) : 10;
  const cooldownSeconds = typeof body.cooldownSeconds === "number" ? Math.max(0, Math.trunc(body.cooldownSeconds)) : 0;
  const priority = typeof body.priority === "number" ? Math.trunc(body.priority) : 0;
  const message = typeof body.message === "string" ? body.message.trim() || null : null;
  const npcTemplateKey = parseNpcTemplateKey(body.npcTemplateKey);
  const isEnabled = body.isEnabled !== false;

  const { rows } = await query<{ id: string }>(
    `INSERT INTO tiktok_event_mappings
      (board_id, event_type, event_key, min_value, server_action, message, duration_seconds,
       npc_template_key, cooldown_seconds, priority, is_enabled)
     VALUES
      ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id::text`,
    [id, eventType, eventKey, minValue, action, message, durationSeconds, npcTemplateKey, cooldownSeconds, priority, isEnabled]
  );
  return NextResponse.json({ ok: true, id: rows[0]?.id ?? null });
}
