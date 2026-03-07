/**
 * Twitch-normalized event types (for event rules and logging).
 * Backend maps Twitch webhook payloads to these normalized shapes.
 */

export type TwitchEventKind =
  | "channel.follow"
  | "channel.subscribe"
  | "channel.cheer"
  | "channel.raid"
  | "channel.reward_redemption"
  | "stream.online"
  | "stream.offline";

export type TwitchNormalizedEvent = {
  kind: TwitchEventKind;
  /** Twitch user/channel IDs */
  userId: string;
  userLogin?: string;
  userName?: string;
  /** For reward redemption: reward id and title */
  rewardId?: string;
  rewardTitle?: string;
  /** For cheer: bits */
  bits?: number;
  /** For subscription: tier */
  tier?: string;
  /** Event timestamp (ISO or unix ms) */
  at: string | number;
  /** Raw payload for logging; avoid using for business logic */
  raw?: Record<string, unknown>;
};

export type TwitchEventRule = {
  id: string;
  serverConnectionId: string;
  eventKind: TwitchEventKind;
  /** Whitelist action id + params */
  actionId: string;
  actionParams?: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
