import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { canAccessStreamerDashboard } from "@/lib/streamer-guard";
import { getAvailableActionsForAdmin } from "@/lib/tikfinity";
import { listStreamerWebhooksForUser } from "@/lib/streamer-webhooks";
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

  const url = new URL(request.url);
  const hookId = url.searchParams.get("hookId")?.trim() ?? "";

  let actions = getAvailableActionsForAdmin();

  if (hookId) {
    const hooks = await listStreamerWebhooksForUser(user.id);
    const hook = hooks.find((h) => h.id === hookId);
    if (hook) {
      const policy = await getStreamerPolicyForServer(hook.server_id);
      const allow = new Set(policy?.effectiveActions ?? []);
      actions = actions.filter((a) => allow.has(a.action));
    }
  } else {
    const hooks = await listStreamerWebhooksForUser(user.id);
    if (hooks.length === 0) {
      /* No webhooks yet — show full catalog; rules still need a hook when saved. */
    } else {
      const allow = new Set<string>();
      for (const h of hooks) {
        const policy = await getStreamerPolicyForServer(h.server_id);
        for (const a of policy?.effectiveActions ?? []) {
          allow.add(a);
        }
      }
      actions = actions.filter((a) => allow.has(a.action));
    }
  }

  return NextResponse.json({ actions });
}
