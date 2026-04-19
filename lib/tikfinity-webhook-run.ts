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
  getViewerNameFromQueryString,
  parseTikfinityWebhookBody,
  type TikTriggerAction,
  isTikTokSocialOnlyAction,
  isRustChaosStatusEffectAction,
  parseRustChaosStatusDurationSeconds,
  isRustChaosSoloScrapSpawnAction,
  parseSoloSpawnRepeatCount,
  clampSoloSpawnRepeatCount,
} from "@/lib/tikfinity";
import { parseNpcTemplateKey } from "@/lib/tikfinity-connections";
import { ensureConnection, runAndWait } from "@/lib/rcon-manager";
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
  type MaxxinvadersRconResult,
} from "@/lib/maxxinvaders-rcon";
import {
  resolveRoamingWearPipeForOutfit,
} from "@/lib/maxxinvaders-outfit-profiles";
import { resolveMaxxInvadersAnchorSteam } from "@/lib/maxxinvaders-anchor-steam";
import { fireSquawkAfterTikfinityEvent } from "@/lib/squawk-notify";
import type { TikfinityConnectionForWebhook } from "@/lib/tikfinity-connections";

/** Pluggable TikFinity connection resolver (global admin table or per-streamer rules). */
export type TikfinityWebhookRunContext = {
  serverId: string;
  resolveConnectionByEventName: (
    name: string
  ) => Promise<TikfinityConnectionForWebhook | null>;
  /** Per-streamer hooks: restrict to these action keys (server owner + platform catalog). */
  streamerAllowedActions?: string[] | null;
};
const TIKFINITY_MAXXINVADERS_ANCHOR_STEAM_ID =
  process.env.TIKFINITY_MAXXINVADERS_ANCHOR_STEAM_ID?.trim() ?? undefined;

const CREW_RNPC_TEMPLATE_KEY = process.env.CREW_RNPC_TEMPLATE_KEY?.trim() ?? null;
const NPCMAXX_REQUIRE_CREW_REGISTRY =
  process.env.NPCMAXX_REQUIRE_CREW_REGISTRY === "true" ||
  process.env.NPCMAXX_REQUIRE_CREW_REGISTRY === "1";

export const TIKFINITY_CORS_HEADERS = {
  // Token-protected webhook endpoint: permissive CORS keeps browser-based TikFinity actions flowing.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Rustmaxx-Webhook-Token, X-Requested-With, Accept",
  "Access-Control-Max-Age": "86400",
};

