import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { getTwitchAccountByUserId } from "@/lib/twitch-db";

export async function GET(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;

  const session = getSessionFromRequest(request)!;
  const account = await getTwitchAccountByUserId(session.userId);

  if (!account) {
    return NextResponse.json({ linked: false });
  }

  return NextResponse.json({
    linked: true,
    twitch_login: account.twitch_login,
    twitch_display_name: account.twitch_display_name,
    twitch_user_id: account.twitch_user_id,
    linked_at: account.linked_at,
  });
}
