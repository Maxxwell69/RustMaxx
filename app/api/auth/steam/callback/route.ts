import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { verifySteamOpenIdCallback } from "@/lib/steam-openid";
import { setUserSteamId } from "@/lib/users";

function baseUrl(req: NextRequest): string {
  const env = process.env.APP_URL?.trim() ?? process.env.SITE_URL?.trim();
  if (env) {
    try {
      return new URL(env).origin;
    } catch {
      /* fall through */
    }
  }
  return req.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const session = getSession(request.headers.get("cookie"));
  if (!session) {
    return NextResponse.redirect(new URL("/login", baseUrl(request)));
  }
  const steamId = await verifySteamOpenIdCallback(request.nextUrl.searchParams);
  if (!steamId) {
    return NextResponse.redirect(
      new URL("/streamer?steam=verify_failed", baseUrl(request))
    );
  }
  const result = await setUserSteamId(session.userId, steamId);
  if ("error" in result) {
    const q = new URLSearchParams({ steam: "link_failed", reason: result.error });
    return NextResponse.redirect(
      new URL(`/streamer?${q.toString()}`, baseUrl(request))
    );
  }
  return NextResponse.redirect(new URL("/streamer?steam=linked", baseUrl(request)));
}
