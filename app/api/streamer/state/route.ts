import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { canAccessStreamerDashboard } from "@/lib/streamer-guard";
import { canUseStreamerNetwork } from "@/lib/streamer-entitlement";
import { listStreamerWebhooksForUser } from "@/lib/streamer-webhooks";
import { listStreamerRules } from "@/lib/streamer-tikfinity-rules";
import { query } from "@/lib/db";
import { getEffectiveStreamerItemsForServer } from "@/lib/streamer-item-policy";
import {
  getStreamerWebhookLimit,
  parseStreamerBillingTier,
} from "@/lib/billing-tiers";
import { getPublicSiteOrigin } from "@/lib/public-site-origin";

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
  const origin = getPublicSiteOrigin(request);

  const hooksRows = await listStreamerWebhooksForUser(user.id);
  const streamerTier = parseStreamerBillingTier(user.streamer_tier) ?? "free";
  const streamerWebhookLimit = getStreamerWebhookLimit(streamerTier);

  const hooks: Array<{
    id: string;
    publicId: string;
    serverId: string;
    serverName: string | null;
    webhookUrl: string | null;
    webhookUpdatedAt: string;
  }> = [];

  const rulesOut: Array<{
    id: string;
    hookId: string;
    serverId: string;
    serverName: string | null;
    name: string;
    server_action: string;
    message: string | null;
    scrap_amount: number;
    duration_seconds: number;
    spawn_count: number;
    npc_template_key: string | null;
    created_at: string;
  }> = [];

  const allowedStreamerItemsByServer: Array<{
    serverId: string;
    serverName: string | null;
    items: Awaited<ReturnType<typeof getEffectiveStreamerItemsForServer>>;
  }> = [];

  for (const h of hooksRows) {
    const { rows: sn } = await query<{ name: string }>(
      "SELECT name FROM servers WHERE id = $1 LIMIT 1",
      [h.server_id]
    );
    const serverName = sn[0]?.name ?? null;
    const webhookUrl =
      origin
        ? `${origin}/api/tikfinity/hooks/${h.public_id}`
        : `/api/tikfinity/hooks/${h.public_id}`;
    hooks.push({
      id: h.id,
      publicId: h.public_id,
      serverId: h.server_id,
      serverName,
      webhookUrl,
      webhookUpdatedAt:
        h.updated_at instanceof Date ? h.updated_at.toISOString() : String(h.updated_at),
    });

    const ruleRows = await listStreamerRules(h.id);
    for (const r of ruleRows) {
      rulesOut.push({
        id: r.id,
        hookId: h.id,
        serverId: h.server_id,
        serverName,
        name: r.name,
        server_action: r.server_action,
        message: r.message,
        scrap_amount: r.scrap_amount,
        duration_seconds: r.duration_seconds,
        spawn_count: r.spawn_count,
        npc_template_key: r.npc_template_key,
        created_at:
          r.created_at instanceof Date
            ? r.created_at.toISOString()
            : String(r.created_at),
      });
    }

    const items = await getEffectiveStreamerItemsForServer(h.server_id);
    if (items.length > 0) {
      allowedStreamerItemsByServer.push({
        serverId: h.server_id,
        serverName,
        items,
      });
    }
  }

  rulesOut.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      steamId: user.steam_id,
      steamLinkedAt: user.steam_linked_at?.toISOString() ?? null,
      subscriptionStatus: user.subscription_status,
      billingOk,
      dashboardOk,
      streamerTier,
      streamerWebhookLimit,
      streamerWebhookCount: hooksRows.length,
    },
    hooks,
    rules: rulesOut,
    allowedStreamerItemsByServer,
  });
}