export function withCors(response: NextResponse): NextResponse {
  Object.entries(TIKFINITY_CORS_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

function hasValidAnchorSteam64(v: string | null | undefined): boolean {
  return typeof v === "string" && /^\d{17}$/.test(v.trim());
}

/**
 * Railway/deploy logs: avoid repeating the full MaxxInvaders paragraph on every spawn_position failure.
 * Uses warn for known operational spawn_position; keeps error for RCON/connect issues.
 */
function logMaxxInvadersSpawnFailure(
  route: "maxxinvaders" | "npcmaxx_as_maxxinvaders",
  spawnMi: Extract<MaxxinvadersRconResult, { ok: false }>,
  meta: { serverId: string; anchorSteam64: string | null | undefined }
): void {
  const err = spawnMi.error ?? "";
  const anchored = hasValidAnchorSteam64(meta.anchorSteam64);
  const spawnPos = /spawn_position/i.test(err);
  const hint =
    spawnPos && !anchored
      ? " — set RustMaxx Servers→TikFinity patrol anchor, webhook ?anchorSteam=765…, or oxide DefaultAnchorSteamId /maxxinvaders anchor"
      : spawnPos && anchored
        ? " — anchor Steam must be online/sleeping on map; try open ground or DefaultSpawnRadius/SpawnAttempts in MaxxInvaders.json"
        : "";
  const head = `[tikfinity webhook] ${route} ${spawnMi.step} server=${meta.serverId} anchor=${anchored ? "set" : "MISSING"}`;
  if (spawnPos) {
    console.warn(`${head}${hint}`);
  } else {
    console.error(head, err);
  }
}

/** Overrides generic debug text when MaxxInvaders returns spawn_position (long message floods deploy logs). */
function spawnPositionReplyHint(
  spawnMi: Extract<MaxxinvadersRconResult, { ok: false }>,
  anchorSteam64: string | null | undefined
): string | null {
  if (spawnMi.step !== "rcon_reply" || !/spawn_position/i.test(spawnMi.error ?? "")) {
    return null;
  }
  if (!hasValidAnchorSteam64(anchorSteam64)) {
    return "spawn_position: RustMaxx did not send a 17-digit anchor — set **Servers → TikFinity patrol anchor**, add **?anchorSteam=76561198…** to the webhook URL, or set **DefaultAnchorSteamId** in oxide/config/MaxxInvaders.json (or `/maxxinvaders anchor`). Full plugin text is in rconResponse.";
  }
  return "spawn_position: anchor was sent but the game could not place on navmesh — ensure that Steam user is **online or sleeping** on this map, stand on open ground, or raise **DefaultSpawnRadius** / **SpawnAttempts** and relax **BlockSpawn*** in MaxxInvaders.json. Full plugin text is in rconResponse.";
}

/**
 * Crew (subscriber) + stream join → register viewer once per TikTok id (no duplicate rows).
 * Uses dedicated webhook URL e.g. ?event=join or body event/type "join".
 */
async function handleCrewRnpcJoin(
  request: NextRequest,
  body: unknown,
  crewServerId: string | null
): Promise<NextResponse | null> {
  if (!isStreamJoinEvent(request, body)) return null;

  if (!crewServerId) {
    console.error("[tikfinity webhook] crew join: no server id");
    return withCors(
      NextResponse.json(
        {
          ok: false,
          error: "TikFinity integration not configured",
          debug: "Server id missing for crew join.",
          step: "server_id",
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
    serverId: crewServerId,
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
    serverId: crewServerId,
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
      "SELECT id, name, rcon_host, rcon_port, rcon_password, tikfinity_anchor_steam_id FROM servers WHERE id = $1",
      [crewServerId]
    );
    const srv = srvRows[0];
    if (srv) {
      const spawn = npcmaxxTemplateRequiresMaxxInvadersEngine(parsedCrewTemplate)
        ? await maxxinvadersRconSpawn({
            server: srv,
            viewerDisplayName: displayName,
            viewerId: uniqueId,
            tier: 1,
            kit: "-",
            mode: "roaming",
            roamingBotKey: parsedCrewTemplate,
            anchorSteam64: resolveMaxxInvadersAnchorSteam(request, body, {
              serverDefault: srv.tikfinity_anchor_steam_id ?? null,
              envFallback: TIKFINITY_MAXXINVADERS_ANCHOR_STEAM_ID,
            }),
            roamingWearPipe: null,
            connectionId: null,
            tikfinityEventName: "join",
          })
        : await npcmaxxRconSpawn({
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
          serverId: crewServerId,
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

  fireSquawkAfterTikfinityEvent({
    kind: "crew_join",
    action: "join",
    viewerName: displayName,
    giftName: "crew",
  });

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

/**
 * `npcmaxx.spawn` only hits NPCMaxx — passes anchor Steam `0`, so bridge bots never leash to the streamer.
 * Keys here, plus every `streamer_*` template, must use `maxxinvaders.spawn` while still accepting `?action=npcmaxx&template=…`.
 */
const NPCMAXX_TEMPLATES_REQUIRING_MAXXINVADERS_ENGINE = new Set<string>(["snipemb"]);

function npcmaxxTemplateRequiresMaxxInvadersEngine(templateKey: string): boolean {
  return (
    NPCMAXX_TEMPLATES_REQUIRING_MAXXINVADERS_ENGINE.has(templateKey) ||
    templateKey.startsWith("streamer_")
  );
}

async function trySpawnNpcmaxxTemplateViaMaxxInvadersEngine(
  request: NextRequest,
  body: unknown,
  server: ServerRow,
  connectionFromAdmin: TikfinityConnectionForWebhook | null,
  tikfinityEventNameForLog: string | null,
  payload: { viewerName: string; giftName: string },
  npcTemplateKeyResolved: string,
  tikfinitySpawnActionLabel: TikTriggerAction
): Promise<NextResponse | null> {
  if (!npcmaxxTemplateRequiresMaxxInvadersEngine(npcTemplateKeyResolved)) {
    return null;
  }

  const miParams = parseMaxxInvadersParams(request, body);
  const { tier, mode, kit } = miParams;
  const resolvedOutfit = resolveRoamingWearPipeForOutfit(miParams.outfit ?? "default");
  const roamingWearPipe = resolvedOutfit.wearPipe;
  const roamingBotKey = npcTemplateKeyResolved;

  const viewerId =
    extractTikTokUniqueIdFromBody(body) ??
    `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  const anchorSteam64 = resolveMaxxInvadersAnchorSteam(request, body, {
    serverDefault: server.tikfinity_anchor_steam_id ?? null,
    envFallback: TIKFINITY_MAXXINVADERS_ANCHOR_STEAM_ID,
  });

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
    logMaxxInvadersSpawnFailure("npcmaxx_as_maxxinvaders", spawnMi, {
      serverId: server.id,
      anchorSteam64,
    });
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
      action: tikfinitySpawnActionLabel,
      serverId: server.id,
      command: spawnMi.command,
      templateKey: roamingBotKey,
      route: "npcmaxx_as_maxxinvaders",
    }).catch(() => {});
    let replyHint =
      spawnMi.step === "rcon_reply"
        ? "Game replied via RCON — see rconResponse. Common: spawn_position, anchor_offline, RoamingNPCs template missing/disabled."
        : spawnMi.step === "rcon_connect"
          ? connectedErrorDebug(server.rcon_host)
          : "RCON connected but command could not be sent.";
    const spawnPosHint = spawnPositionReplyHint(spawnMi, anchorSteam64);
    if (spawnPosHint) replyHint = spawnPosHint;
    if (
      spawnMi.step === "rcon_reply" &&
      /roamingnpcs is not loaded/i.test(spawnMi.error ?? "")
    ) {
      replyHint =
        "The Rust server rejected the spawn because the RoamingNPCs Oxide plugin is not loaded. On the host: add RoamingNPCs, run `oxide.reload RoamingNPCs`. See rconResponse for the exact MaxxInvaders line.";
    }
    if (
      spawnMi.step === "rcon_reply" &&
      /no bot key.*under bots settings/i.test(spawnMi.error ?? "")
    ) {
      replyHint =
        "RoamingNPCs.json on the game server must include this template under `Bots settings` with `\"Enable bot?\": true`.";
    }
    return withCors(
      NextResponse.json(
        {
          ok: false,
          error: spawnMi.error ?? "Command send failed",
          debug: replyHint,
          step: spawnMi.step,
          command: spawnMi.command,
          rconResponse: spawnMi.step === "rcon_reply" ? spawnMi.error : undefined,
          route: "npcmaxx_as_maxxinvaders",
        },
        { status: 502 }
      )
    );
  }

  console.log("[tikfinity webhook] OK npcmaxx→MI", {
    command: spawnMi.command,
    serverId: server.id,
    roamingBotKey,
  });
  audit("tikfinity", "webhook.trigger", {
    viewerName: payload.viewerName,
    giftName: payload.giftName,
    action: tikfinitySpawnActionLabel,
    serverId: server.id,
    command: spawnMi.command,
    route: "npcmaxx_as_maxxinvaders",
  }).catch(() => {});

  fireSquawkAfterTikfinityEvent({
    kind: "maxxinvaders",
    action: tikfinitySpawnActionLabel,
    viewerName: payload.viewerName,
    giftName: payload.giftName,
  });

  const nameFallbackViewer =
    String(payload.viewerName ?? "").trim().toLowerCase() === "viewer";

  return withCors(
    NextResponse.json({
      ok: true,
      action: tikfinitySpawnActionLabel,
      spawnEngine: "maxxinvaders",
      routedFrom: "npcmaxx",
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
      ...(nameFallbackViewer
        ? {
            nameHint:
              "RustMaxx did not find a viewer nickname in this webhook payload — the in-game bot may show Viewer. Add %nickname% or ?nickname= in TikFinity.",
          }
        : {}),
      debug: `Roaming template "${roamingBotKey}" is spawned via MaxxInvaders (invader registry). Your webhook can stay ?action=npcmaxx&template=${roamingBotKey}; RustMaxx sends maxxinvaders.spawn. Set ?anchorSteam=765… or env TIKFINITY_MAXXINVADERS_ANCHOR_STEAM_ID so the bot anchors near you.`,
    })
  );
}

export async function runTikfinityWebhook(
  request: NextRequest,
  body: unknown,
  ctx: TikfinityWebhookRunContext
) {
  const viewerFromBody = () => extractViewerNameFromWebhookBody(body) ?? "Viewer";

  const crewJoinResponse = await handleCrewRnpcJoin(request, body, ctx.serverId);
  if (crewJoinResponse) return crewJoinResponse;

  // Action from URL query — TikFinity presets vary:
  // ?action=, ?event=, ?eventName=, ?trigger=, ?giftName=, etc.
  // Prefer explicit action, then giftName/gift (TikTok often sends both a generic event type and a real gift name).
  const q = request.nextUrl.searchParams;
  const queryActionRaw =
    q.get("action")?.trim() ??
    q.get("giftName")?.trim() ??
    q.get("gift")?.trim() ??
    q.get("event")?.trim() ??
    q.get("eventName")?.trim() ??
    q.get("trigger")?.trim() ??
    q.get("command")?.trim() ??
    "";
  let actionFromQuery: TikTriggerAction | null = null;
  if (queryActionRaw) {
    actionFromQuery = getActionFromPayload({ action: queryActionRaw.toLowerCase() });
    if (!actionFromQuery) actionFromQuery = getActionForGift(queryActionRaw);
  }
  const templateFromQuery = request.nextUrl.searchParams.get("template")?.trim() ?? null;

  // Admin connection (scrap/message/template metadata) by TikFinity event name — load whenever the body names an event,
  // even if ?action= will choose the final command (so chaos URLs still get connection scrap defaults).
  let connectionFromAdmin: TikfinityConnectionForWebhook | null = null;
  let tikfinityEventNameForLog: string | null = null;
  const fromBody = getRawActionNameFromPayload(body);
  // URL action/event should drive rule lookup when present (TikFinity test payloads can carry unrelated defaults).
  const rawConnectionName = (queryActionRaw.trim() || fromBody.trim()).trim();
  if (rawConnectionName) {
    const conn = await ctx.resolveConnectionByEventName(rawConnectionName);
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
            "Specify the action one of these ways: (1) URL ?action=wolf or ?event=wolf (same token URL), (2) JSON with action/event at top level or under data/event/payload (e.g. {\"data\":{\"event\":\"wolf\"}}), (3) streamer rule name matching that string, (4) chat fields message/text/…. Test: POST your hook URL with body {\"data\":{\"action\":\"wolf\"},\"nickname\":\"Test\"}.",
          giftName: payload?.giftName,
        },
        { status: 200 }
      )
    );
  }

  if (
    ctx.streamerAllowedActions != null &&
    !(ctx.streamerAllowedActions as string[]).includes(action)
  ) {
    return withCors(
      NextResponse.json(
        {
          ok: false,
          skipped: true,
          reason: "This action is not allowed for streamers on this server.",
          action,
          debug: `Allowed on this server: ${
            ctx.streamerAllowedActions.length
              ? (ctx.streamerAllowedActions as string[]).join(", ")
              : "(none — pick actions in RustMaxx → Servers → Streamer interactions)"
          }`,
        },
        { status: 200 }
      )
    );
  }

  if (!payload) {
    payload = { viewerName: viewerFromBody(), giftName: action };
  }

  {
    const qv = getViewerNameFromQueryString(request.nextUrl.searchParams);
    if (qv && payload) payload = { ...payload, viewerName: qv };
  }

  if (!ctx.serverId) {
    console.error("[tikfinity webhook] server id not set");
    return withCors(
      NextResponse.json(
        {
          ok: false,
          error: "TikFinity integration not configured",
          debug: "Server id missing for this webhook.",
          step: "server_id",
        },
        { status: 503 }
      )
    );
  }

  const { rows } = await query<ServerRow>(
    "SELECT id, name, rcon_host, rcon_port, rcon_password, tikfinity_anchor_steam_id FROM servers WHERE id = $1",
    [ctx.serverId]
  );
  const server = rows[0];
  if (!server) {
    console.error("[tikfinity webhook] Server not found:", ctx.serverId);
    return withCors(
      NextResponse.json(
        {
          ok: false,
          error: "TikFinity server not found",
          debug: "This webhook's server id does not match any server in the dashboard.",
          step: "server_not_found",
          serverId: ctx.serverId,
        },
        { status: 503 }
      )
    );
  }

  /** TikTok follow / share / sub / stream-like — Squawk only; no RCON. */
  if (isTikTokSocialOnlyAction(action)) {
    fireSquawkAfterTikfinityEvent({
      kind: "social",
      action,
      viewerName: payload.viewerName,
      giftName: action,
    });
    audit("tikfinity", "webhook.social", {
      viewerName: payload.viewerName,
      action,
      serverId: server.id,
    }).catch(() => {});
    console.log("[tikfinity webhook] social announce", { action, viewer: payload.viewerName });
    return withCors(
      NextResponse.json({
        ok: true,
        action: action as TikTriggerAction,
        mode: "social_announce",
        viewerName: payload.viewerName,
        giftName: payload.giftName,
        debug:
          "No game command. Set SQUAWK_WEBHOOK_URL for TTS. This is separate from gift **likes** (action=likes → RustChaos airdrop).",
      })
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
  let giftValue = Math.min(10000, Math.max(0, Number.isFinite(rawNum) ? rawNum : 0));
  if (isRustChaosSoloScrapSpawnAction(action)) {
    giftValue = giftValue > 0 ? Math.min(giftValue, 10) : 10;
  }
  const ruleDefaultDuration =
    connectionFromAdmin != null &&
    isRustChaosStatusEffectAction(action) &&
    typeof connectionFromAdmin.duration_seconds === "number" &&
    Number.isFinite(connectionFromAdmin.duration_seconds) &&
    connectionFromAdmin.duration_seconds >= 1 &&
    connectionFromAdmin.duration_seconds <= 120
      ? Math.trunc(connectionFromAdmin.duration_seconds)
      : 0;
  const statusDurationBase =
    isRustChaosStatusEffectAction(action) && ruleDefaultDuration > 0
      ? ruleDefaultDuration
      : giftValue;
  const rustChaosFourthArg = isRustChaosStatusEffectAction(action)
    ? parseRustChaosStatusDurationSeconds(request.nextUrl.searchParams, body, statusDurationBase)
    : giftValue;
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

    const miRoute = await trySpawnNpcmaxxTemplateViaMaxxInvadersEngine(
      request,
      body,
      server,
      connectionFromAdmin,
      tikfinityEventNameForLog,
      payload,
      npcTemplateKeyResolved,
      "npcmaxx"
    );
    if (miRoute) return miRoute;

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

    fireSquawkAfterTikfinityEvent({
      kind: "npcmaxx",
      action: "npcmaxx",
      viewerName: payload.viewerName,
      giftName: payload.giftName,
    });

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
    // gingynpc / eggnpc / vampnpc: same as bunny1npc — streamer_patrol + named outfit (wear pipe only).
    // Forcing template "gingy"/"egg"/"vamp" required those keys in RoamingNPCs.json on the server; many hosts never merged them.
    // Full weapon/tool presets from the repo still live under plugins/.../RoamingNPCs.json — merge or use ?action=maxxinvaders&template=gingy.
    const outfitRequest =
      action === "bunny1npc"
        ? "bunny1"
        : action === "gingynpc"
          ? "gingy"
          : action === "eggnpc"
            ? "egg"
            : action === "vampnpc"
              ? "vamp"
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
      logMaxxInvadersSpawnFailure("maxxinvaders", spawnMi, {
        serverId: server.id,
        anchorSteam64,
      });
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
      let replyHint =
        spawnMi.step === "rcon_reply"
          ? "Game replied via RCON — see rconResponse. Common: spawn_position (no players online → anchor 0,0; join server or use GUI spawn), anchor_offline (set ?anchorSteam= or TIKFINITY_MAXXINVADERS_ANCHOR_STEAM_ID and be online/sleeping), RoamingNPCs template missing/disabled, duplicate_viewer/cooldown, or ScientistFallbackEnabled=false with bridge failure."
          : spawnMi.step === "rcon_connect"
            ? connectedErrorDebug(server.rcon_host)
            : "RCON connected but command could not be sent.";
      const spawnPosHintMi = spawnPositionReplyHint(spawnMi, anchorSteam64);
      if (spawnPosHintMi) replyHint = spawnPosHintMi;
      if (
        spawnMi.step === "rcon_reply" &&
        /roamingnpcs is not loaded/i.test(spawnMi.error ?? "")
      ) {
        replyHint =
          "The Rust server rejected the spawn because the RoamingNPCs Oxide plugin is not loaded (or failed to start). On the host: add RoamingNPCs, run `oxide.reload RoamingNPCs`, confirm it shows in `oxide.plugins`. Then merge `gingy` / `egg` / `vamp` bot keys into `oxide/config/RoamingNPCs.json` if missing. See rconResponse for the exact MaxxInvaders line.";
      }
      if (
        spawnMi.step === "rcon_reply" &&
        /no bot key.*under bots settings/i.test(spawnMi.error ?? "")
      ) {
        replyHint =
          "The game server’s RoamingNPCs config does not include that bot template key. For `gingynpc` / `eggnpc` / `vampnpc`, copy the `gingy`, `egg`, and `vamp` entries from the RustMaxx repo (`plugins/RoamingNpc/config/gingy-egg-vamp.merge-fragment.json`) into `oxide/config/RoamingNPCs.json` under `Bots settings`, then run `oxide.reload RoamingNPCs`. Each block needs `\"Enable bot?\": true`.";
      }
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

    fireSquawkAfterTikfinityEvent({
      kind: "maxxinvaders",
      action,
      viewerName: payload.viewerName,
      giftName: payload.giftName,
    });

    const nameFallbackViewer =
      String(payload.viewerName ?? "").trim().toLowerCase() === "viewer";

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
        ...(nameFallbackViewer
          ? {
              nameHint:
                "RustMaxx did not find a viewer nickname in this webhook payload — the in-game bot will show Viewer. In TikFinity: add JSON fields substituted with %nickname% (or %username%), or put ?nickname=%nickname% on the URL. Use TikFinity → action → Raw JSON / custom body if query substitution fails.",
            }
          : {}),
        debug:
          action === "bunny1npc"
            ? `bunny1npc: profile bunny1 on Roaming template "${roamingBotKey}" (default streamer_patrol). Same spawn path as maxxinvaders; outfit forced to bunny. Add more looks via ?action=maxxinvaders&outfit=… in lib/maxxinvaders-outfit-profiles.ts.`
            : action === "gingynpc" || action === "eggnpc" || action === "vampnpc"
              ? `${action}: Roaming template "${roamingBotKey}" + outfit profile ${resolvedOutfit.resolvedId} (wear only, like bunny1npc). For full AK/tools presets merge repo bot keys into RoamingNPCs.json or use ?action=maxxinvaders&template=gingy.`
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
      ? `rustchaos ${action} ${viewerArg} ${giftArg} ${rustChaosFourthArg} ${messageArg}`
      : `rustchaos ${action} ${viewerArg} ${giftArg} ${rustChaosFourthArg}`;

  if (isRustChaosStatusEffectAction(action)) {
    console.log("[tikfinity webhook] status duration (s):", rustChaosFourthArg, "action:", action);
  } else if (giftValue > 0) {
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

  const ruleSpawnDefault =
    connectionFromAdmin?.spawn_count != null &&
    typeof connectionFromAdmin.spawn_count === "number"
      ? clampSoloSpawnRepeatCount(connectionFromAdmin.spawn_count)
      : 1;
  const soloSpawnRepeats = isRustChaosSoloScrapSpawnAction(action)
    ? parseSoloSpawnRepeatCount(q, body, ruleSpawnDefault)
    : 1;

  let rconResponse = "";
  try {
    for (let iter = 0; iter < soloSpawnRepeats; iter++) {
      rconResponse = (await runAndWait(server.id, command, 15000)).trim();
      const chunkFailed =
        /^FAILED:/i.test(rconResponse) ||
        /^Unknown action:/i.test(rconResponse) ||
        /^Error:/i.test(rconResponse);
      if (chunkFailed) break;
    }
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
        spawnRepeats: soloSpawnRepeats > 1 ? soloSpawnRepeats : undefined,
        scrapAmount: isRustChaosStatusEffectAction(action)
          ? undefined
          : giftValue > 0
            ? giftValue
            : undefined,
        statusDurationSeconds: isRustChaosStatusEffectAction(action)
          ? rustChaosFourthArg
          : undefined,
        rconResponse,
        debug:
          "Game server rejected the action. Read rconResponse; check RustChaos plugin version, StreamerName in RustChaos.json, and server console [RustChaos].",
      })
    );
  }

  console.log("[tikfinity webhook] OK", {
    action,
    command,
    serverId: server.id,
    rconResponse,
    spawnRepeats: soloSpawnRepeats,
  });
  audit("tikfinity", "webhook.trigger", {
    viewerName: payload.viewerName,
    giftName: payload.giftName,
    action,
    serverId: server.id,
    command,
    scrapAmount: isRustChaosStatusEffectAction(action)
      ? undefined
      : giftValue
        ? giftValue
        : undefined,
    statusDurationSeconds: isRustChaosStatusEffectAction(action)
      ? rustChaosFourthArg
      : undefined,
    rconResponse,
  }).catch(() => {});

  fireSquawkAfterTikfinityEvent({
    kind: "rustchaos",
    action,
    viewerName: payload.viewerName,
    giftName: payload.giftName,
  });

  return withCors(
    NextResponse.json({
      ok: true,
      action: action as TikTriggerAction,
      viewerName: payload.viewerName,
      giftName: payload.giftName,
      command,
      spawnRepeats: soloSpawnRepeats > 1 ? soloSpawnRepeats : undefined,
      scrapAmount: isRustChaosStatusEffectAction(action)
        ? undefined
        : giftValue > 0
          ? giftValue
          : undefined,
      statusDurationSeconds: isRustChaosStatusEffectAction(action)
        ? rustChaosFourthArg
        : undefined,
      rconResponse: rconResponse || undefined,
      debug:
        soloSpawnRepeats > 1
          ? `RCON OK (${soloSpawnRepeats}× same command for solo spawns). If fewer animals appeared, check RustChaos delays and server load. Also check StreamerName in RustChaos.json.`
          : "RCON OK. If an expected effect or NPC did not appear, check streamer online + RustChaos.json StreamerName + server console [RustChaos].",
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
    "Check RCON in RustMaxx → Servers → your server: host must be a public IP or hostname (WebSocket/WebRCON port, often 28082), password must match server rcon.password. The server row in the dashboard must match this webhook's target server.";
  if (rconHostLooksUnreachableFromCloud(rconHost ?? undefined)) {
    msg +=
      " This host looks private or local — RustMaxx runs in the cloud and cannot open WebRCON to 127.0.0.1 or LAN IPs; use your host’s public RCON endpoint, port forwarding, or a tunnel.";
  }
  return msg;
}
