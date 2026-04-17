import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { getFanClubMembership, isApprovedSuperfanForStreamer } from "@/lib/superfan";

/** Query: ?streamer_id=uuid — fan club access + tier for interaction / boards. */
export async function GET(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;

  const streamerId = new URL(request.url).searchParams.get("streamer_id")?.trim() ?? "";
  if (!streamerId) {
    return NextResponse.json({ error: "streamer_id is required" }, { status: 400 });
  }

  const allowed = await isApprovedSuperfanForStreamer(session.userId, streamerId);
  const membership = allowed ? await getFanClubMembership(session.userId, streamerId) : null;
  return NextResponse.json({
    allowed,
    club_tier: membership?.club_tier ?? null,
  });
}
