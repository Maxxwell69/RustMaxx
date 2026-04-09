import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { canAccessStreamerDashboard } from "@/lib/streamer-guard";
import { canUseStreamerNetwork } from "@/lib/streamer-entitlement";
import { getStreamerWebhookForUser } from "@/lib/streamer-webhooks";
import { listStreamerRules } from "@/lib/streamer-tikfinity-rules";
import { query } from "@/lib/db";

function appOrigin(): string | null {
  const u = process.env.APP_URL?.trim() ?? process.env.SITE_URL?.trim();
  if (!u) return null;
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const session = getSession(request.headers.get("cookie"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await findUserById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const billingOk = canUseStreamerNetwork({
    role: user.role,
    subscriptionStatus: user.subscription_status,
  });
  const dashboardOk = canAccessStreamerDashboard(user);
  const hook = await getStreamerWebhookForUser(user.id);
  let serverName: string | null = null;
  if (hook) {
    const { rows } = await query<{ name: string }>(
      "SELECT name FROM servers WHERE id = $1 LIMIT 1",
      [hook.server_id]
    );
    serverName = rows[0]?.name ?? null;
  }
  const rules = hook ? await listStreamerRules(hook.id) : [];
  const origin = appOrigin();
  const webhookUrl =
    origin && hook
      ? `${origin}/api/tikfinity/hooks/${hook.public_id}`
      : null;

  return NextResponse.json({
    user: {
      email: user.email,
      role: user.role,
      steamId: user.steam_id,
      steamLinkedAt: user.steam_linked_at?.toISOString() ?? null,
      subscriptionStatus: user.subscription_status,
      billingOk,
      dashboardOk,
    },
    hook: hook
      ? {
          publicId: hook.public_id,
          serverId: hook.server_id,
          serverName,
          webhookUrl,
        }
      : null,
    rules,
  });
}
