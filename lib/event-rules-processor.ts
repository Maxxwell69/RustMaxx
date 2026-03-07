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
    return { logged: true, duplicate: false, dispatched: 0 };
  }

  const user = await findUserById(rustmaxxUserId);
  const role = (user?.role ?? "guest") as UserRole;

  const rules = await getEventRulesForUser(rustmaxxUserId);
  const followRules = rules.filter((r) => r.event_kind === "channel.follow" && r.action_id === "broadcast");

  const linkedServerIds = await getStreamerLinkedServerIds(rustmaxxUserId);
  let dispatched = 0;

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
    if (result.ok) dispatched++;
  }

  return { logged: true, duplicate: false, dispatched };
}
