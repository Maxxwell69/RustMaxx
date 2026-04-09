import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { canAccessStreamerDashboard } from "@/lib/streamer-guard";
import { query } from "@/lib/db";
import { createWebhookForServer } from "@/lib/streamer-webhooks";

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

  const { row, secretPlain } = await createWebhookForServer(user.id, serverId);
  const base = (process.env.APP_URL ?? process.env.SITE_URL ?? "").replace(/\/$/, "");

  return NextResponse.json({
    hook: {
      id: row.id,
      publicId: row.public_id,
      serverId: row.server_id,
      webhookUrl: base
        ? `${base}/api/tikfinity/hooks/${row.public_id}`
        : `/api/tikfinity/hooks/${row.public_id}`,
    },
    /** Only when a new server webhook was created — use ?token= in TikFinity. */
    webhookSecret: secretPlain,
    created: Boolean(secretPlain),
  });
}
