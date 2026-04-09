import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { canAccessStreamerDashboard } from "@/lib/streamer-guard";
import { rotateStreamerWebhookSecret } from "@/lib/streamer-webhooks";

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
  const out = await rotateStreamerWebhookSecret(user.id);
  if (!out) {
    return NextResponse.json(
      { error: "Create a webhook first (choose a server)." },
      { status: 400 }
    );
  }
  return NextResponse.json({ webhookSecret: out.secretPlain });
}
