import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import {
  getTwitchAccountByUserId,
  getRefreshTokenForUser,
  updateTwitchTokens,
} from "@/lib/twitch-db";
import { refreshTwitchToken, getAppAccessToken } from "@/lib/twitch-oauth";
import { createChannelFollowSubscription, createChannelChatMessageSubscription } from "@/lib/twitch-eventsub";

/**
 * POST: Create or refresh EventSub subscriptions (follow + chat) using your existing Twitch connection.
 * No revoke needed—use this before or during stream if events stop working.
 */
export async function POST(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;

  const session = getSessionFromRequest(request)!;
  const account = await getTwitchAccountByUserId(session.userId);
  if (!account) {
    return NextResponse.json({ ok: false, error: "Connect Twitch on Profile first." }, { status: 400 });
  }

  const webhookUrl = process.env.TWITCH_WEBHOOK_CALLBACK_URL;
  const eventsubSecret = process.env.TWITCH_EVENTSUB_SECRET;
  if (!webhookUrl || !eventsubSecret) {
    return NextResponse.json(
      { ok: false, error: "Webhook not configured. Set TWITCH_WEBHOOK_CALLBACK_URL and TWITCH_EVENTSUB_SECRET." },
      { status: 500 }
    );
  }

  const refreshToken = await getRefreshTokenForUser(session.userId);
  if (!refreshToken) {
    return NextResponse.json({ ok: false, error: "Twitch token missing. Reconnect Twitch on Profile." }, { status: 400 });
  }
  let accessToken: string;
  try {
    const tokens = await refreshTwitchToken(refreshToken);
    await updateTwitchTokens(session.userId, tokens.access_token, tokens.refresh_token);
    accessToken = tokens.access_token;
  } catch (e) {
    console.error("[twitch refresh-subscriptions] token refresh failed", e);
    return NextResponse.json({ ok: false, error: "Token expired or revoked. Disconnect Twitch and connect again on Profile." }, { status: 400 });
  }

  const broadcasterUserId = account.twitch_user_id;
  let followOk = false;
  let chatOk = false;
  let followError: string | null = null;
  let chatError: string | null = null;
  const appToken = await getAppAccessToken();

  try {
    await createChannelFollowSubscription(broadcasterUserId, webhookUrl, eventsubSecret, accessToken);
    followOk = true;
  } catch (err) {
    console.error("[twitch refresh-subscriptions] follow failed", err);
    followError = err instanceof Error ? err.message : String(err);
  }

  try {
    await createChannelChatMessageSubscription(broadcasterUserId, webhookUrl, eventsubSecret, appToken);
    chatOk = true;
  } catch (err) {
    console.error("[twitch refresh-subscriptions] chat failed (follow may still work)", err);
    chatError = err instanceof Error ? err.message : String(err);
  }

  if (!followOk && !chatOk) {
    return NextResponse.json({
      ok: false,
      error: "Could not create subscriptions. Reconnect Twitch once (Profile → Connect Twitch) to grant permissions.",
      detail: followError ?? chatError ?? undefined,
      follow: false,
      chat: false,
    });
  }

  const message =
    followOk && chatOk
      ? "Follow and chat subscriptions enabled."
      : followOk
        ? "Follow notifications enabled. Chat (!rust) subscription could not be enabled (Twitch limitation); use Test !rust to send to game."
        : "Chat enabled; follow failed.";
  return NextResponse.json({
    ok: true,
    follow: followOk,
    chat: chatOk,
    message,
  });
}
