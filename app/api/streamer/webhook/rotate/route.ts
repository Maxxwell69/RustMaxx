import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { canAccessStreamerDashboard } from "@/lib/streamer-guard";
import {
  listStreamerWebhooksForUser,
  rotateStreamerWebhookSecret,
} from "@/lib/streamer-webhooks";
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

  let hookId: string | undefined;
  try {
    const body = await request.json();
    hookId = typeof body?.hookId === "string" ? body.hookId.trim() : undefined;
  } catch {
    hookId = undefined;
  }

  const list = await listStreamerWebhooksForUser(user.id);
  if (list.length === 0) {
    return NextResponse.json(
      { error: "Create a webhook first (add a server above)." },
      { status: 400 }
    );
  }

  const targetId = hookId ?? list[0]!.id;
  const out = await rotateStreamerWebhookSecret(user.id, targetId);
  if (!out) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }
  const origin = getPublicSiteOrigin(request);
  const path = `/api/tikfinity/hooks/${out.hookKey}`;
  const webhookUrl = origin ? `${origin}${path}` : path;
  return NextResponse.json({
    webhookSecret: out.secretPlain,
    hookKey: out.hookKey,
    webhookUrl,
    hookId: targetId,
  });
}
