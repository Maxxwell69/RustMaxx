import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { findUserById } from "@/lib/users";
import { getStreamerLinkedServerIds, getTwitchAccountByUserId } from "@/lib/twitch-db";
import { dispatchBroadcast } from "@/lib/action-dispatch";
import type { UserRole } from "@/lib/permissions";

/**
 * POST: Send a test message to the game as if you had typed "!rust Hello from Profile" in Twitch chat.
 * Use this to verify the same pipeline (linked server + RCON) works without relying on Twitch sending events.
 * Body: optional { message: string } (default "Hello from Profile test").
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

  let body: { message?: string } = {};
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    //
  }
  const message = typeof body.message === "string" && body.message.trim() ? body.message.trim().slice(0, 200) : "Hello from Profile test";

  const user = await findUserById(session.userId);
  const role = (user?.role ?? "guest") as UserRole;
  const serverId = linkedServerIds[0];

  const result = await dispatchBroadcast(serverId, session.userId, role, message);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Broadcast failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: "Test message sent. If you see it in-game, the pipeline works; Twitch chat events may not be reaching the webhook." });
}
