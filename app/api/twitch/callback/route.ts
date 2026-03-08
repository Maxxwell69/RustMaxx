import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { exchangeCodeForTokens, getTwitchUserFromToken, getAppAccessToken } from "@/lib/twitch-oauth";
import { upsertTwitchAccount } from "@/lib/twitch-db";
import { createChannelFollowSubscription, createChannelChatMessageSubscription } from "@/lib/twitch-eventsub";
import { getPublicProfileUrl } from "@/lib/twitch-public-url";

const STATE_COOKIE = "twitch_oauth_state";

function sanitizeEventSubError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, " ").slice(0, 180).trim();
}

function redirectToProfile(request: NextRequest, query: string): NextResponse {
  const url = getPublicProfileUrl("/profile?" + query) ?? new URL("/profile?" + query, request.url).href;
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;

  const session = getSessionFromRequest(request)!;
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const storedState = request.cookies.get(STATE_COOKIE)?.value;
  if (!state || state !== storedState) {
    const res = redirectToProfile(request, "twitch=state_invalid");
    res.cookies.delete(STATE_COOKIE);
    return res;
  }

  if (!code) {
    const res = redirectToProfile(request, "twitch=no_code");
    res.cookies.delete(STATE_COOKIE);
    return res;
  }

  const redirectUri = (() => {
    const fromEnv = process.env.TWITCH_REDIRECT_URI?.trim();
    if (fromEnv && !fromEnv.includes("localhost")) return fromEnv;
    const appUrl = process.env.APP_URL?.trim() || process.env.SITE_URL?.trim();
    if (appUrl) {
      const base = appUrl.replace(/\/$/, "");
      return `${base}/api/twitch/callback`;
    }
    const url = new URL(request.url);
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const origin = forwardedProto && forwardedHost ? `${forwardedProto}://${forwardedHost}` : url.origin;
    return `${origin}/api/twitch/callback`;
  })();

  let eventsubFailed = false;
  let eventsubError: string | null = null;
  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const twitchUser = await getTwitchUserFromToken(tokens.access_token);
    await upsertTwitchAccount(
      session.userId,
      twitchUser.id,
      twitchUser.login,
      twitchUser.display_name,
      tokens.access_token,
      tokens.refresh_token
    );

    const webhookUrl = process.env.TWITCH_WEBHOOK_CALLBACK_URL;
    const eventsubSecret = process.env.TWITCH_EVENTSUB_SECRET;
    if (webhookUrl && eventsubSecret) {
      const appToken = await getAppAccessToken();
      try {
        await createChannelFollowSubscription(
          twitchUser.id,
          webhookUrl,
          eventsubSecret,
          appToken
        );
      } catch (subErr) {
        console.error("[twitch callback] EventSub follow subscribe failed", subErr);
        eventsubFailed = true;
        eventsubError = sanitizeEventSubError(subErr);
      }
      try {
        await createChannelChatMessageSubscription(
          twitchUser.id,
          webhookUrl,
          eventsubSecret,
          appToken
        );
      } catch (chatErr) {
        console.error("[twitch callback] EventSub chat subscribe failed (may need extra scope)", chatErr);
        eventsubFailed = true;
        if (!eventsubError) eventsubError = sanitizeEventSubError(chatErr);
      }
    } else {
      eventsubFailed = true;
      eventsubError = !webhookUrl ? "TWITCH_WEBHOOK_CALLBACK_URL not set" : "TWITCH_EVENTSUB_SECRET not set";
    }
  } catch (e) {
    console.error("[twitch callback]", e);
    const err = e as { code?: string; constraint?: string };
    const isDuplicateTwitch =
      err?.code === "23505" && err?.constraint === "twitch_accounts_twitch_user_id_key";
    const query = "twitch=" + (isDuplicateTwitch ? "already_linked" : "exchange_failed");
    const res = redirectToProfile(request, query);
    res.cookies.delete(STATE_COOKIE);
    return res;
  }

  let query = "twitch=linked";
  if (eventsubFailed) {
    query += "&eventsub=failed";
    if (eventsubError) query += "&eventsub_error=" + encodeURIComponent(eventsubError);
  }
  const res = redirectToProfile(request, query);
  res.cookies.delete(STATE_COOKIE);
  return res;
}
