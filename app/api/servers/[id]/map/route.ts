import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerIfAccessible } from "@/lib/server-access";

type MapRow = {
  name: string;
  seed: number | null;
  world_size: number | null;
  level: string | null;
  map_preview_url: string | null;
  map_last_fetched_at: string | null;
};

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

  const { rows } = await query<MapRow>(
    "SELECT name, seed, world_size, level, map_preview_url, map_last_fetched_at FROM servers WHERE id = $1",
    [serverId]
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    name: row.name,
    seed: row.seed,
    worldSize: row.world_size,
    level: row.level,
    mapPreviewUrl: row.map_preview_url,
    lastFetchedAt: row.map_last_fetched_at,
  });
}
