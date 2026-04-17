import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { revokeFanClubMembership } from "@/lib/superfan";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;

  let body: { streamer_id?: unknown; membership_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const streamerId = typeof body.streamer_id === "string" ? body.streamer_id.trim() : "";
  const membershipId = typeof body.membership_id === "string" ? body.membership_id.trim() : "";
  if (!streamerId || !membershipId) {
    return NextResponse.json({ error: "streamer_id and membership_id are required" }, { status: 400 });
  }

  const r = await revokeFanClubMembership({
    membershipId,
    streamerUserId: streamerId,
    actorUserId: session.userId,
    actorIsStreamer: false,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 400 });
  }

  await audit(session.userId, "viewer.fan_club.mod_revoke", { streamerId, membershipId }).catch(() => {});
  return NextResponse.json({ ok: true });
}
