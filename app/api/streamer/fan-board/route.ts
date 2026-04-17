import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { findUserById } from "@/lib/users";
import { canAccessStreamerDashboard } from "@/lib/streamer-guard";
import { userIsApprovedStreamer } from "@/lib/superfan";
import { getAvailableActionsForAdmin } from "@/lib/tikfinity";
import { query } from "@/lib/db";
import { listStreamerWebhooksForUser } from "@/lib/streamer-webhooks";
import {
  formatFanBoardActivitySummary,
  listFanBoardActivityForStreamer,
  type FanBoardActivityRow,
} from "@/lib/fan-board-activity";
import {
  getEffectiveFanBoardActionKeysForStreamer,
  getMergedFanBoardSettings,
  isActionAllowedOnFanBoards,
  listFanBoardSlotsForStreamer,
  parseFanBoardTier,
  replaceFanBoardTierSlots,
  type FanBoardTier,
} from "@/lib/streamer-fan-board";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const user = await findUserById(session.userId);
  if (!user || !canAccessStreamerDashboard(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await userIsApprovedStreamer(session.userId))) {
    return NextResponse.json({ error: "Approved streamer required" }, { status: 403 });
  }

  const hooks = await listStreamerWebhooksForUser(session.userId);
  const effective = await getEffectiveFanBoardActionKeysForStreamer(session.userId);
  const catalog = getAvailableActionsForAdmin().filter((a) => isActionAllowedOnFanBoards(a.action));
  const actions = catalog.filter((a) => effective.has(a.action));

  const slots = await listFanBoardSlotsForStreamer(session.userId);
  const settings = await getMergedFanBoardSettings(session.userId);
  let activityRows: FanBoardActivityRow[] = [];
  try {
    activityRows = await listFanBoardActivityForStreamer(session.userId, 80);
  } catch (e) {
    console.error("[streamer/fan-board GET] activity list failed", e);
  }
  const servers: { id: string; name: string | null }[] = [];
  for (const h of hooks) {
    const { rows } = await query<{ id: string; name: string }>(
      "SELECT id::text, name FROM servers WHERE id = $1::uuid LIMIT 1",
      [h.server_id]
    );
    const s = rows[0];
    if (s) servers.push({ id: s.id, name: s.name });
  }

  return NextResponse.json({
    slots: slots.map((s) => ({
      id: s.id,
      board_tier: s.board_tier,
      action_key: s.action_key,
      sort_order: s.sort_order,
      server_id: s.server_id,
    })),
    settings,
    actions,
    servers,
    activity: activityRows.map((a) => ({
      id: a.id,
      viewer_user_id: a.viewer_user_id,
      viewer_label: a.viewer_label,
      board_tier: a.board_tier,
      action_key: a.action_key,
      action_label: a.action_label,
      created_at: a.created_at.toISOString(),
      summary: formatFanBoardActivitySummary(a),
    })),
  });
}

export async function PUT(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const user = await findUserById(session.userId);
  if (!user || !canAccessStreamerDashboard(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await userIsApprovedStreamer(session.userId))) {
    return NextResponse.json({ error: "Approved streamer required" }, { status: 403 });
  }

  let body: { tier?: unknown; actions?: unknown; server_id?: unknown; cooldown_seconds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tier = parseFanBoardTier(body.tier);
  if (!tier) {
    return NextResponse.json({ error: "tier must be fan, superfan, or mod" }, { status: 400 });
  }
  const actions = Array.isArray(body.actions) ? body.actions.filter((x) => typeof x === "string") : [];
  const serverRaw = body.server_id;
  const serverId =
    serverRaw === null || serverRaw === undefined
      ? null
      : typeof serverRaw === "string" && serverRaw.trim()
        ? serverRaw.trim()
        : null;

  let cooldownSeconds: number | undefined;
  if (body.cooldown_seconds !== undefined && body.cooldown_seconds !== null) {
    const n = Number(body.cooldown_seconds);
    if (!Number.isFinite(n) || n < 0 || n > 3600) {
      return NextResponse.json({ error: "cooldown_seconds must be between 0 and 3600" }, { status: 400 });
    }
    cooldownSeconds = Math.trunc(n);
  }

  const result = await replaceFanBoardTierSlots(session.userId, tier as FanBoardTier, actions, serverId, {
    cooldownSeconds,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
