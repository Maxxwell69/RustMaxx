import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { canAccessStreamerDashboard } from "@/lib/streamer-guard";
import {
  createStreamerRule,
  listStreamerRules,
} from "@/lib/streamer-tikfinity-rules";
import { getWebhookByIdForUser } from "@/lib/streamer-webhooks";
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
  const url = new URL(request.url);
  const hookId = url.searchParams.get("hookId")?.trim() ?? "";
  if (!hookId) {
    return NextResponse.json(
      { error: "hookId query required (use dashboard state or pick a webhook)." },
      { status: 400 }
    );
  }
  const hook = await getWebhookByIdForUser(user.id, hookId);
  if (!hook) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
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
  let body: {
    hookId?: string;
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
  const hookId = typeof body.hookId === "string" ? body.hookId.trim() : "";
  if (!hookId) {
    return NextResponse.json(
      { error: "hookId is required (which server’s webhook should get this rule?)." },
      { status: 400 }
    );
  }
  const hook = await getWebhookByIdForUser(user.id, hookId);
  if (!hook) {
    return NextResponse.json(
      { error: "Webhook not found. Add that server under Game server first." },
      { status: 400 }
    );
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
