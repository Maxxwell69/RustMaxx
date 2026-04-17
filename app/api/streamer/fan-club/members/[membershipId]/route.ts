import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { findUserById } from "@/lib/users";
import { canAccessStreamerDashboard } from "@/lib/streamer-guard";
import { parseClubTier, type FanBoardTier } from "@/lib/streamer-fan-board";
import { revokeFanClubMembership, setMemberClubTier, userIsApprovedStreamer } from "@/lib/superfan";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ membershipId: string }> }
) {
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

  const { membershipId } = await params;
  let body: { club_tier?: unknown; revoke?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.revoke === true) {
    const r = await revokeFanClubMembership({
      membershipId,
      streamerUserId: session.userId,
      actorUserId: session.userId,
      actorIsStreamer: true,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    await audit(session.userId, "streamer.fan_club.revoke", { membershipId }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const tier = parseClubTier(body.club_tier);
  if (!tier) {
    return NextResponse.json({ error: "club_tier must be fan, superfan, or mod" }, { status: 400 });
  }

  const r = await setMemberClubTier(session.userId, membershipId, tier as FanBoardTier);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  await audit(session.userId, "streamer.fan_club.tier", { membershipId, club_tier: tier }).catch(() => {});
  return NextResponse.json({ ok: true });
}
