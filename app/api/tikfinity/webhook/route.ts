import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { ServerRow } from "@/lib/db";
import {
  normalizeWebhookPayload,
  getActionForGift,
  getActionFromPayload,
  getPayloadKeysForDebug,
  type TikTriggerAction,
} from "@/lib/tikfinity";
import { ensureConnection, sendCommand } from "@/lib/rcon-manager";
import { audit } from "@/lib/audit";

const TIKFINITY_SERVER_ID = process.env.TIKFINITY_SERVER_ID?.trim() ?? null;

/** Sanitize for RCON: no spaces (plugin expects three space-separated args). */
function sanitizeArg(s: string, maxLen = 48): string {
  return s.replace(/\s+/g, "_").slice(0, maxLen) || "Viewer";
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let payload = normalizeWebhookPayload(body);
  let action: TikTriggerAction | null = null;

  if (payload) {
    action = getActionForGift(payload.giftName);
  } else {
    // TikFinity may send action name directly (e.g. "Trigger all of these actions" = wolf)
    const directAction = getActionFromPayload(body);
    if (directAction) {
      action = directAction;
      payload = { viewerName: "TikFinity", giftName: directAction };
    }
  }

  if (!payload) {
    const keys = getPayloadKeysForDebug(body);
    console.warn("[tikfinity webhook] Could not parse payload. Top-level keys:", keys);
    return NextResponse.json(
      {
        error: "Missing gift name (giftName, gift_name, gift, giftType) or action (action, actionName)",
        debug: keys.length ? `Received top-level keys: ${keys.join(", ")}. If TikFinity uses different names, we can add support.` : "Body was empty or not an object.",
      },
      { status: 400 }
    );
  }

  if (!action) {
    audit("tikfinity", "webhook.skipped", {
      reason: "Gift not mapped",
      viewerName: payload.viewerName,
      giftName: payload.giftName,
    }).catch(() => {});
    return NextResponse.json(
      { ok: false, skipped: true, reason: "Gift not mapped to an action", giftName: payload.giftName },
      { status: 200 }
    );
  }

  if (!TIKFINITY_SERVER_ID) {
    console.error("[tikfinity webhook] TIKFINITY_SERVER_ID not set");
    return NextResponse.json(
      { error: "TikFinity integration not configured", debug: "Set TIKFINITY_SERVER_ID in env." },
      { status: 503 }
    );
  }

  const { rows } = await query<ServerRow>(
    "SELECT id, name, rcon_host, rcon_port, rcon_password FROM servers WHERE id = $1",
    [TIKFINITY_SERVER_ID]
  );
  const server = rows[0];
  if (!server) {
    console.error("[tikfinity webhook] Server not found:", TIKFINITY_SERVER_ID);
    return NextResponse.json(
      { error: "TikFinity server not found", debug: "TIKFINITY_SERVER_ID does not match any server." },
      { status: 503 }
    );
  }

  const viewerArg = sanitizeArg(payload.viewerName);
  const giftArg = sanitizeArg(payload.giftName);
  const command = `tiktrigger ${action} ${viewerArg} ${giftArg}`;

  const connected = await ensureConnection(
    server.id,
    server.rcon_host,
    server.rcon_port,
    server.rcon_password,
    async () => {}
  );
  if (!connected.ok) {
    console.error("[tikfinity webhook] RCON connect failed:", connected.error);
    audit("tikfinity", "webhook.failed", {
      reason: "RCON connect failed",
      error: connected.error,
      viewerName: payload.viewerName,
      giftName: payload.giftName,
      action,
      serverId: server.id,
    }).catch(() => {});
    return NextResponse.json(
      { error: "Could not connect to game server", debug: connected.error ?? "Check RCON host/port/password." },
      { status: 502 }
    );
  }

  const result = sendCommand(server.id, command);
  if (!result.ok) {
    console.error("[tikfinity webhook] RCON send failed:", result.error);
    audit("tikfinity", "webhook.failed", {
      reason: "RCON send failed",
      error: result.error,
      viewerName: payload.viewerName,
      giftName: payload.giftName,
      action,
      serverId: server.id,
      command,
    }).catch(() => {});
    return NextResponse.json(
      { error: result.error ?? "Command send failed", debug: "Connection ok but command failed.", command },
      { status: 502 }
    );
  }

  console.log("[tikfinity webhook]", payload.viewerName, action, payload.giftName);
  audit("tikfinity", "webhook.trigger", {
    viewerName: payload.viewerName,
    giftName: payload.giftName,
    action,
    serverId: server.id,
    command,
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    action: action as TikTriggerAction,
    viewerName: payload.viewerName,
    giftName: payload.giftName,
    command,
  });
}
