import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { canAccessStreamerDashboard } from "@/lib/streamer-guard";
import {
  createStreamerRule,
  listStreamerRules,
} from "@/lib/streamer-tikfinity-rules";
import { getStreamerWebhookForUser } from "@/lib/streamer-webhooks";
import type { TikTriggerAction } from "@/lib/tikfinity";
import { isActionAllowedForStreamerOnServer } from "@/lib/streamer-action-policy";

export async function GET(request: NextRequest) {
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
    return NextResponse.json({ rules: [], needsWebhook: true });
  }
  const rules = await listStreamerRules(hook.id);
  return NextResponse.json({ rules, needsWebhook: false });
}

export async function POST(request: NextRequest) {
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
    return NextResponse.json(
      { error: "Choose a server and save your webhook first." },
      { status: 400 }
    );
  }
  let body: {
    name?: string;
    serverAction?: string;
    message?: string | null;
    scrapAmount?: number;
    npcTemplateKey?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name : "";
  const serverAction = body.serverAction as TikTriggerAction;
  if (!(await isActionAllowedForStreamerOnServer(hook.server_id, serverAction))) {
    return NextResponse.json(
      {
        error:
          "This server does not allow that action for streamers. Ask the owner to enable it under Server setup, or pick another action.",
      },
      { status: 400 }
    );
  }
  const result = await createStreamerRule(hook.id, name, serverAction, {
    message: body.message,
    scrapAmount: body.scrapAmount,
    npcTemplateKey: body.npcTemplateKey,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ id: result.id });
}
