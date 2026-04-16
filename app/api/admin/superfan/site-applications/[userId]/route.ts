import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireCanManageAdmins } from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { setSiteApplicationDecision } from "@/lib/superfan";

type PatchBody = { decision?: string; admin_notes?: string };

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const authErr = await requireCanManageAdmins(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { userId: applicantUserId } = await params;

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const decision = body.decision;
  if (decision !== "approve" && decision !== "reject") {
    return NextResponse.json({ error: "decision must be approve or reject" }, { status: 400 });
  }
  const adminNotes = typeof body.admin_notes === "string" ? body.admin_notes : null;

  const result = await setSiteApplicationDecision(
    applicantUserId,
    session.userId,
    decision === "approve" ? "approved" : "rejected",
    adminNotes
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await audit(session.userId, "admin.superfan.site_decision", { applicantUserId, decision }).catch(() => {});
  return NextResponse.json({ ok: true });
}
