import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { ServerRow } from "@/lib/db";
import { fetchRustMapInfo } from "@/lib/rust-map-rcon";
import { buildMapPreviewUrl } from "@/lib/map-preview-url";

const CRON_SECRET = process.env.CRON_SECRET ?? process.env.MAP_REFRESH_SECRET;
const ENABLED = process.env.MAP_REFRESH_ENABLED !== "false";

/**
 * POST /api/internal/refresh-maps
 * Refreshes map info (seed, world size, level) for all servers that have RCON configured.
 * Call from a cron job every MAP_REFRESH_INTERVAL_HOURS (default 6).
 * Requires Authorization: Bearer <CRON_SECRET> or x-cron-secret header.
 * Does not crash if a server is offline; logs and continues.
 */
export async function POST(request: NextRequest) {
  if (!ENABLED) {
    return NextResponse.json({ ok: false, error: "Map refresh is disabled" }, { status: 403 });
  }
  const authHeader = request.headers.get("authorization");
  const secretHeader = request.headers.get("x-cron-secret");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : secretHeader ?? "";
  if (CRON_SECRET && token !== CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { rows: servers } = await query<ServerRow>(
    "SELECT id, name, rcon_host, rcon_port, rcon_password, map_preview_url FROM servers WHERE rcon_host IS NOT NULL AND rcon_port IS NOT NULL AND rcon_password IS NOT NULL"
  );

  const results: { id: string; name: string; ok: boolean; error?: string }[] = [];

  for (const server of servers) {
    try {
      const { ok, error, data } = await fetchRustMapInfo(server.id, server as ServerRow);
      if (!ok) {
        results.push({ id: server.id, name: server.name, ok: false, error: error ?? "Unknown" });
        continue;
      }
      const seed = data?.seed ?? null;
      const worldSize = data?.worldSize ?? null;
      const level = data?.level ?? null;
      const mapPreviewUrl =
        buildMapPreviewUrl(seed, worldSize, level) ?? server.map_preview_url ?? null;
      await query(
        "UPDATE servers SET seed = $1, world_size = $2, level = $3, map_preview_url = COALESCE($4, map_preview_url), map_last_fetched_at = now() WHERE id = $5",
        [seed, worldSize, level, mapPreviewUrl, server.id]
      );
      results.push({ id: server.id, name: server.name, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ id: server.id, name: server.name, ok: false, error: message });
    }
  }

  return NextResponse.json({ ok: true, results });
}
