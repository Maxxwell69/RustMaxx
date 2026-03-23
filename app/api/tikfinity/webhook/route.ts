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
  extractViewerNameFromWebhookBody,
  type TikTriggerAction,
} from "@/lib/tikfinity";
import {
  getConnectionByEventName,
  parseNpcTemplateKey,
} from "@/lib/tikfinity-connections";
import { ensureConnection, sendCommand } from "@/lib/rcon-manager";
import { audit } from "@/lib/audit";
import { insertRnpcSpawnEvent } from "@/lib/rnpc-spawn-events";
import {
  extractTikTokUniqueIdFromBody,
  isCrewSubscriberFromBody,
  isStreamJoinEvent,
} from "@/lib/tikfinity-crew";
import {
  registerCrewRnpcIfNew,
  isCrewRegistered,
} from "@/lib/crew-rnpc-registrations";
import { npcmaxxRconSpawn } from "@/lib/npcmaxx-rcon";

const TIKFINITY_SERVER_ID = process.env.TIKFINITY_SERVER_ID?.trim() ?? null;

const CREW_RNPC_TEMPLATE_KEY = process.env.CREW_RNPC_TEMPLATE_KEY?.trim() ?? null;
const NPCMAXX_REQUIRE_CREW_REGISTRY =
  process.env.NPCMAXX_REQUIRE_CREW_REGISTRY === "true" ||
  process.env.NPCMAXX_REQUIRE_CREW_REGISTRY === "1";

/** CORS: allow TikFinity's site to call this webhook from the browser. */
const TIKFINITY_ORIGIN = "https://tikfinity.zerody.one";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": TIKFINITY_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function withCors(response: NextResponse): NextResponse {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

/**
 * Crew (subscriber) + stream join → register viewer once per TikTok id (no duplicate rows).
 * Uses dedicated webhook URL e.g. ?event=join or body event/type "join".
 */
