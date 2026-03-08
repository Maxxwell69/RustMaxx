import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { exchangeCodeForTokens, getTwitchUserFromToken } from "@/lib/twitch-oauth";
import { upsertTwitchAccount } from "@/lib/twitch-db";
import { createChannelFollowSubscription, createChannelChatMessageSubscription } from "@/lib/twitch-eventsub";

const STATE_COOKIE = "twitch_oauth_state";
const FRONTEND_REDIRECT = "/profile"; // or /streamer-interaction

export async function GET(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;

  const session = getSessionFromRequest(request)!;
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const storedState = request.cookies.get(STATE_COOKIE)?.value;
  if (!state || state !== storedState) {
    const res = NextResponse.redirect(new URL("/profile?twitch=state_invalid", request.url));
    res.cookies.delete(STATE_COOKIE);
    return res;
  }

  if (!code) {
    const res = NextResponse.redirect(new URL("/profile?twitch=no_code", request.url));
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
      try {
        await createChannelFollowSubscription(
          twitchUser.id,
          webhookUrl,
          eventsubSecret,
          tokens.access_token
        );
      } catch (subErr) {
        console.error("[twitch callback] EventSub follow subscribe failed", subErr);
        eventsubFailed = true;
      }
      try {
        await createChannelChatMessageSubscription(
          twitchUser.id,
          webhookUrl,
          eventsubSecret,
          tokens.access_token
        );
      } catch (chatErr) {
        console.error("[twitch callback] EventSub chat subscribe failed (may need extra scope)", chatErr);
        eventsubFailed = true;
      }
    } else {
      eventsubFailed = true;
    }
  } catch (e) {
    console.error("[twitch callback]", e);
    const err = e as { code?: string; constraint?: string };
    const isDuplicateTwitch =
      err?.code === "23505" && err?.constraint === "twitch_accounts_twitch_user_id_key";
    const redirectUrl = new URL("/profile", request.url);
    redirectUrl.searchParams.set("twitch", isDuplicateTwitch ? "already_linked" : "exchange_failed");
    const res = NextResponse.redirect(redirectUrl);
    res.cookies.delete(STATE_COOKIE);
    return res;
  }

  const redirectUrl = new URL(FRONTEND_REDIRECT, request.url);
  redirectUrl.searchParams.set("twitch", "linked");
  if (eventsubFailed) redirectUrl.searchParams.set("eventsub", "failed");
  const res = NextResponse.redirect(redirectUrl);
  res.cookies.delete(STATE_COOKIE);
  return res;
}
