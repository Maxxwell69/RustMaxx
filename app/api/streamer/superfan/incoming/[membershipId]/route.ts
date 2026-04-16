import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { setMembershipDecision, userIsApprovedStreamer } from "@/lib/superfan";

type PatchBody = { decision?: string };

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ membershipId: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { membershipId } = await params;

  const isStreamer = await userIsApprovedStreamer(session.userId);
  if (!isStreamer) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const d = body.decision;
  if (d !== "approve" && d !== "reject") {
    return NextResponse.json({ error: 'decision must be "approve" or "reject"' }, { status: 400 });
  }

  const result = await setMembershipDecision(
    membershipId,
    session.userId,
    d === "approve" ? "approved" : "rejected",
    session.userId
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await audit(session.userId, "streamer.superfan.decision", { membershipId, decision: d }).catch(() => {});
  return NextResponse.json({ ok: true });
}
