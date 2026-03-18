import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { ServerRow } from "@/lib/db";
import {
  normalizeWebhookPayload,
  getActionForGift,
  getActionFromPayload,
  getRawActionNameFromPayload,
  getPayloadKeysForDebug,
  getGiftValueFromPayload,
  getDefaultGiftValue,
  type TikTriggerAction,
} from "@/lib/tikfinity";
import { getConnectionByEventName } from "@/lib/tikfinity-connections";
import { ensureConnection, sendCommand } from "@/lib/rcon-manager";
import { audit } from "@/lib/audit";

const TIKFINITY_SERVER_ID = process.env.TIKFINITY_SERVER_ID?.trim() ?? null;

/** CORS: allow TikFinity's site to call this webhook from the browser. */
const TIKFINITY_ORIGIN = "https://tikfinity.zerody.one";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": TIKFINITY_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function withCors(response: NextResponse): NextResponse {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

/** Preflight: browser sends this before POST when calling from another origin. */
export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

/** Sanitize for RCON: no spaces (plugin expects three space-separated args). */
function sanitizeArg(s: string, maxLen = 48): string {
  return s.replace(/\s+/g, "_").slice(0, maxLen) || "Viewer";
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    const text = await request.text();
    if (!text || !text.trim()) {
      body = {};
    } else {
      body = JSON.parse(text);
    }
  } catch {
    body = {};
  }

  // Action from URL query (e.g. ?action=likes) – one webhook URL per TikFinity action
  const queryAction = request.nextUrl.searchParams.get("action")?.trim().toLowerCase();
  const actionFromQuery = queryAction ? getActionFromPayload({ action: queryAction }) : null;

  let payload = normalizeWebhookPayload(body);
  let action: TikTriggerAction | null = null;

  if (payload) {
    action = getActionForGift(payload.giftName);
  }
  if (!action && actionFromQuery) {
    action = actionFromQuery;
    payload = { viewerName: "TikFinity", giftName: actionFromQuery };
  }
  if (!action) {
    const directAction = getActionFromPayload(body);
    if (directAction) {
      action = directAction;
      payload = { viewerName: "TikFinity", giftName: directAction };
    }
  }
  let connectionFromAdmin: Awaited<ReturnType<typeof getConnectionByEventName>> = null;
  if (!action) {
    const rawName = getRawActionNameFromPayload(body);
    if (rawName) {
      connectionFromAdmin = await getConnectionByEventName(rawName);
      if (connectionFromAdmin) {
        action = connectionFromAdmin.server_action;
        payload = { viewerName: "TikFinity", giftName: connectionFromAdmin.server_action };
      }
    }
  }

  // No valid action from payload – don't default to wolf; skip and tell them how to specify action
  if (!action) {
    const keys = getPayloadKeysForDebug(body);
    console.warn("[tikfinity webhook] No action. Keys:", keys);
    audit("tikfinity", "webhook.skipped", {
      reason: payload ? "Gift not mapped" : "Empty or unknown payload",
      keys: keys.length ? keys : undefined,
    }).catch(() => {});
    return withCors(
      NextResponse.json(
        {
          ok: false,
          skipped: true,
          reason: payload
            ? "Gift not mapped to an action"
            : "No action specified. TikFinity sent empty/default body.",
          debug: "To test a specific action (e.g. likes, supply, wolf), send a JSON body. Example: {\"action\": \"likes\"} or {\"giftName\": \"Puppy Kisses\"}. If TikFinity cannot set the webhook body, use the RustMaxx admin 'Test trigger' instead.",
          giftName: payload?.giftName,
        },
        { status: 200 }
      )
    );
  }

  if (!payload) {
    payload = { viewerName: "TikFinity", giftName: action };
  }

  if (!TIKFINITY_SERVER_ID) {
    console.error("[tikfinity webhook] TIKFINITY_SERVER_ID not set");
    return withCors(
      NextResponse.json(
        { error: "TikFinity integration not configured", debug: "Set TIKFINITY_SERVER_ID in env." },
        { status: 503 }
      )
    );
  }

  const { rows } = await query<ServerRow>(
    "SELECT id, name, rcon_host, rcon_port, rcon_password FROM servers WHERE id = $1",
    [TIKFINITY_SERVER_ID]
  );
  const server = rows[0];
  if (!server) {
    console.error("[tikfinity webhook] Server not found:", TIKFINITY_SERVER_ID);
    return withCors(
      NextResponse.json(
        { error: "TikFinity server not found", debug: "TIKFINITY_SERVER_ID does not match any server." },
        { status: 503 }
      )
    );
  }

  const viewerArg = sanitizeArg(payload.viewerName);
  const giftArg = sanitizeArg(payload.giftName);
  const scrapFromConnection = connectionFromAdmin?.scrap_amount ?? 0;
  const fromPayload = getGiftValueFromPayload(body);
  const fromDefault = getDefaultGiftValue(payload.giftName);
  const rawValue =
    scrapFromConnection > 0
      ? scrapFromConnection
      : fromPayload > 0
        ? fromPayload
        : fromDefault;
  // Ensure every gift generates at least 1 scrap for the streamer (coins → inventory).
  const giftValue = Math.min(10000, Math.max(1, rawValue));
  const messageArg =
    connectionFromAdmin?.message?.trim() != null && connectionFromAdmin.message.trim() !== ""
      ? sanitizeArg(connectionFromAdmin.message.trim(), 128)
      : null;
  // Always include scrap amount so streamer always receives coins (giftValue is min 1).
  const command =
    messageArg != null
      ? `tiktrigger ${action} ${viewerArg} ${giftArg} ${giftValue} ${messageArg}`
      : `tiktrigger ${action} ${viewerArg} ${giftArg} ${giftValue}`;

  if (giftValue > 0) {
    console.log("[tikfinity webhook] scrap:", giftValue, "fromConnection:", scrapFromConnection, "fromPayload:", fromPayload, "giftName:", payload.giftName);
  }

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
    return withCors(
      NextResponse.json(
        { error: "Could not connect to game server", debug: connected.error ?? "Check RCON host/port/password." },
        { status: 502 }
      )
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
    return withCors(
      NextResponse.json(
        { error: result.error ?? "Command send failed", debug: "Connection ok but command failed.", command },
        { status: 502 }
      )
    );
  }

  console.log("[tikfinity webhook]", payload.viewerName, action, payload.giftName, giftValue > 0 ? `+${giftValue} scrap` : "");
  audit("tikfinity", "webhook.trigger", {
    viewerName: payload.viewerName,
    giftName: payload.giftName,
    action,
    serverId: server.id,
    command,
    scrapAmount: giftValue || undefined,
  }).catch(() => {});

  return withCors(
    NextResponse.json({
      ok: true,
      action: action as TikTriggerAction,
      viewerName: payload.viewerName,
      giftName: payload.giftName,
      command,
      scrapAmount: giftValue > 0 ? giftValue : undefined,
    })
  );
}
