import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { canAccessStreamerDashboard } from "@/lib/streamer-guard";
import { deleteStreamerRule } from "@/lib/streamer-tikfinity-rules";
import { getStreamerWebhookForUser } from "@/lib/streamer-webhooks";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = getSession(request.headers.get("cookie"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await findUserById(session.userId);
  if (!user || !canAccessStreamerDashboard(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const hook = await getStreamerWebhookForUser(user.id);
  if (!hook) {
    return NextResponse.json({ error: "No webhook" }, { status: 400 });
  }
  const { id } = await context.params;
  const { deleted } = await deleteStreamerRule(id, hook.id);
  if (!deleted) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