async function handleCrewRnpcJoin(
  request: NextRequest,
  body: unknown
): Promise<NextResponse | null> {
  if (!isStreamJoinEvent(request, body)) return null;

  if (!TIKFINITY_SERVER_ID) {
    console.error("[tikfinity webhook] crew join: TIKFINITY_SERVER_ID not set");
    return withCors(
      NextResponse.json(
        {
          ok: false,
          error: "TikFinity integration not configured",
          debug: "Set TIKFINITY_SERVER_ID in .env.",
          step: "TIKFINITY_SERVER_ID",
        },
        { status: 503 }
      )
    );
  }

  if (!isCrewSubscriberFromBody(body)) {
    audit("tikfinity", "crew_rnpc.skipped", { reason: "not_crew_subscriber" }).catch(() => {});
    return withCors(
      NextResponse.json({
        ok: true,
        skipped: true,
        reason: "not_crew_subscriber",
        debug:
          "Join received but payload had no crew/subscriber flags. Configure TikFinity to include team/subscriber fields, or use a join trigger that sends them.",
      })
    );
  }

  const uniqueId = extractTikTokUniqueIdFromBody(body);
  const displayName = extractViewerNameFromWebhookBody(body) ?? "Viewer";
  if (!uniqueId) {
    audit("tikfinity", "crew_rnpc.skipped", { reason: "missing_tiktok_unique_id" }).catch(() => {});
    return withCors(
      NextResponse.json({
        ok: false,
        skipped: true,
        reason: "missing_tiktok_unique_id",
        debug:
          "Need a stable TikTok viewer id (e.g. uniqueId) in the webhook body to avoid duplicates. Check TikFinity payload or Raw JSON.",
      })
    );
  }

  const outcome = await registerCrewRnpcIfNew({
    serverId: TIKFINITY_SERVER_ID,
    tiktokUniqueId: uniqueId,
    displayName,
  });

  if (outcome === "duplicate") {
    audit("tikfinity", "crew_rnpc.duplicate", {
      tiktokUniqueId: uniqueId,
      displayName,
    }).catch(() => {});
    return withCors(
      NextResponse.json({
        ok: true,
        alreadyRegistered: true,
        tiktokUniqueId: uniqueId,
        displayName,
        debug: "Viewer was already registered; no second registration.",
      })
    );
  }

  audit("tikfinity", "crew_rnpc.registered", {
    tiktokUniqueId: uniqueId,
    displayName,
    serverId: TIKFINITY_SERVER_ID,
  }).catch(() => {});

  let npcSpawn:
    | { ok: true; command: string }
    | { ok: false; command: string; error: string; step: string }
    | undefined;
  const parsedCrewTemplate = CREW_RNPC_TEMPLATE_KEY
    ? parseNpcTemplateKey(CREW_RNPC_TEMPLATE_KEY)
    : null;
  if (parsedCrewTemplate) {
    const { rows: srvRows } = await query<ServerRow>(
      "SELECT id, name, rcon_host, rcon_port, rcon_password FROM servers WHERE id = $1",
      [TIKFINITY_SERVER_ID]
    );
    const srv = srvRows[0];
    if (srv) {
      const spawn = await npcmaxxRconSpawn({
        server: srv,
        templateKey: parsedCrewTemplate,
        viewerDisplayName: displayName,
        connectionId: null,
        tikfinityEventName: "join",
      });
      if (spawn.ok) {
        npcSpawn = { ok: true, command: spawn.command };
        audit("tikfinity", "crew_rnpc.npc_spawn", {
          tiktokUniqueId: uniqueId,
          displayName,
          command: spawn.command,
          serverId: TIKFINITY_SERVER_ID,
        }).catch(() => {});
      } else {
        npcSpawn = {
          ok: false,
          command: spawn.command,
          error: spawn.error,
          step: spawn.step,
        };
        audit("tikfinity", "crew_rnpc.npc_spawn_failed", {
          tiktokUniqueId: uniqueId,
          error: spawn.error,
          step: spawn.step,
        }).catch(() => {});
      }
    }
  }

  return withCors(
    NextResponse.json({
      ok: true,
      registered: true,
      tiktokUniqueId: uniqueId,
      displayName,
      ...(npcSpawn ? { npcSpawn } : {}),
    })
  );
}

/** Preflight: browser sends this before POST when calling from another origin. */
export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

/** Sanitize for RCON: no spaces (plugin expects three space-separated args). */
function sanitizeArg(s: string, maxLen = 48): string {
  return s.replace(/\s+/g, "_").slice(0, maxLen) || "Viewer";
}

/** GET: same as POST but with empty body (action from ?action= e.g. ?action=scientist). Lets you test from browser or TikFinity GET. */
export async function GET(request: NextRequest) {
  return runWebhook(request, {});
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
  return runWebhook(request, body);
}

