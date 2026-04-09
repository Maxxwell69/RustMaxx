import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { canAccessStreamerDashboard } from "@/lib/streamer-guard";
import { deleteWebhookForUser } from "@/lib/streamer-webhooks";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ hookId: string }> }
) {
  const session = getSession(_request.headers.get("cookie"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await findUserById(session.userId);
  if (!user || !canAccessStreamerDashboard(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { hookId } = await context.params;
  const id = typeof hookId === "string" ? hookId.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "hookId required" }, { status: 400 });
  }
  const ok = await deleteWebhookForUser(user.id, id);
  if (!ok) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
