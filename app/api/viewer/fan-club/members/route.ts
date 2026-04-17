import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { getFanClubMembership, listApprovedFanClubMembers } from "@/lib/superfan";

export const runtime = "nodejs";

/** Mods: list approved fan club members for moderation UI. */
export async function GET(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;

  const streamerId = new URL(request.url).searchParams.get("streamer_id")?.trim() ?? "";
  if (!streamerId) {
    return NextResponse.json({ error: "streamer_id is required" }, { status: 400 });
  }

  const self = await getFanClubMembership(session.userId, streamerId);
  if (!self || self.status !== "approved" || self.club_tier !== "mod") {
    return NextResponse.json({ error: "Channel mod access required." }, { status: 403 });
  }

  const members = await listApprovedFanClubMembers(streamerId);
  return NextResponse.json({
    members: members.map((m) => ({
      id: m.id,
      viewer_user_id: m.viewer_user_id,
      viewer_email: m.viewer_email,
      viewer_display_name: m.viewer_display_name,
      club_tier: m.club_tier,
    })),
  });
}
