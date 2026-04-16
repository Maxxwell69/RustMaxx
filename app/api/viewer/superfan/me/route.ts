import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { getViewerSiteApplication, listMembershipsForViewer } from "@/lib/superfan";

export async function GET(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;

  const site = await getViewerSiteApplication(session.userId);
  const streamers = await listMembershipsForViewer(session.userId);

  return NextResponse.json({
    site: site
      ? {
          id: site.id,
          message: site.message,
          status: site.status,
          reviewed_at: site.reviewed_at?.toISOString() ?? null,
          created_at: site.created_at.toISOString(),
          updated_at: site.updated_at.toISOString(),
        }
      : null,
    streamers: streamers.map((m) => ({
      id: m.id,
      streamer_user_id: m.streamer_user_id,
      streamer_display_name: m.streamer_display_name,
      streamer_stream_name: m.streamer_stream_name,
      message: m.message,
      status: m.status,
      reviewed_at: m.reviewed_at?.toISOString() ?? null,
      created_at: m.created_at.toISOString(),
      updated_at: m.updated_at.toISOString(),
    })),
  });
}
