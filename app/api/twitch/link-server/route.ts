import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { getServerIfAccessible } from "@/lib/server-access";
import type { UserRole } from "@/lib/permissions";
import { addStreamerServerLink, addEventRule, getTwitchAccountByUserId } from "@/lib/twitch-db";

/**
 * POST: link current user (streamer) to a server and optionally add follow->broadcast rule.
 * Body: { server_id: string, add_follow_broadcast_rule?: boolean }
 */
export async function POST(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;

  const session = getSessionFromRequest(request)!;
  let body: { server_id?: string; add_follow_broadcast_rule?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const serverId = typeof body.server_id === "string" ? body.server_id.trim() : "";
  if (!serverId) {
    return NextResponse.json({ error: "server_id is required" }, { status: 400 });
  }

  const server = await getServerIfAccessible(serverId, session.userId, session.role as UserRole);
  if (!server) {
    return NextResponse.json({ error: "Server not found or access denied" }, { status: 404 });
  }

  await addStreamerServerLink(session.userId, serverId);

  const addRule = body.add_follow_broadcast_rule === true;
  if (addRule) {
    const account = await getTwitchAccountByUserId(session.userId);
    if (account) {
      await addEventRule(
        session.userId,
        serverId,
        "channel.follow",
        "broadcast",
        { message: "New follower: {user_name}!" }
      );
    }
  }

  return NextResponse.json({ ok: true, server_id: serverId });
}
