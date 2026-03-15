import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { ServerRow } from "@/lib/db";
import {
  normalizeWebhookPayload,
  getActionForGift,
  type TikTriggerAction,
} from "@/lib/tikfinity";
import { ensureConnection, sendCommand } from "@/lib/rcon-manager";

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

  const payload = normalizeWebhookPayload(body);
  if (!payload) {
    return NextResponse.json(
      { error: "Missing gift name (giftName, gift_name, or gift)" },
      { status: 400 }
    );
  }

  const action = getActionForGift(payload.giftName);
  if (!action) {
    return NextResponse.json(
      { ok: false, skipped: true, reason: "Gift not mapped to an action" },
      { status: 200 }
    );
  }

  if (!TIKFINITY_SERVER_ID) {
    console.error("[tikfinity webhook] TIKFINITY_SERVER_ID not set");
    return NextResponse.json(
      { error: "TikFinity integration not configured" },
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
      { error: "TikFinity server not found" },
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
    return NextResponse.json(
      { error: "Could not connect to game server" },
      { status: 502 }
    );
  }

  const result = sendCommand(server.id, command);
  if (!result.ok) {
    console.error("[tikfinity webhook] RCON send failed:", result.error);
    return NextResponse.json(
      { error: result.error ?? "Command send failed" },
      { status: 502 }
    );
  }

  console.log("[tikfinity webhook]", payload.viewerName, action, payload.giftName);
  return NextResponse.json({
    ok: true,
    action: action as TikTriggerAction,
    viewerName: payload.viewerName,
    giftName: payload.giftName,
    command,
  });
}
