import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { deleteTwitchAccountByUserId } from "@/lib/twitch-db";

/**
 * POST: Unlink Twitch from the current user's profile.
 */
export async function POST(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;

  const session = getSessionFromRequest(request)!;
  await deleteTwitchAccountByUserId(session.userId);

  return NextResponse.json({ ok: true });
}
