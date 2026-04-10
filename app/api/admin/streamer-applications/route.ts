import { NextRequest, NextResponse } from "next/server";
import { requireCanManageAdmins } from "@/lib/api-auth";
import { listStreamerApplications } from "@/lib/streamer-applications";
import type { StreamerApplicationStatus } from "@/lib/streamer-applications";

function serializeList(
  rows: Awaited<ReturnType<typeof listStreamerApplications>>
) {
  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    applicant_email: row.applicant_email,
    applicant_display_name: row.applicant_display_name,
    legal_name: row.legal_name,
    preferred_stream_name: row.preferred_stream_name,
    tiktok_url: row.tiktok_url,
    twitch_url: row.twitch_url,
    kick_url: row.kick_url,
    youtube_url: row.youtube_url,
    twitter_url: row.twitter_url,
    instagram_url: row.instagram_url,
    discord_username: row.discord_username,
    other_socials: row.other_socials,
    avg_live_viewers: row.avg_live_viewers,
    stream_schedule: row.stream_schedule,
    content_summary: row.content_summary,
    why_rustmaxx: row.why_rustmaxx,
    status: row.status,
    reviewed_at: row.reviewed_at?.toISOString() ?? null,
    admin_notes: row.admin_notes,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  }));
}

/** List streamer applications (admin). Optional ?status=pending|approved|rejected */
export async function GET(request: NextRequest) {
  const authErr = await requireCanManageAdmins(request);
  if (authErr) return authErr;

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("status");
  let status: StreamerApplicationStatus | undefined;
  if (raw === "pending" || raw === "approved" || raw === "rejected") {
    status = raw;
  } else if (raw !== null && raw !== "") {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const rows = await listStreamerApplications(status);
  return NextResponse.json({ applications: serializeList(rows) });
}
