import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { findUserById } from "@/lib/users";
import { canAccessStreamerDashboard } from "@/lib/streamer-guard";
import { listApprovedFanClubMembers, userIsApprovedStreamer } from "@/lib/superfan";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const user = await findUserById(session.userId);
  if (!user || !canAccessStreamerDashboard(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await userIsApprovedStreamer(session.userId))) {
    return NextResponse.json({ error: "Approved streamer required" }, { status: 403 });
  }

  const members = await listApprovedFanClubMembers(session.userId);
  return NextResponse.json({
    members: members.map((m) => ({
      id: m.id,
      viewer_user_id: m.viewer_user_id,
      viewer_email: m.viewer_email,
      viewer_display_name: m.viewer_display_name,
      club_tier: m.club_tier,
      created_at: m.created_at.toISOString(),
    })),
  });
}
