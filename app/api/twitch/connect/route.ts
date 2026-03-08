import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { getTwitchAuthUrl } from "@/lib/twitch-oauth";
import { randomBytes } from "crypto";

const STATE_COOKIE = "twitch_oauth_state";
const STATE_MAX_AGE = 600; // 10 min

function getRedirectUri(request: NextRequest): string | null {
  const fromEnv = process.env.TWITCH_REDIRECT_URI?.trim();
  if (fromEnv && !fromEnv.includes("localhost")) return fromEnv;

  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const origin = forwardedProto && forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : url.origin;
  return `${origin}/api/twitch/callback`;
}

export async function GET(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;

  const redirectUri = getRedirectUri(request);
  if (!redirectUri) {
    return NextResponse.json(
      { error: "TWITCH_REDIRECT_URI is not configured" },
      { status: 500 }
    );
  }

  const state = randomBytes(24).toString("base64url");
  const url = getTwitchAuthUrl(redirectUri, state);

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: STATE_MAX_AGE,
    path: "/",
  });
  return res;
}