async function runWebhook(request: NextRequest, body: unknown) {

  const viewerFromBody = () => extractViewerNameFromWebhookBody(body) ?? "Viewer";

  const crewJoinResponse = await handleCrewRnpcJoin(request, body);
  if (crewJoinResponse) return crewJoinResponse;

  // Action from URL query (e.g. ?action=likes) – one webhook URL per TikFinity action
  const queryAction = request.nextUrl.searchParams.get("action")?.trim().toLowerCase();
  const actionFromQuery = queryAction ? getActionFromPayload({ action: queryAction }) : null;
  const templateFromQuery = request.nextUrl.searchParams.get("template")?.trim() ?? null;

  let payload = normalizeWebhookPayload(body);
  let action: TikTriggerAction | null = null;
  let tikfinityEventNameForLog: string | null = null;

  if (payload) {
    action = getActionForGift(payload.giftName);
  }
  if (!action && actionFromQuery) {
    action = actionFromQuery;
    payload = { viewerName: viewerFromBody(), giftName: actionFromQuery };
  }
  if (!action) {
    const directAction = getActionFromPayload(body);
    if (directAction) {
      action = directAction;
      payload = { viewerName: viewerFromBody(), giftName: directAction };
    }
  }
  let connectionFromAdmin: Awaited<ReturnType<typeof getConnectionByEventName>> = null;
  if (!action) {
    const rawName = getRawActionNameFromPayload(body);
    if (rawName) {
      connectionFromAdmin = await getConnectionByEventName(rawName);
      if (connectionFromAdmin) {
        tikfinityEventNameForLog = rawName;
        action = connectionFromAdmin.server_action;
        payload = { viewerName: viewerFromBody(), giftName: connectionFromAdmin.server_action };
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
    payload = { viewerName: viewerFromBody(), giftName: action };
  }

  if (!TIKFINITY_SERVER_ID) {
    console.error("[tikfinity webhook] TIKFINITY_SERVER_ID not set");
    return withCors(
      NextResponse.json(
        {
          ok: false,
          error: "TikFinity integration not configured",
          debug: "Set TIKFINITY_SERVER_ID in .env to your Rust server's UUID (from the dashboard).",
          step: "TIKFINITY_SERVER_ID",
        },
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
        {
          ok: false,
          error: "TikFinity server not found",
          debug: "TIKFINITY_SERVER_ID does not match any server in the dashboard. Use the server's UUID.",
          step: "server_not_found",
          serverId: TIKFINITY_SERVER_ID,
        },
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
  // 1 scrap per TikTok coin / like count from payload (or admin connection default). No minimum when value is 0.
  const rawNum =
    typeof rawValue === "number" && Number.isFinite(rawValue)
      ? Math.trunc(rawValue)
      : Number.parseInt(String(rawValue), 10);
  const giftValue = Math.min(10000, Math.max(0, Number.isFinite(rawNum) ? rawNum : 0));
  const messageArg =
    connectionFromAdmin?.message?.trim() != null && connectionFromAdmin.message.trim() !== ""
      ? sanitizeArg(connectionFromAdmin.message.trim(), 128)
      : null;

  if (action === "npcmaxx") {
    const npcTemplateKeyResolved =
      parseNpcTemplateKey(connectionFromAdmin?.npc_template_key ?? undefined) ??
      parseNpcTemplateKey(templateFromQuery);
    if (!npcTemplateKeyResolved) {
      const reason =
        "Roaming NPC requires a template key: set it on the TikFinity connection, or use ?action=npcmaxx&template=your_template_key in the webhook URL.";
      console.warn("[tikfinity webhook] npcmaxx missing template");
      audit("tikfinity", "webhook.skipped", {
        reason,
        action,
        serverId: server.id,
      }).catch(() => {});
      await insertRnpcSpawnEvent({
        serverId: server.id,
        connectionId: connectionFromAdmin?.id ?? null,
        tikfinityEventName: tikfinityEventNameForLog,
        viewerName: payload.viewerName,
        templateKey: "(none)",
        command: "npcmaxx.spawn",
        status: "failed",
        errorMessage: reason,
      }).catch(() => {});
      return withCors(
        NextResponse.json(
          {
            ok: false,
            skipped: true,
            reason,
            action: "npcmaxx" as TikTriggerAction,
            debug:
              "In admin → Streamer interactions, add a connection with server action “Roaming NPC (viewer bot)” and set the Roaming template key. Or append &template=your_key to the webhook URL.",
          },
          { status: 200 }
        )
      );
    }

    if (NPCMAXX_REQUIRE_CREW_REGISTRY) {
      const uid = extractTikTokUniqueIdFromBody(body);
      if (!uid) {
        audit("tikfinity", "webhook.skipped", {
          reason: "npcmaxx_requires_tiktok_id_for_crew_gate",
          action,
          serverId: server.id,
        }).catch(() => {});
        return withCors(
          NextResponse.json({
            ok: false,
            skipped: true,
            reason: "missing_tiktok_unique_id",
            action: "npcmaxx" as TikTriggerAction,
            debug:
              "NPCMAXX_REQUIRE_CREW_REGISTRY is on: include userId/uniqueId in the webhook body so we can verify the viewer is in the crew registry.",
          })
        );
      }
      const allowed = await isCrewRegistered(server.id, uid);
      if (!allowed) {
        audit("tikfinity", "webhook.skipped", {
          reason: "not_in_crew_registry",
          action,
          serverId: server.id,
          tiktokUniqueId: uid,
        }).catch(() => {});
        return withCors(
          NextResponse.json({
            ok: false,
            skipped: true,
            reason: "not_in_crew_registry",
            action: "npcmaxx" as TikTriggerAction,
            debug:
              "Viewer is not in the crew RNPC registry. They must hit the ?event=join webhook as a subscriber first, or you can turn off NPCMAXX_REQUIRE_CREW_REGISTRY.",
          })
        );
      }
    }

    const spawn = await npcmaxxRconSpawn({
      server,
      templateKey: npcTemplateKeyResolved,
      viewerDisplayName: payload.viewerName,
      connectionId: connectionFromAdmin?.id ?? null,
      tikfinityEventName: tikfinityEventNameForLog,
    });

    if (!spawn.ok) {
      console.error("[tikfinity webhook] npcmaxx RCON failed:", spawn.error);
      audit("tikfinity", "webhook.failed", {
        reason: spawn.step === "rcon_connect" ? "RCON connect failed" : "RCON send failed",
        error: spawn.error,
        viewerName: payload.viewerName,
        giftName: payload.giftName,
        action,
        serverId: server.id,
        command: spawn.command,
      }).catch(() => {});
      return withCors(
        NextResponse.json(
          {
            ok: false,
            error: spawn.error ?? "Command send failed",
            debug:
              spawn.step === "rcon_connect"
                ? connectedErrorDebug()
                : "RCON connected but npcmaxx.spawn failed. Check NPCMaxx + RoamingNPCs and template key.",
            step: spawn.step,
            command: spawn.command,
          },
          { status: 502 }
        )
      );
    }

    console.log("[tikfinity webhook] OK", { action, command: spawn.command, serverId: server.id });
    audit("tikfinity", "webhook.trigger", {
      viewerName: payload.viewerName,
      giftName: payload.giftName,
      action,
      serverId: server.id,
      command: spawn.command,
    }).catch(() => {});

    return withCors(
      NextResponse.json({
        ok: true,
        action: "npcmaxx" as TikTriggerAction,
        viewerName: payload.viewerName,
        giftName: payload.giftName,
        command: spawn.command,
        debug:
          "npcmaxx.spawn sent. If the bot did not appear: check RoamingNPCs template exists and Enable, and server console for [NPCMaxx].",
      })
    );
  }

  const command =
    messageArg != null
      ? `rustchaos ${action} ${viewerArg} ${giftArg} ${giftValue} ${messageArg}`
      : `rustchaos ${action} ${viewerArg} ${giftArg} ${giftValue}`;

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
        {
          ok: false,
          error: "Could not connect to game server",
          debug: connectedErrorDebug(),
          step: "rcon_connect",
          command: command,
        },
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
        {
          ok: false,
          error: result.error ?? "Command send failed",
          debug: "RCON connected but run failed. Check server has RustChaos plugin loaded.",
          step: "rcon_send",
          command,
        },
        { status: 502 }
      )
    );
  }

  console.log("[tikfinity webhook] OK", { action, command, serverId: server.id });
  audit("tikfinity", "webhook.trigger", {
    viewerName: payload.viewerName,
    giftName: payload.giftName,
    action,
    serverId: server.id,
    command,
    scrapAmount: giftValue ? giftValue : undefined,
  }).catch(() => {});

  return withCors(
    NextResponse.json({
      ok: true,
      action: action as TikTriggerAction,
      viewerName: payload.viewerName,
      giftName: payload.giftName,
      command,
      scrapAmount: giftValue > 0 ? giftValue : undefined,
      debug: "Command sent. If scientist did not spawn: streamer must be online, plugin config StreamerName must match in-game name, and check server console for [RustChaos].",
    })
  );
}

function connectedErrorDebug(): string {
  return "Check RCON: in dashboard set the server's RCON host (IP), port (often 28082 for WebRcon), and password.";
}
