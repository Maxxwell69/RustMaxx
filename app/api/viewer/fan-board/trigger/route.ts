import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { findUserById } from "@/lib/users";
import { executeFanBoardRustChaos, type FanBoardTriggerBody } from "@/lib/fan-board-rcon";
import { getFanClubMembership } from "@/lib/superfan";
import {
  getCooldownSecondsForTier,
  getSlotForStreamerAction,
  parseFanBoardTier,
  resolveRconServerIdForSlot,
  viewerTierCanAccessBoard,
} from "@/lib/streamer-fan-board";
import { getFanBoardCooldownRemaining, recordFanBoardTriggerSuccess } from "@/lib/fan-board-cooldown";
import { TIKTRIGGER_ACTIONS, type TikTriggerAction } from "@/lib/tikfinity";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;

  let body: {
    streamer_id?: unknown;
    board_tier?: unknown;
    action_key?: unknown;
    amount?: unknown;
    duration?: unknown;
    seconds?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const streamerId = typeof body.streamer_id === "string" ? body.streamer_id.trim() : "";
  const boardTier = parseFanBoardTier(body.board_tier);
  const actionRaw = typeof body.action_key === "string" ? body.action_key.trim().toLowerCase() : "";

  if (!streamerId || !boardTier || !actionRaw) {
    return NextResponse.json(
      { error: "streamer_id, board_tier (fan|superfan|mod), and action_key are required" },
      { status: 400 }
    );
  }

  const membership = await getFanClubMembership(session.userId, streamerId);
  if (!membership || membership.status !== "approved" || !membership.club_tier) {
    return NextResponse.json({ error: "Not an approved fan club member." }, { status: 403 });
  }
  if (!viewerTierCanAccessBoard(membership.club_tier, boardTier)) {
    return NextResponse.json({ error: "Your tier cannot use this board." }, { status: 403 });
  }

  const slot = await getSlotForStreamerAction(streamerId, boardTier, actionRaw);
  if (!slot) {
    return NextResponse.json({ error: "This action is not on that board for the streamer." }, { status: 400 });
  }

  if (!(TIKTRIGGER_ACTIONS as readonly string[]).includes(actionRaw)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const serverId = await resolveRconServerIdForSlot(streamerId, slot.server_id);
  if (!serverId) {
    return NextResponse.json(
      {
        error:
          "No RCON server is linked for this streamer. The streamer must add a TikFinity webhook (server) in the streamer dashboard.",
      },
      { status: 503 }
    );
  }

  const cooldownSeconds = await getCooldownSecondsForTier(streamerId, boardTier);
  const waitSec = await getFanBoardCooldownRemaining(session.userId, streamerId, boardTier, cooldownSeconds);
  if (waitSec > 0) {
    return NextResponse.json(
      {
        error: `Wait ${waitSec}s before another action on this board.`,
        retry_after_seconds: waitSec,
      },
      { status: 429, headers: { "Retry-After": String(waitSec) } }
    );
  }

  const user = await findUserById(session.userId);
  const displayName = (user?.display_name ?? user?.email ?? "Fan").trim() || "Fan";

  const triggerBody: FanBoardTriggerBody = {};
  if (typeof body.amount === "number" && Number.isFinite(body.amount)) triggerBody.amount = body.amount;
  if (typeof body.duration === "number" && Number.isFinite(body.duration)) triggerBody.duration = body.duration;
  if (typeof body.seconds === "number" && Number.isFinite(body.seconds)) triggerBody.seconds = body.seconds;

  const result = await executeFanBoardRustChaos({
    serverId,
    action: actionRaw as TikTriggerAction,
    viewerDisplayName: displayName,
    body: triggerBody,
  });

  if (!result.ok) {
    await audit(session.userId, "viewer.fan_board.trigger_fail", {
      streamerId,
      boardTier,
      action: actionRaw,
      step: result.step,
    }).catch(() => {});
    return NextResponse.json(
      { error: result.error, step: result.step, command: result.command },
      { status: 502 }
    );
  }

  await recordFanBoardTriggerSuccess(session.userId, streamerId, boardTier, cooldownSeconds);

  await audit(session.userId, "viewer.fan_board.trigger", {
    streamerId,
    boardTier,
    action: actionRaw,
    serverId,
  }).catch(() => {});

  return NextResponse.json({ ok: true, command: result.command, rconResponse: result.rconResponse });
}
