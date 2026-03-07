/**
 * Twitch-related DB operations: accounts, links, rules, event logs.
 * Token storage uses encryption; callers never see raw tokens.
 */

import { query } from "@/lib/db";
import { encrypt, decryptSafe } from "@/lib/encryption";

export type TwitchAccountRow = {
  id: string;
  user_id: string;
  twitch_user_id: string;
  twitch_login: string | null;
  twitch_display_name: string | null;
  linked_at: Date;
  updated_at: Date;
};

export type EventRuleRow = {
  id: string;
  user_id: string;
  server_id: string | null;
  event_kind: string;
  action_id: string;
  action_params: Record<string, unknown> | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
};

export type EventLogRow = {
  id: string;
  user_id: string | null;
  event_kind: string;
  twitch_message_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
};

export async function getTwitchAccountByUserId(userId: string): Promise<(TwitchAccountRow & { has_tokens: boolean }) | null> {
  const { rows } = await query<TwitchAccountRow & { access_token_encrypted: string | null }>(
    "SELECT id, user_id, twitch_user_id, twitch_login, twitch_display_name, linked_at, updated_at, access_token_encrypted FROM twitch_accounts WHERE user_id = $1",
    [userId]
  );
  const row = rows[0];
  if (!row) return null;
  const { access_token_encrypted, ...rest } = row;
  return { ...rest, has_tokens: !!access_token_encrypted };
}

export async function getTwitchAccountByTwitchUserId(twitchUserId: string): Promise<TwitchAccountRow | null> {
  const { rows } = await query<TwitchAccountRow>(
    "SELECT id, user_id, twitch_user_id, twitch_login, twitch_display_name, linked_at, updated_at FROM twitch_accounts WHERE twitch_user_id = $1",
    [twitchUserId]
  );
  return rows[0] ?? null;
}

export async function upsertTwitchAccount(
  userId: string,
  twitchUserId: string,
  twitchLogin: string,
  twitchDisplayName: string,
  accessToken: string,
  refreshToken: string
): Promise<TwitchAccountRow> {
  const accessEnc = encrypt(accessToken);
  const refreshEnc = encrypt(refreshToken);
  await query(
    `INSERT INTO twitch_accounts (user_id, twitch_user_id, twitch_login, twitch_display_name, access_token_encrypted, refresh_token_encrypted, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (user_id) DO UPDATE SET
       twitch_user_id = EXCLUDED.twitch_user_id,
       twitch_login = EXCLUDED.twitch_login,
       twitch_display_name = EXCLUDED.twitch_display_name,
       access_token_encrypted = EXCLUDED.access_token_encrypted,
       refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
       updated_at = now()`,
    [userId, twitchUserId, twitchLogin, twitchDisplayName, accessEnc, refreshEnc]
  );
  const { rows } = await query<TwitchAccountRow>(
    "SELECT id, user_id, twitch_user_id, twitch_login, twitch_display_name, linked_at, updated_at FROM twitch_accounts WHERE user_id = $1",
    [userId]
  );
  if (!rows[0]) throw new Error("Upsert twitch_accounts failed");
  return rows[0];
}

/** Get decrypted access token for API calls; refresh if needed (caller can implement refresh). */
export async function getAccessTokenForUser(userId: string): Promise<string | null> {
  const { rows } = await query<{ access_token_encrypted: string; refresh_token_encrypted: string }>(
    "SELECT access_token_encrypted, refresh_token_encrypted FROM twitch_accounts WHERE user_id = $1",
    [userId]
  );
  const row = rows[0];
  if (!row) return null;
  return decryptSafe(row.access_token_encrypted);
}

export async function getRefreshTokenForUser(userId: string): Promise<string | null> {
  const { rows } = await query<{ refresh_token_encrypted: string }>(
    "SELECT refresh_token_encrypted FROM twitch_accounts WHERE user_id = $1",
    [userId]
  );
  const row = rows[0];
  if (!row) return null;
  return decryptSafe(row.refresh_token_encrypted);
}

export async function updateTwitchTokens(userId: string, accessToken: string, refreshToken: string): Promise<void> {
  const accessEnc = encrypt(accessToken);
  const refreshEnc = encrypt(refreshToken);
  await query(
    "UPDATE twitch_accounts SET access_token_encrypted = $1, refresh_token_encrypted = $2, updated_at = now() WHERE user_id = $3",
    [accessEnc, refreshEnc, userId]
  );
}

export async function getEventRulesForUser(userId: string): Promise<EventRuleRow[]> {
  const { rows } = await query<EventRuleRow>(
    "SELECT id, user_id, server_id, event_kind, action_id, action_params, enabled, created_at, updated_at FROM event_rules WHERE user_id = $1 AND enabled = true",
    [userId]
  );
  return rows;
}

export async function getStreamerLinkedServerIds(userId: string): Promise<string[]> {
  const { rows } = await query<{ server_id: string }>(
    "SELECT server_id FROM streamer_server_links WHERE user_id = $1",
    [userId]
  );
  return rows.map((r) => r.server_id);
}

export async function insertEventLog(
  userId: string | null,
  eventKind: string,
  twitchMessageId: string | null,
  payload: Record<string, unknown>
): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO event_logs (user_id, event_kind, twitch_message_id, payload) VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [userId, eventKind, twitchMessageId, JSON.stringify(payload)]
  );
  if (!rows[0]) throw new Error("Insert event_logs failed");
  return rows[0].id;
}

/** Returns true if we already have an event with this message id (dedup). */
export async function hasEventByTwitchMessageId(twitchMessageId: string): Promise<boolean> {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM event_logs WHERE twitch_message_id = $1 LIMIT 1",
    [twitchMessageId]
  );
  return rows.length > 0;
}

export async function getRecentEventLogs(limit: number, userId?: string | null): Promise<EventLogRow[]> {
  if (userId) {
    const { rows } = await query<EventLogRow>(
      "SELECT id, user_id, event_kind, twitch_message_id, payload, created_at FROM event_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
      [userId, limit]
    );
    return rows;
  }
  const { rows } = await query<EventLogRow>(
    "SELECT id, user_id, event_kind, twitch_message_id, payload, created_at FROM event_logs ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
  return rows;
}

export async function addEventRule(
  userId: string,
  serverId: string | null,
  eventKind: string,
  actionId: string,
  actionParams: Record<string, unknown> | null
): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO event_rules (user_id, server_id, event_kind, action_id, action_params) VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, serverId, eventKind, actionId, actionParams ? JSON.stringify(actionParams) : null]
  );
  if (!rows[0]) throw new Error("Insert event_rules failed");
  return rows[0].id;
}

export async function addStreamerServerLink(userId: string, serverId: string): Promise<void> {
  await query(
    "INSERT INTO streamer_server_links (user_id, server_id) VALUES ($1, $2) ON CONFLICT (user_id, server_id) DO NOTHING",
    [userId, serverId]
  );
}
