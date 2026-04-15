import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { query } from "@/lib/db";
import { tiktokDirectEnabled, isUuidLike } from "@/lib/tiktok-live";

export async function GET(request: NextRequest) {
  if (!tiktokDirectEnabled()) {
    return NextResponse.json({ error: "TikTok direct integration disabled" }, { status: 503 });
  }
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { rows } = await query(
    `SELECT c.id::text, c.user_id::text, c.server_id::text, s.name AS server_name,
            c.platform_user_id, c.platform_username, c.status, c.worker_session_id,
            c.last_seen_at, c.last_error, c.created_at, c.updated_at
     FROM tiktok_live_connections c
     JOIN servers s ON s.id = c.server_id
     WHERE c.user_id = $1::uuid
     ORDER BY c.created_at DESC`,
    [session.userId]
  );
  return NextResponse.json({ connections: rows });
}

export async function POST(request: NextRequest) {
  if (!tiktokDirectEnabled()) {
    return NextResponse.json({ error: "TikTok direct integration disabled" }, { status: 503 });
  }
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  let body: { serverId?: string; platformUsername?: string; platformUserId?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const serverId = typeof body.serverId === "string" ? body.serverId.trim() : "";
  const platformUsername = typeof body.platformUsername === "string" ? body.platformUsername.trim() : "";
  const platformUserId = typeof body.platformUserId === "string" ? body.platformUserId.trim() : null;
  if (!isUuidLike(serverId)) return NextResponse.json({ error: "Valid serverId is required" }, { status: 400 });
  if (!platformUsername) return NextResponse.json({ error: "platformUsername is required" }, { status: 400 });
  const { rows: access } = await query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM servers s
     LEFT JOIN server_users su ON su.server_id = s.id
     WHERE s.id = $1::uuid AND (s.owner_id = $2::uuid OR su.user_id = $2::uuid)
     LIMIT 1`,
    [serverId, session.userId]
  );
  if (!access[0]) return NextResponse.json({ error: "No access to this server" }, { status: 403 });

  const { rows } = await query<{ id: string }>(
    `INSERT INTO tiktok_live_connections
      (user_id, server_id, platform_user_id, platform_username, status, updated_at)
     VALUES
      ($1::uuid, $2::uuid, $3, $4, 'active', now())
     ON CONFLICT (user_id, server_id, platform_username)
     DO UPDATE SET platform_user_id = EXCLUDED.platform_user_id, status = 'active', updated_at = now()
     RETURNING id::text`,
    [session.userId, serverId, platformUserId, platformUsername]
  );
  return NextResponse.json({ ok: true, id: rows[0]?.id ?? null });
}
