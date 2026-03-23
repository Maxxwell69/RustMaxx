import { NextRequest, NextResponse } from "next/server";
import { requireCanManageServersFromDb } from "@/lib/api-auth";
import { listRnpcSpawnEvents } from "@/lib/rnpc-spawn-events";

const TIKFINITY_SERVER_ID = process.env.TIKFINITY_SERVER_ID?.trim() ?? null;

/**
 * GET: Recent Roaming NPC spawn attempts (TikFinity → npcmaxx.spawn). Admin only.
 */
export async function GET(request: NextRequest) {
  try {
    const authErr = await requireCanManageServersFromDb(request);
    if (authErr) return authErr;

    if (!TIKFINITY_SERVER_ID) {
      return NextResponse.json(
        { error: "TIKFINITY_SERVER_ID is not set", events: [] },
        { status: 200 }
      );
    }

    const limit = Math.min(
      200,
      Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 100)
    );
    let events: Awaited<ReturnType<typeof listRnpcSpawnEvents>> = [];
    try {
      events = await listRnpcSpawnEvents(TIKFINITY_SERVER_ID, limit);
    } catch (e) {
      console.error("[tikfinity/rnpc-spawns] list failed:", e);
    }

    return NextResponse.json({ events, serverId: TIKFINITY_SERVER_ID });
  } catch (e) {
    console.error("[tikfinity/rnpc-spawns] GET failed:", e);
    return NextResponse.json(
      { error: "Failed to load spawn history" },
      { status: 500 }
    );
  }
}
