import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { isApprovedSuperfanForStreamer } from "@/lib/superfan";

/** Query: ?streamer_id=uuid — true if current user may open the superfan interaction page for that streamer. */
export async function GET(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;

  const streamerId = new URL(request.url).searchParams.get("streamer_id")?.trim() ?? "";
  if (!streamerId) {
    return NextResponse.json({ error: "streamer_id is required" }, { status: 400 });
  }

  const allowed = await isApprovedSuperfanForStreamer(session.userId, streamerId);
  return NextResponse.json({ allowed });
}
