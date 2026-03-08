import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { getTwitchAuthUrl } from "@/lib/twitch-oauth";
import { randomBytes } from "crypto";

const STATE_COOKIE = "twitch_oauth_state";
const STATE_MAX_AGE = 600; // 10 min

function getRedirectUri(request: NextRequest): string {
  const fromEnv = process.env.TWITCH_REDIRECT_URI?.trim();
  if (fromEnv && !fromEnv.includes("localhost")) return fromEnv;

  const appUrl = process.env.APP_URL?.trim() || process.env.SITE_URL?.trim();
  if (appUrl) {
    const base = appUrl.replace(/\/$/, "");
    return `${base}/api/twitch/callback`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/api/twitch/callback`;
  }

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
  if (!redirectUri || redirectUri.includes("localhost")) {
    return NextResponse.json(
      { error: "Set APP_URL or TWITCH_REDIRECT_URI to your public URL (e.g. https://rustmaxx.com) so Connect Twitch redirects correctly." },
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
