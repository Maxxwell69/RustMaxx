import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { getRecentEventLogs } from "@/lib/twitch-db";

export async function GET(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;

  const session = getSessionFromRequest(request)!;
  const { searchParams } = new URL(request.url);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));
  const all = searchParams.get("all") === "true" && session.role === "super_admin";

  const events = await getRecentEventLogs(limit, all ? undefined : session.userId);
  return NextResponse.json(events);
}
