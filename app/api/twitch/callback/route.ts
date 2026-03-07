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

  const redirectUri = process.env.TWITCH_REDIRECT_URI;
  if (!redirectUri) {
    const res = NextResponse.redirect(new URL("/profile?twitch=config_error", request.url));
    res.cookies.delete(STATE_COOKIE);
    return res;
  }

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
    const res = NextResponse.redirect(new URL("/profile?twitch=exchange_failed", request.url));
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
