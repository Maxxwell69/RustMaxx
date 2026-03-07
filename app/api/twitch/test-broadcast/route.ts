import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { findUserById } from "@/lib/users";
import { getStreamerLinkedServerIds, getTwitchAccountByUserId } from "@/lib/twitch-db";
import { dispatchBroadcast } from "@/lib/action-dispatch";
import type { UserRole } from "@/lib/permissions";

/**
 * POST: Send a test follow broadcast to the current user's first linked server.
 * Use this to verify RCON and in-game broadcast without a real Twitch follow.
 */
export async function POST(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;

  const session = getSessionFromRequest(request)!;
  const account = await getTwitchAccountByUserId(session.userId);
  if (!account) {
    return NextResponse.json({ ok: false, error: "Connect Twitch on Profile first." }, { status: 400 });
  }

  const linkedServerIds = await getStreamerLinkedServerIds(session.userId);
  if (linkedServerIds.length === 0) {
    return NextResponse.json({ ok: false, error: "Link a server in the Follow → in-game broadcast section first." }, { status: 400 });
  }

  const user = await findUserById(session.userId);
  const role = (user?.role ?? "guest") as UserRole;
  const serverId = linkedServerIds[0];
  const broadcasterName = account.twitch_display_name ?? account.twitch_login ?? "Streamer";
  const message = `New follower: TestViewer! — ${broadcasterName}`;

  const result = await dispatchBroadcast(serverId, session.userId, role, message);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Broadcast failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: "Test broadcast sent. Check in-game chat and the server live console." });
}
