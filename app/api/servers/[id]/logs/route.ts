import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { LogRow } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: serverId } = await params;
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 200, 1), 500);
  const { rows } = await query<LogRow>(
    "SELECT id, server_id, type, message, created_at FROM logs WHERE server_id = $1 ORDER BY created_at DESC LIMIT $2",
    [serverId, limit]
  );
  return NextResponse.json(rows.reverse());
}
