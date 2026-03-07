/**
 * Normalize Twitch EventSub payloads to internal event format.
 * Single place for mapping Twitch payloads -> TwitchNormalizedEvent.
 */

export type TwitchNormalizedEvent = {
  kind: "channel.follow" | "channel.subscribe" | "channel.cheer" | "channel.raid" | "channel.reward_redemption" | "stream.online" | "stream.offline";
  userId: string;
  userLogin?: string;
  userName?: string;
  /** For channel events: the streamer's Twitch user id (we look up RustMaxx user by this). */
  broadcasterUserId?: string;
  rewardId?: string;
  rewardTitle?: string;
  bits?: number;
  tier?: string;
  at: string;
  raw?: Record<string, unknown>;
};

/**
 * channel.follow event payload (EventSub v2):
 * { user_id (follower), user_login, user_name, broadcaster_user_id (streamer), followed_at }
 */
export function normalizeChannelFollow(event: Record<string, unknown>): TwitchNormalizedEvent {
  const followedAt = (event.followed_at as string) || new Date().toISOString();
  return {
    kind: "channel.follow",
    userId: String(event.user_id ?? ""),
    userLogin: typeof event.user_login === "string" ? event.user_login : undefined,
    userName: typeof event.user_name === "string" ? event.user_name : undefined,
    broadcasterUserId: typeof event.broadcaster_user_id === "string" ? event.broadcaster_user_id : undefined,
    at: followedAt,
    raw: event,
  };
}

export function normalizeEventSubEvent(subscriptionType: string, event: Record<string, unknown>): TwitchNormalizedEvent | null {
  switch (subscriptionType) {
    case "channel.follow":
      return normalizeChannelFollow(event);
    default:
      return null;
  }
}
