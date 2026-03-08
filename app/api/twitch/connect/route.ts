import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { getTwitchAuthUrl } from "@/lib/twitch-oauth";
import { randomBytes } from "crypto";

const STATE_COOKIE = "twitch_oauth_state";
const STATE_MAX_AGE = 600; // 10 min

function getRedirectUri(request: NextRequest): { uri: string; isPublic: boolean } {
  const fromEnv = process.env.TWITCH_REDIRECT_URI?.trim();
  if (fromEnv && !fromEnv.includes("localhost")) return { uri: fromEnv, isPublic: true };

  const appUrl = process.env.APP_URL?.trim() || process.env.SITE_URL?.trim();
  if (appUrl) {
    const base = appUrl.replace(/\/$/, "");
    return { uri: `${base}/api/twitch/callback`, isPublic: true };
  }

  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const origin = forwardedProto && forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : url.origin;
  const uri = `${origin}/api/twitch/callback`;
  const isPublic = !uri.includes("localhost") && !uri.includes("127.0.0.1");
  return { uri, isPublic };
}

const LOCALHOST_ERROR_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Connect Twitch – configuration needed</title></head>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:2rem auto;padding:1rem;">
  <h1>Connect Twitch – configuration needed</h1>
  <p>Your server is using localhost for the redirect URL, so Twitch would send users back to localhost and the connection would fail.</p>
  <p><strong>Fix:</strong> In your server environment (hosting dashboard or .env), set:</p>
  <pre style="background:#eee;padding:0.75rem;border-radius:6px;">APP_URL=https://rustmaxx.com</pre>
  <p>Use your real domain (e.g. <code>https://www.rustmaxx.com</code> if you use www). Then redeploy and try <strong>Connect Twitch</strong> again from your Profile.</p>
  <p><a href="/profile">← Back to Profile</a></p>
</body></html>`;

export async function GET(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;

  const { uri: redirectUri, isPublic } = getRedirectUri(request);
  if (!redirectUri || !isPublic) {
    return new NextResponse(LOCALHOST_ERROR_HTML, {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
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
