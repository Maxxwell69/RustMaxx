import { NextRequest, NextResponse } from "next/server";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerWithRole, canEditServer } from "@/lib/server-access";
import { audit } from "@/lib/audit";
import {
  kickStreamerFromServer,
  listStreamerServerRequestsWithEmails,
  serializeStreamerServerRequestForApi,
} from "@/lib/streamer-server-requests";

function partitionRequests(rows: Awaited<ReturnType<typeof listStreamerServerRequestsWithEmails>>) {
  return {
    pending: rows.filter((r) => r.status === "pending").map(serializeStreamerServerRequestForApi),
    approved: rows.filter((r) => r.status === "approved").map(serializeStreamerServerRequestForApi),
    rejected: rows.filter((r) => r.status === "rejected").map(serializeStreamerServerRequestForApi),
    removed: rows.filter((r) => r.status === "revoked").map(serializeStreamerServerRequestForApi),
  };
}

/** Owner/admin: remove a streamer from this server (webhook, approved request, allowlist entry). */
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
    return NextResponse.json({ error: "Only owner or server admin can remove streamers" }, { status: 403 });
  }

  let body: { userId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!userId) {
    return NextResponse.json({ error: "userId (UUID) is required" }, { status: 400 });
  }

  const kicked = await kickStreamerFromServer(serverId, userId, session.userId);
  if (!kicked.ok) {
    return NextResponse.json({ error: kicked.error }, { status: 400 });
  }

  await audit(session.userId, "streamer_server_kick", { serverId, targetUserId: userId }).catch(() => {});

  const rows = await listStreamerServerRequestsWithEmails(serverId);
  return NextResponse.json({ ok: true, ...partitionRequests(rows) });
}
