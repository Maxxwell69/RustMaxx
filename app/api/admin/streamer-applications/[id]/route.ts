import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireCanManageAdmins } from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { setStreamerApplicationDecision } from "@/lib/streamer-applications";

type PatchBody = {
  decision?: string;
  admin_notes?: string;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireCanManageAdmins(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id } = await params;

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

  const admin_notes =
    typeof body.admin_notes === "string" ? body.admin_notes : null;

  const result = await setStreamerApplicationDecision(
    id,
    session.userId,
    decision,
    admin_notes
  );

  if (!result.ok) {
    const status = result.error === "Application not found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  const row = result.row;
  await audit(session.userId, "streamer_application_decision", {
    application_id: id,
    decision,
    applicant_user_id: row.user_id,
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    application: {
      id: row.id,
      user_id: row.user_id,
      status: row.status,
      reviewed_at: row.reviewed_at?.toISOString() ?? null,
      admin_notes: row.admin_notes,
    },
  });
}
