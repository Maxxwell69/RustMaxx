import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import {
  canAccessStreamerDashboard,
  canUsePerStreamerTikfinityWebhook,
} from "@/lib/streamer-guard";
import { query } from "@/lib/db";
import { createWebhookForServer } from "@/lib/streamer-webhooks";
import { isStreamerAllowedForServerHooks } from "@/lib/streamer-server-allowlist";
import { getPublicSiteOrigin } from "@/lib/public-site-origin";

export async function POST(request: NextRequest) {
  const session = getSession(request.headers.get("cookie"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await findUserById(session.userId);
  if (!user || !canAccessStreamerDashboard(user)) {
    return NextResponse.json(
      { error: "Forbidden: active subscription and streamer access required" },
      { status: 403 }
    );
  }
  if (!(await canUsePerStreamerTikfinityWebhook(user))) {
    return NextResponse.json(
      {
        error:
          "RustMaxx staff must approve your streamer application before you can create TikFinity webhooks.",
      },
      { status: 403 }
    );
  }
  let body: { serverId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const serverId = typeof body.serverId === "string" ? body.serverId.trim() : "";
  if (!serverId) {
    return NextResponse.json({ error: "serverId is required" }, { status: 400 });
  }
  const { rows } = await query<{
    id: string;
    streamer_interactions_enabled: boolean;
  }>(
    "SELECT id, streamer_interactions_enabled FROM servers WHERE id = $1 LIMIT 1",
    [serverId]
  );
  const srv = rows[0];
  if (!srv) {
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }
  if (!srv.streamer_interactions_enabled) {
    return NextResponse.json(
      {
        error:
          "This server does not allow streamer interactions. The owner must enable them under Server setup → Streamer interactions.",
      },
      { status: 400 }
    );
  }

  if (!(await isStreamerAllowedForServerHooks(serverId, user.id))) {
    return NextResponse.json(
      {
        error:
          "You are not allowed to use TikFinity on this server yet. If the owner requires approval, request access from the public server list page, or ask them to add you under Server → Streamer interactions (allowlist / access requests).",
      },
      { status: 403 }
    );
  }

  let row: Awaited<ReturnType<typeof createWebhookForServer>>["row"];
  let secretPlain: string | undefined;
  try {
    const created = await createWebhookForServer(user.id, serverId);
    row = created.row;
    secretPlain = created.secretPlain;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("WEBHOOK_LIMIT:")) {
      return NextResponse.json(
        { error: msg.replace(/^WEBHOOK_LIMIT:\s*/, "") },
        { status: 403 }
      );
    }
    throw e;
  }
  const origin = getPublicSiteOrigin(request);
  const webhookPath = `/api/tikfinity/hooks/${row.hook_key}`;
  const webhookUrl = origin ? `${origin}${webhookPath}` : webhookPath;
  /** Same as webhookUrl — path contains the secret; no ?token= required. */
  const tikFinityUrlWithToken = webhookUrl;

  return NextResponse.json({
    hook: {
      id: row.id,
      publicId: row.public_id,
      serverId: row.server_id,
      webhookUrl,
      tikFinityUrlWithToken,
    },
    /** @deprecated Legacy UUID+token flows; new webhooks use hook_key in path only. */
    webhookSecret: secretPlain,
    created: Boolean(secretPlain),
  });
}
