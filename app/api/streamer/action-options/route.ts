import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { canAccessStreamerDashboard } from "@/lib/streamer-guard";
import { getAvailableActionsForAdmin } from "@/lib/tikfinity";
import { getStreamerWebhookForUser } from "@/lib/streamer-webhooks";
import { getStreamerPolicyForServer } from "@/lib/streamer-action-policy";

export async function GET(request: NextRequest) {
  const session = getSession(request.headers.get("cookie"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await findUserById(session.userId);
  if (!user || !canAccessStreamerDashboard(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let actions = getAvailableActionsForAdmin();
  const hook = await getStreamerWebhookForUser(user.id);
  if (hook) {
    const policy = await getStreamerPolicyForServer(hook.server_id);
    const allow = new Set(policy?.effectiveActions ?? []);
    actions = actions.filter((a) => allow.has(a.action));
  }
  return NextResponse.json({ actions });
}
