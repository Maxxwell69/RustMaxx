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
  const canAdmin = !(await requireCanManageServersFromDb(request));
  const serverId = request.nextUrl.searchParams.get("serverId")?.trim() ?? "";
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.trunc(limitRaw))) : 100;

  const vals: unknown[] = [session.userId];
  let i = 2;
  let where =
    `WHERE (e.user_id = $1::uuid OR s.owner_id = $1::uuid
            OR EXISTS (SELECT 1 FROM server_users su WHERE su.server_id = e.server_id AND su.user_id = $1::uuid)`;
  if (canAdmin) where += ` OR true`;
  where += `)`;
  if (serverId) {
    if (!isUuidLike(serverId)) return NextResponse.json({ error: "Invalid serverId" }, { status: 400 });
    where += ` AND e.server_id = $${i++}::uuid`;
    vals.push(serverId);
  }
  vals.push(limit);
  const { rows } = await query(
    `SELECT e.id::text, e.server_id::text, s.name AS server_name, e.user_id::text,
            e.event_type, e.event_name, e.viewer_name, e.viewer_unique_id, e.gift_name,
            e.value, e.action_status, e.action_error, e.received_at, e.processed_at
     FROM tiktok_live_events e
     JOIN servers s ON s.id = e.server_id
     ${where}
     ORDER BY e.received_at DESC
     LIMIT $${i}`,
    vals
  );
  return NextResponse.json({ events: rows });
}
