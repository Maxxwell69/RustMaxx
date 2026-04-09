import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { canAccessStreamerDashboard } from "@/lib/streamer-guard";
import { query } from "@/lib/db";

/** RustMaxx-managed servers the streamer can target (v1: full catalog). */
export async function GET(request: NextRequest) {
  const session = getSession(request.headers.get("cookie"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await findUserById(session.userId);
  if (!user || !canAccessStreamerDashboard(user)) {
    return NextResponse.json(
      { error: "Forbidden: streamer subscription required" },
      { status: 403 }
    );
  }
  const { rows } = await query<{
    id: string;
    name: string;
    listing_name: string | null;
  }>(
    "SELECT id, name, listing_name FROM servers ORDER BY COALESCE(listing_name, name) ASC"
  );
  return NextResponse.json({ servers: rows });
}
