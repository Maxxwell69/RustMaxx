/**
 * Process normalized Twitch event: dedup, log, then apply event rules (e.g. follow -> broadcast).
 * All Twitch logic in backend; no UI.
 */

import { getTwitchAccountByTwitchUserId } from "@/lib/twitch-db";
import { findUserById } from "@/lib/users";
import { getEventRulesForUser, getStreamerLinkedServerIds, hasEventByTwitchMessageId, insertEventLog } from "@/lib/twitch-db";
import { dispatchWhitelistAction } from "@/lib/action-dispatch";
import type { TwitchNormalizedEvent } from "@/lib/twitch-events-normalize";
import type { UserRole } from "@/lib/permissions";

/**
 * Process one normalized event: dedup by twitch_message_id, insert log, then run matching rules.
 * For follow -> broadcast: find broadcaster's user_id, get rules, dispatch broadcast to linked servers.
 */
export async function processNormalizedEvent(
  normalized: TwitchNormalizedEvent,
  twitchMessageId: string | null
): Promise<{ logged: boolean; duplicate: boolean; dispatched: number }> {
  if (twitchMessageId && (await hasEventByTwitchMessageId(twitchMessageId))) {
    return { logged: false, duplicate: true, dispatched: 0 };
  }

  const broadcasterTwitchId = normalized.broadcasterUserId ?? normalized.userId;
  const account = await getTwitchAccountByTwitchUserId(broadcasterTwitchId);
  const rustmaxxUserId = account?.user_id ?? null;

  await insertEventLog(
    rustmaxxUserId,
    normalized.kind,
    twitchMessageId,
    normalized as unknown as Record<string, unknown>
  );

  if (!rustmaxxUserId) {
    console.warn("[twitch follow] no RustMaxx user for broadcaster Twitch id:", broadcasterTwitchId, "- is Twitch connected in Profile?");
    return { logged: true, duplicate: false, dispatched: 0 };
  }

  const user = await findUserById(rustmaxxUserId);
  const role = (user?.role ?? "guest") as UserRole;

  const rules = await getEventRulesForUser(rustmaxxUserId);
  const followRules = rules.filter((r) => r.event_kind === "channel.follow" && r.action_id === "broadcast");
  const linkedServerIds = await getStreamerLinkedServerIds(rustmaxxUserId);

  if (followRules.length === 0 && linkedServerIds.length > 0) {
    console.warn("[twitch follow] no follow->broadcast rule found; using first linked server (add rule via Profile if needed).");
  }
  if (linkedServerIds.length === 0) {
    console.warn("[twitch follow] user has no linked servers. Link a server on Profile.");
  }

  const defaultParams = { message: "New follower: {user_name}!" };
  let dispatched = 0;

  if (followRules.length > 0) {
    for (const rule of followRules) {
      const serverId = rule.server_id ?? linkedServerIds[0];
      if (!serverId) continue;

      const result = await dispatchWhitelistAction(
        rule.action_id,
        rule.action_params,
        serverId,
        rustmaxxUserId,
        role,
        {
          userId: normalized.userId,
          userLogin: normalized.userLogin,
          userName: normalized.userName,
        }
      );
      if (result.ok) {
        dispatched++;
        console.log("[twitch follow] broadcast dispatched to server", serverId, "for", normalized.userName ?? normalized.userLogin);
      } else {
        console.error("[twitch follow] dispatch failed for server", serverId, result.error);
      }
    }
  } else if (linkedServerIds.length > 0) {
    const serverId = linkedServerIds[0];
    const result = await dispatchWhitelistAction(
      "broadcast",
      defaultParams,
      serverId,
      rustmaxxUserId,
      role,
      {
        userId: normalized.userId,
        userLogin: normalized.userLogin,
        userName: normalized.userName,
      }
    );
    if (result.ok) {
      dispatched++;
      console.log("[twitch follow] broadcast dispatched to server (fallback)", serverId, "for", normalized.userName ?? normalized.userLogin);
    } else {
      console.error("[twitch follow] dispatch failed for server", serverId, result.error);
    }
  }

  return { logged: true, duplicate: false, dispatched };
}
