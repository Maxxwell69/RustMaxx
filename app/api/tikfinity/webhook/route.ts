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
import { ensureConnection, runAndWait, sendCommand } from "@/lib/rcon-manager";
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
import {
  maxxinvadersRconSpawn,
} from "@/lib/maxxinvaders-rcon";
import {
  resolveRoamingWearPipeForOutfit,
} from "@/lib/maxxinvaders-outfit-profiles";
import { resolveMaxxInvadersAnchorSteam } from "@/lib/maxxinvaders-anchor-steam";

const TIKFINITY_SERVER_ID = process.env.TIKFINITY_SERVER_ID?.trim() ?? null;
const TIKFINITY_MAXXINVADERS_ANCHOR_STEAM_ID =
  process.env.TIKFINITY_MAXXINVADERS_ANCHOR_STEAM_ID?.trim() ?? undefined;

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

/** Default RoamingNPCs bot for TikFinity viewer spawns (Streamer Patrol template). Override with ?template= or body.template. */
const DEFAULT_MAXXINVADERS_ROAMING_BOT = "streamer_patrol";

/** Tier / mode / kit / optional roaming template key for MaxxInvaders (query overrides body). */
function parseMaxxInvadersParams(
  request: NextRequest,
  body: unknown
): {
  tier: number;
  mode: string;
  kit: string;
  roamingTemplate: string | null;
  /** Explicit outfit profile or raw pipe from body/query; null = caller uses default. */
  outfit: string | null;
} {
  let tier = 1;
  let mode = "roaming";
  let kit = "-";
  let roamingTemplate: string | null = null;
  let outfit: string | null = null;

  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (typeof o.tier === "number" && Number.isFinite(o.tier)) tier = Math.trunc(o.tier);
    else if (typeof o.tier === "string" && /^\d+$/.test(o.tier.trim()))
      tier = parseInt(o.tier.trim(), 10);
    if (typeof o.mode === "string" && o.mode.trim()) mode = o.mode.trim();
    if (typeof o.kit === "string") kit = o.kit.trim() === "" ? "-" : o.kit.trim();
    if (typeof o.template === "string" && o.template.trim()) roamingTemplate = o.template.trim();
    if (typeof o.roamingTemplate === "string" && o.roamingTemplate.trim())
      roamingTemplate = o.roamingTemplate.trim();
    if (typeof o.outfit === "string" && o.outfit.trim()) outfit = o.outfit.trim();
    else if (typeof o.outfitProfile === "string" && o.outfitProfile.trim())
      outfit = o.outfitProfile.trim();
  }

  const tq = request.nextUrl.searchParams.get("tier")?.trim();
  if (tq && /^\d+$/.test(tq)) tier = parseInt(tq, 10);

  const mq = request.nextUrl.searchParams.get("mode")?.trim();
  if (mq) mode = mq;

  const kq = request.nextUrl.searchParams.get("kit");
  if (kq !== null) kit = kq.trim() === "" ? "-" : kq.trim();

  const tmplQ = request.nextUrl.searchParams.get("template")?.trim();
  if (tmplQ) roamingTemplate = tmplQ;

  const outfitQ = request.nextUrl.searchParams.get("outfit")?.trim();
  if (outfitQ) outfit = outfitQ;

  tier = Math.min(99, Math.max(1, Number.isFinite(tier) ? tier : 1));
  return { tier, mode: mode.toLowerCase(), kit, roamingTemplate, outfit };
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

  // Admin connection (scrap/message/template metadata) by TikFinity event name — load whenever the body names an event,
  // even if ?action= will choose the final command (so chaos URLs still get connection scrap defaults).
  let connectionFromAdmin: Awaited<ReturnType<typeof getConnectionByEventName>> = null;
  let tikfinityEventNameForLog: string | null = null;
  const rawConnectionName = getRawActionNameFromPayload(body);
  if (rawConnectionName) {
    const conn = await getConnectionByEventName(rawConnectionName);
    if (conn) {
      connectionFromAdmin = conn;
      tikfinityEventNameForLog = rawConnectionName;
    }
  }

  let payload = normalizeWebhookPayload(body);
  let action: TikTriggerAction | null = null;

  // Explicit ?action= wins over body giftName — TikFinity often sends a generic gift field that would otherwise override chaos etc.
  if (actionFromQuery) {
    action = actionFromQuery;
    payload = {
      viewerName:
        extractViewerNameFromWebhookBody(body) ?? payload?.viewerName ?? viewerFromBody(),
      giftName: actionFromQuery,
    };
  } else if (payload) {
    action = getActionForGift(payload.giftName);
  }
  if (!action) {
    const directAction = getActionFromPayload(body);
    if (directAction) {
      action = directAction;
      payload = { viewerName: viewerFromBody(), giftName: directAction };
    }
  }
  if (!action && connectionFromAdmin) {
    action = connectionFromAdmin.server_action;
    payload = { viewerName: viewerFromBody(), giftName: connectionFromAdmin.server_action };
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
          debug:
            "Specify the action one of these ways: (1) URL query ?action=bunny1 (or wolf, likes, …), (2) JSON {\"action\":\"bunny1\"}, (3) TikFinity connection name matching the action (Admin → Streamer interactions), (4) chat-style body with message/text containing the command, e.g. {\"message\":\"!bunny1\",\"nickname\":\"Viewer\"}. RustMaxx reads message, text, comment, chatMessage, msg, content, and nested data/event/payload. Test with POST ?action=bunny1 and body {\"viewerName\":\"Test\"}.",
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
    "SELECT id, name, rcon_host, rcon_port, rcon_password, tikfinity_anchor_steam_id FROM servers WHERE id = $1",
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
                ? connectedErrorDebug(server.rcon_host)
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

  const maxxInvadersProfileActions = [
    "maxxinvaders",
    "bunny1npc",
    "gingynpc",
    "eggnpc",
    "vampnpc",
  ] as const;

  if ((maxxInvadersProfileActions as readonly string[]).includes(action)) {
    const viewerNameFromQuery = request.nextUrl.searchParams.get("viewerName")?.trim();
    if (viewerNameFromQuery) {
      payload = { ...payload, viewerName: viewerNameFromQuery };
    }
    const miParams = parseMaxxInvadersParams(request, body);
    const { tier, mode, kit } = miParams;
    const roamingFromExplicit = parseNpcTemplateKey(miParams.roamingTemplate);
    const profileNpcActions = [
      "bunny1npc",
      "gingynpc",
      "eggnpc",
      "vampnpc",
    ] as const;
    const roamingFromConnection =
      connectionFromAdmin?.server_action === "maxxinvaders" ||
      (profileNpcActions as readonly string[]).includes(
        connectionFromAdmin?.server_action ?? ""
      )
        ? parseNpcTemplateKey(connectionFromAdmin?.npc_template_key)
        : null;
    let roamingBotKey =
      roamingFromExplicit ??
      roamingFromConnection ??
      DEFAULT_MAXXINVADERS_ROAMING_BOT;
    if (action === "gingynpc") {
      roamingBotKey = "gingy";
    } else if (action === "eggnpc") {
      roamingBotKey = "egg";
    } else if (action === "vampnpc") {
      roamingBotKey = "vamp";
    }
    // bunny1npc: outfit bunny1 on default template. gingynpc/eggnpc/vampnpc: fixed Roaming preset, no wear pipe.
    const outfitRequest =
      action === "bunny1npc"
        ? "bunny1"
        : action === "gingynpc" || action === "eggnpc" || action === "vampnpc"
          ? "default"
          : miParams.outfit ?? "default";
    const resolvedOutfit = resolveRoamingWearPipeForOutfit(outfitRequest);
    if (!resolvedOutfit.knownProfile && !outfitRequest.includes("|")) {
      console.warn(
        "[tikfinity webhook] unknown maxxinvaders outfit profile:",
        outfitRequest,
        "— using template clothes only"
      );
    }
    const roamingWearPipe = resolvedOutfit.wearPipe;
    const viewerId =
      extractTikTokUniqueIdFromBody(body) ??
      `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const anchorSteam64 = resolveMaxxInvadersAnchorSteam(request, body, {
      serverDefault: server.tikfinity_anchor_steam_id ?? null,
      envFallback: TIKFINITY_MAXXINVADERS_ANCHOR_STEAM_ID,
    });

    if (NPCMAXX_REQUIRE_CREW_REGISTRY) {
      const uid = extractTikTokUniqueIdFromBody(body);
      if (!uid) {
        audit("tikfinity", "webhook.skipped", {
          reason: "maxxinvaders_requires_tiktok_id_for_crew_gate",
          action,
          serverId: server.id,
        }).catch(() => {});
        return withCors(
          NextResponse.json({
            ok: false,
            skipped: true,
            reason: "missing_tiktok_unique_id",
            action: action as TikTriggerAction,
            debug:
              "NPCMAXX_REQUIRE_CREW_REGISTRY is on: include userId/uniqueId in the webhook body for a stable viewer id and crew check.",
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
            action: action as TikTriggerAction,
            debug:
              "Viewer is not in the crew RNPC registry. They must hit the ?event=join webhook as a subscriber first, or turn off NPCMAXX_REQUIRE_CREW_REGISTRY.",
          })
        );
      }
    }

    const spawnMi = await maxxinvadersRconSpawn({
      server,
      viewerDisplayName: payload.viewerName,
      viewerId,
      tier,
      kit,
      mode,
      roamingBotKey,
      anchorSteam64,
      roamingWearPipe,
      connectionId: connectionFromAdmin?.id ?? null,
      tikfinityEventName: tikfinityEventNameForLog,
    });

    if (!spawnMi.ok) {
      console.error("[tikfinity webhook] maxxinvaders RCON failed:", spawnMi.error);
      audit("tikfinity", "webhook.failed", {
        reason:
          spawnMi.step === "rcon_connect"
            ? "RCON connect failed"
            : spawnMi.step === "rcon_reply"
              ? "maxxinvaders.spawn rejected or timeout"
              : "RCON send failed",
        error: spawnMi.error,
        viewerName: payload.viewerName,
        giftName: payload.giftName,
        action,
        serverId: server.id,
        command: spawnMi.command,
      }).catch(() => {});
      const replyHint =
        spawnMi.step === "rcon_reply"
          ? "Game replied via RCON — see rconResponse. Common: spawn_position (no players online → anchor 0,0; join server or use GUI spawn), anchor_offline (set ?anchorSteam= or TIKFINITY_MAXXINVADERS_ANCHOR_STEAM_ID and be online/sleeping), RoamingNPCs template missing/disabled, duplicate_viewer/cooldown, or ScientistFallbackEnabled=false with bridge failure."
          : spawnMi.step === "rcon_connect"
            ? connectedErrorDebug(server.rcon_host)
            : "RCON connected but command could not be sent.";
      return withCors(
        NextResponse.json(
          {
            ok: false,
            error: spawnMi.error ?? "Command send failed",
            debug: replyHint,
            step: spawnMi.step,
            command: spawnMi.command,
            rconResponse: spawnMi.step === "rcon_reply" ? spawnMi.error : undefined,
          },
          { status: 502 }
        )
      );
    }

    console.log("[tikfinity webhook] OK", { action, command: spawnMi.command, serverId: server.id });
    audit("tikfinity", "webhook.trigger", {
      viewerName: payload.viewerName,
      giftName: payload.giftName,
      action,
      serverId: server.id,
      command: spawnMi.command,
    }).catch(() => {});

    return withCors(
      NextResponse.json({
        ok: true,
        action: action as TikTriggerAction,
        spawnEngine: "maxxinvaders",
        viewerName: payload.viewerName,
        giftName: payload.giftName,
        viewerId,
        tier,
        mode,
        kit,
        roamingBotKey,
        outfit: resolvedOutfit.resolvedId,
        outfitProfileKnown: resolvedOutfit.knownProfile,
        roamingWearPipe: roamingWearPipe ?? undefined,
        command: spawnMi.command,
        rconResponse: spawnMi.rconResponse,
        anchorSteam64: anchorSteam64 ?? null,
        debug:
          action === "bunny1npc"
            ? `bunny1npc: profile bunny1 on Roaming template "${roamingBotKey}" (default streamer_patrol). Same spawn path as maxxinvaders; outfit forced to bunny. Add more looks via ?action=maxxinvaders&outfit=… in lib/maxxinvaders-outfit-profiles.ts.`
            : action === "gingynpc" || action === "eggnpc" || action === "vampnpc"
              ? `${action}: fixed Roaming template "${roamingBotKey}" (wear + loadout from RoamingNPCs.json). ?template= and ?outfit= ignored for this action.`
            : roamingWearPipe
              ? `maxxinvaders.spawn with outfit "${resolvedOutfit.resolvedId}" (wear override on template "${roamingBotKey}").`
              : anchorSteam64 != null
                ? "maxxinvaders.spawn used anchor Steam64: spawn ring + RoamingNPCs bridge anchor near that player (must be online or sleeping). Tune MaxxInvaders.json MaxDistanceFromAnchor / MinimumSpawnRadiusFromAnchor to tighten patrol."
                : "maxxinvaders.spawn succeeded with no anchorSteam — set ?anchorSteam=17digit, JSON anchorSteam, or env TIKFINITY_MAXXINVADERS_ANCHOR_STEAM_ID so the bot stays near you (streamer/base owner must be on server or sleeping). Optional ?outfit=bunny1|default|crew or raw pipe shortnames.",
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
            error: connected.error?.trim() || "Could not connect to game server",
            debug: connectedErrorDebug(server.rcon_host),
            step: "rcon_connect",
            command: command,
          },
          { status: 502 }
        )
      );
    }

  let rconResponse = "";
  try {
    rconResponse = (await runAndWait(server.id, command, 15000)).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[tikfinity webhook] RCON run failed:", msg);
    audit("tikfinity", "webhook.failed", {
      reason: "RCON response timeout or error",
      error: msg,
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
          error: msg,
          debug:
            "RCON did not return within 15s or the socket errored. If the server is busy, try again; otherwise check WebRCON and RustChaos console output.",
          step: "rcon_wait",
          command,
        },
        { status: 502 }
      )
    );
  }

  const failed =
    /^FAILED:/i.test(rconResponse) ||
    /^Unknown action:/i.test(rconResponse) ||
    /^Error:/i.test(rconResponse);

  if (failed) {
    console.warn("[tikfinity webhook] RCON reported failure:", rconResponse);
    audit("tikfinity", "webhook.trigger_failed", {
      viewerName: payload.viewerName,
      giftName: payload.giftName,
      action,
      serverId: server.id,
      command,
      rconResponse,
    }).catch(() => {});
    return withCors(
      NextResponse.json({
        ok: false,
        action: action as TikTriggerAction,
        viewerName: payload.viewerName,
        giftName: payload.giftName,
        command,
        scrapAmount: giftValue > 0 ? giftValue : undefined,
        rconResponse,
        debug:
          "Game server rejected the action. Read rconResponse; check RustChaos plugin version, StreamerName in RustChaos.json, and server console [RustChaos].",
      })
    );
  }

  console.log("[tikfinity webhook] OK", { action, command, serverId: server.id, rconResponse });
  audit("tikfinity", "webhook.trigger", {
    viewerName: payload.viewerName,
    giftName: payload.giftName,
    action,
    serverId: server.id,
    command,
    scrapAmount: giftValue ? giftValue : undefined,
    rconResponse,
  }).catch(() => {});

  return withCors(
    NextResponse.json({
      ok: true,
      action: action as TikTriggerAction,
      viewerName: payload.viewerName,
      giftName: payload.giftName,
      command,
      scrapAmount: giftValue > 0 ? giftValue : undefined,
      rconResponse: rconResponse || undefined,
      debug:
        "RCON OK. If an expected effect or NPC did not appear, check streamer online + RustChaos.json StreamerName + server console [RustChaos].",
    })
  );
}

function rconHostLooksUnreachableFromCloud(host: string | null | undefined): boolean {
  const h = (host ?? "").trim().toLowerCase();
  if (!h) return false;
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (/^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

function connectedErrorDebug(rconHost?: string | null): string {
  let msg =
    "Check RCON in RustMaxx → Servers → your server: host must be a public IP or hostname (WebSocket/WebRCON port, often 28082), password must match server rcon.password. Env vars (APP_URL, TIKFINITY_SERVER_ID) do not replace this row.";
  if (rconHostLooksUnreachableFromCloud(rconHost ?? undefined)) {
    msg +=
      " This host looks private or local — RustMaxx runs in the cloud and cannot open WebRCON to 127.0.0.1 or LAN IPs; use your host’s public RCON endpoint, port forwarding, or a tunnel.";
  }
  return msg;
}
