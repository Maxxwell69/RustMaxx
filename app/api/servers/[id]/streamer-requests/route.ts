import { NextRequest, NextResponse } from "next/server";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerWithRole, canEditServer } from "@/lib/server-access";
import { audit } from "@/lib/audit";
import {
  listStreamerServerRequestsWithEmails,
  resolveStreamerServerRequest,
} from "@/lib/streamer-server-requests";

function serializeRequest(r: Awaited<ReturnType<typeof listStreamerServerRequestsWithEmails>>[number]) {
  return {
    id: r.id,
    user_id: r.user_id,
    applicant_email: r.applicant_email,
    message: r.message,
    status: r.status,
    reviewed_at: r.reviewed_at instanceof Date ? r.reviewed_at.toISOString() : r.reviewed_at,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  };
}

/** Owner / server admin: list streamer access requests for this server. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;
  const result = await getServerWithRole(serverId, session.userId, session.role);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canEditServer(result.serverRole)) {
    return NextResponse.json({ error: "Only owner or server admin can view requests" }, { status: 403 });
  }

  try {
    const rows = await listStreamerServerRequestsWithEmails(serverId);
    const pending = rows.filter((r) => r.status === "pending").map(serializeRequest);
    const approved = rows.filter((r) => r.status === "approved").map(serializeRequest);
    const rejected = rows.filter((r) => r.status === "rejected").map(serializeRequest);
    return NextResponse.json({ pending, approved, rejected });
  } catch (e) {
    console.error("[streamer-requests] GET failed:", e);
    const msg = e instanceof Error ? e.message : String(e);
    const missingTable =
      msg.includes("streamer_server_requests") ||
      msg.includes("42P01") ||
      msg.toLowerCase().includes("does not exist");
    return NextResponse.json(
      {
        error: missingTable
          ? "Database is missing streamer access tables. Run migration 027_streamer_server_requests.sql on this environment."
          : "Could not load access requests.",
      },
      { status: 503 }
    );
  }
}

/** Owner / server admin: approve or reject a pending request. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;
  const result = await getServerWithRole(serverId, session.userId, session.role);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canEditServer(result.serverRole)) {
    return NextResponse.json({ error: "Only owner or server admin can decide requests" }, { status: 403 });
  }

  let body: { requestId?: string; decision?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  const decision = body.decision === "approve" || body.decision === "reject" ? body.decision : null;
  if (!requestId || !decision) {
    return NextResponse.json(
      { error: "Send requestId (UUID) and decision: \"approve\" | \"reject\"" },
      { status: 400 }
    );
  }

  const resolved = await resolveStreamerServerRequest(requestId, serverId, session.userId, decision);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  await audit(session.userId, "streamer_server_request_decision", {
    serverId,
    requestId,
    decision,
    applicantUserId: resolved.row.user_id,
  });

  const rows = await listStreamerServerRequestsWithEmails(serverId);
  const pending = rows.filter((r) => r.status === "pending").map(serializeRequest);
  const approved = rows.filter((r) => r.status === "approved").map(serializeRequest);
  const rejected = rows.filter((r) => r.status === "rejected").map(serializeRequest);
  return NextResponse.json({ ok: true, pending, approved, rejected });
}
