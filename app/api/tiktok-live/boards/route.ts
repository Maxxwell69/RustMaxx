import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession, requireCanManageServersFromDb } from "@/lib/api-auth";
import { query } from "@/lib/db";
import { tiktokDirectEnabled, isUuidLike } from "@/lib/tiktok-live";

export async function GET(request: NextRequest) {
  if (!tiktokDirectEnabled()) {
    return NextResponse.json({ error: "TikTok direct integration disabled" }, { status: 503 });
  }
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const includeTemplates = request.nextUrl.searchParams.get("includeTemplates") === "1";
  const includeServers = request.nextUrl.searchParams.get("includeServers") === "1";

  let sql = `SELECT id::text, scope_kind, user_id::text, server_id::text, name, is_enabled, is_default,
                    created_by::text, created_at, updated_at
             FROM tiktok_event_boards
             WHERE (scope_kind = 'streamer' AND user_id = $1::uuid)`;
  const params: unknown[] = [session.userId];
  if (includeTemplates) {
    sql += ` OR scope_kind = 'admin_template'`;
  }
  if (includeServers) {
    sql += ` OR (scope_kind = 'server' AND server_id IN (
                SELECT s.id FROM servers s
                LEFT JOIN server_users su ON su.server_id = s.id
                WHERE s.owner_id = $1::uuid OR su.user_id = $1::uuid
              ))`;
  }
  sql += ` ORDER BY scope_kind ASC, is_default DESC, created_at ASC`;
  const { rows } = await query(sql, params);
  return NextResponse.json({ boards: rows });
}

export async function POST(request: NextRequest) {
  if (!tiktokDirectEnabled()) {
    return NextResponse.json({ error: "TikTok direct integration disabled" }, { status: 503 });
  }
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  let body: {
    scopeKind?: string;
    name?: string;
    serverId?: string | null;
    isDefault?: boolean;
    isEnabled?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const scopeKind =
    body.scopeKind === "server"
      ? "server"
      : body.scopeKind === "admin_template"
        ? "admin_template"
        : "streamer";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  let userId: string | null = null;
  let serverId: string | null = null;
  if (scopeKind === "streamer") userId = session.userId;
  if (scopeKind === "server") {
    const sid = typeof body.serverId === "string" ? body.serverId.trim() : "";
    if (!isUuidLike(sid)) {
      return NextResponse.json({ error: "Valid serverId is required for server scope" }, { status: 400 });
    }
    const { rows } = await query<{ ok: number }>(
      `SELECT 1 AS ok
       FROM servers s
       LEFT JOIN server_users su ON su.server_id = s.id
       WHERE s.id = $1::uuid
         AND (s.owner_id = $2::uuid OR su.user_id = $2::uuid)
       LIMIT 1`,
      [sid, session.userId]
    );
    if (!rows[0]) return NextResponse.json({ error: "No access to this server" }, { status: 403 });
    serverId = sid;
  }
  if (scopeKind === "admin_template") {
    const adminErr = await requireCanManageServersFromDb(request);
    if (adminErr) return adminErr;
  }
  const isDefault = body.isDefault === true;
  const isEnabled = body.isEnabled !== false;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO tiktok_event_boards (scope_kind, user_id, server_id, name, is_enabled, is_default, created_by)
     VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid)
     RETURNING id::text`,
    [scopeKind, userId, serverId, name, isEnabled, isDefault, session.userId]
  );
  return NextResponse.json({ ok: true, id: rows[0]?.id ?? null });
}
