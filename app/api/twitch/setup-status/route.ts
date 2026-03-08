import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { getTwitchAccountByUserId, getStreamerLinkedServerIds } from "@/lib/twitch-db";
import { getAppAccessToken } from "@/lib/twitch-oauth";
import { getEventSubSubscriptions } from "@/lib/twitch-eventsub";

/**
 * GET: Returns what's in place for follow notifications so the Profile can show a checklist.
 * - linked, twitch_user_id
 * - linkedServerCount (must be > 0 for follow → in-game)
 * - followSubscriptionActive (channel.follow subscription exists for this broadcaster)
 * - chatSubscriptionActive (channel.chat.message exists)
 */
export async function GET(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;

  const session = getSessionFromRequest(request)!;
  const account = await getTwitchAccountByUserId(session.userId);

  if (!account) {
    return NextResponse.json({
      linked: false,
      linkedServerCount: 0,
      followSubscriptionActive: false,
      chatSubscriptionActive: false,
    });
  }

  const linkedServerIds = await getStreamerLinkedServerIds(session.userId);

  let followSubscriptionActive = false;
  let chatSubscriptionActive = false;
  try {
    const appToken = await getAppAccessToken();
    const subs = await getEventSubSubscriptions(appToken);
    const broadcasterId = account.twitch_user_id;
    for (const sub of subs) {
      const cond = sub.condition ?? {};
      if (cond.broadcaster_user_id !== broadcasterId) continue;
      if (sub.type === "channel.follow" && sub.status === "enabled") followSubscriptionActive = true;
      if (sub.type === "channel.chat.message" && sub.status === "enabled") chatSubscriptionActive = true;
    }
  } catch (e) {
    console.error("[twitch setup-status] failed to list subscriptions", e);
  }

  return NextResponse.json({
    linked: true,
    twitch_user_id: account.twitch_user_id,
    linkedServerCount: linkedServerIds.length,
    followSubscriptionActive,
    chatSubscriptionActive,
  });
}
