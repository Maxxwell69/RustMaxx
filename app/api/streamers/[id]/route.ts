import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStreamerPublicProfileRow } from "@/lib/streamer-directory";

/**
 * Public streamer profile. Shown if directory_visible, or always to the same logged-in user (preview).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: userId } = await params;
  const row = await getStreamerPublicProfileRow(userId);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const session = getSession(request.headers.get("cookie"));
  const isSelf = session?.userId === userId;
  if (!row.directory_visible && !isSelf) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!row.application_approved && !isSelf) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    profile: {
      id: row.id,
      display_name: row.display_name,
      stream_name: row.stream_name,
      avatar_url: row.avatar_url,
      bio: row.bio,
      directory_visible: row.directory_visible,
      application_approved: row.application_approved,
      is_self: isSelf,
    },
  });
}
