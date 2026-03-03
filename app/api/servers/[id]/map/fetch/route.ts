import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerWithRole, canEditServer } from "@/lib/server-access";
import { fetchRustMapInfo } from "@/lib/rust-map-rcon";
import { buildMapPreviewUrl } from "@/lib/map-preview-url";
import { audit } from "@/lib/audit";

const RATE_LIMIT_MS = 30_000;
const lastFetchByServerId = new Map<string, number>();

/** POST /api/servers/:id/map/fetch - Fetch map info via RCON, save to DB. Admin only, rate limited. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;
  const result = await getServerWithRole(serverId, session.userId, session.role);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canEditServer(result.serverRole))
    return NextResponse.json({ error: "Only owner or server admin can fetch map" }, { status: 403 });

  const now = Date.now();
  const last = lastFetchByServerId.get(serverId);
  if (last != null && now - last < RATE_LIMIT_MS) {
    return NextResponse.json(
      { error: "Please wait 30 seconds between fetch attempts" },
      { status: 429 }
    );
  }
  lastFetchByServerId.set(serverId, now);

  const { ok, error, data } = await fetchRustMapInfo(serverId, result.server);
  if (!ok) {
    return NextResponse.json(
      { error: error ?? "Failed to fetch map info from server" },
      { status: 502 }
    );
  }

  const seed = data?.seed ?? null;
  const worldSize = data?.worldSize ?? null;
  const level = data?.level ?? null;
  const mapPreviewUrl =
    buildMapPreviewUrl(seed, worldSize, level) ?? result.server.map_preview_url ?? null;

  await query(
    `UPDATE servers SET seed = $1, world_size = $2, level = $3, map_preview_url = $4, map_last_fetched_at = now() WHERE id = $5`,
    [seed, worldSize, level, mapPreviewUrl, serverId]
  );
  await audit(session.userId, "map.fetch", { serverId }).catch(() => {});

  const { rows } = await query<{ map_last_fetched_at: string }>(
    "SELECT map_last_fetched_at FROM servers WHERE id = $1",
    [serverId]
  );

  return NextResponse.json({
    seed,
    worldSize,
    level,
    mapPreviewUrl,
    lastFetchedAt: rows[0]?.map_last_fetched_at ?? new Date().toISOString(),
  });
}
