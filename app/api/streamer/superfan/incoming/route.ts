import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { listIncomingSuperfanRequests, userIsApprovedStreamer } from "@/lib/superfan";

export async function GET(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;

  const isStreamer = await userIsApprovedStreamer(session.userId);
  if (!isStreamer) {
    return NextResponse.json(
      { error: "Only approved streamers can review superfan requests." },
      { status: 403 }
    );
  }

  const rows = await listIncomingSuperfanRequests(session.userId);
  return NextResponse.json({
    requests: rows.map((r) => ({
      id: r.id,
      viewer_user_id: r.viewer_user_id,
      viewer_email: r.viewer_email,
      viewer_display_name: r.viewer_display_name,
      message: r.message,
      status: r.status,
      reviewed_at: r.reviewed_at?.toISOString() ?? null,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    })),
  });
}
