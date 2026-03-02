import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { LogRow } from "@/lib/db";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerIfAccessible } from "@/lib/server-access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;
  const server = await getServerIfAccessible(serverId, session.userId, session.role);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 200, 1), 500);
  const { rows } = await query<LogRow>(
    "SELECT id, server_id, type, message, created_at FROM logs WHERE server_id = $1 ORDER BY created_at DESC LIMIT $2",
    [serverId, limit]
  );
  return NextResponse.json(rows.reverse());
}
