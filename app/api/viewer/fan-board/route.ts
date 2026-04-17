import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { findUserById } from "@/lib/users";
import { getAvailableActionsForAdmin } from "@/lib/tikfinity";
import { getFanClubMembership } from "@/lib/superfan";
import {
  listFanBoardSlotsForStreamer,
  viewerTierCanAccessBoard,
  type FanBoardTier,
} from "@/lib/streamer-fan-board";

export const runtime = "nodejs";

const TIERS: FanBoardTier[] = ["fan", "superfan", "mod"];

export async function GET(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;

  const streamerId = new URL(request.url).searchParams.get("streamer_id")?.trim() ?? "";
  if (!streamerId) {
    return NextResponse.json({ error: "streamer_id is required" }, { status: 400 });
  }

  const membership = await getFanClubMembership(session.userId, streamerId);
  if (!membership || membership.status !== "approved" || !membership.club_tier) {
    return NextResponse.json({ error: "Not an approved fan club member for this streamer." }, { status: 403 });
  }

  const viewerTier = membership.club_tier;
  const labelByAction = new Map<string, string>(
    getAvailableActionsForAdmin().map((a) => [a.action as string, a.label])
  );

  const allSlots = await listFanBoardSlotsForStreamer(streamerId);
  const boards: Record<string, { action_key: string; label: string; sort_order: number; server_id: string | null }[]> =
    {};

  for (const t of TIERS) {
    if (!viewerTierCanAccessBoard(viewerTier, t)) continue;
    boards[t] = allSlots
      .filter((s) => s.board_tier === t)
      .map((s) => ({
        action_key: s.action_key,
        label: labelByAction.get(s.action_key) ?? s.action_key,
        sort_order: s.sort_order,
        server_id: s.server_id,
      }));
  }

  const user = await findUserById(session.userId);
  return NextResponse.json({
    club_tier: viewerTier,
    display_name: user?.display_name ?? null,
    boards,
  });
}
