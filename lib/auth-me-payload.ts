import { toProfile, type UserRow, type UserProfile } from "./users";
import { fetchSteamPlayerSummary } from "./steam-web-api";

export type AuthMeSteam = {
  steamId: string;
  personaName: string | null;
  profileUrl: string;
  avatarUrl: string | null;
  linkedAt: string | null;
};

export type AuthMePayload = UserProfile & {
  steam: AuthMeSteam | null;
  last_login_at: string | null;
  streamer_directory_visible: boolean;
  streamer_directory_avatar_url: string | null;
  streamer_directory_bio: string | null;
};

export async function buildAuthMePayload(user: UserRow): Promise<AuthMePayload> {
  const base = toProfile(user);

  let steam: AuthMeSteam | null = null;
  if (user.steam_id) {
    const summary = await fetchSteamPlayerSummary(user.steam_id);
    const fallbackProfile = `https://steamcommunity.com/profiles/${user.steam_id}`;
    steam = {
      steamId: user.steam_id,
      personaName: summary?.personaName ?? null,
      profileUrl: summary?.profileUrl ?? fallbackProfile,
      avatarUrl: summary?.avatarUrl ? summary.avatarUrl : null,
      linkedAt:
        user.steam_linked_at == null
          ? null
          : user.steam_linked_at instanceof Date
            ? user.steam_linked_at.toISOString()
            : typeof user.steam_linked_at === "string"
              ? user.steam_linked_at
              : null,
    };
  }

  const lastLogin =
    user.last_login_at == null
      ? null
      : user.last_login_at instanceof Date
        ? user.last_login_at.toISOString()
        : typeof user.last_login_at === "string"
          ? user.last_login_at
          : null;

  return {
    ...base,
    steam,
    last_login_at: lastLogin,
    streamer_directory_visible: user.streamer_directory_visible === true,
    streamer_directory_avatar_url: user.streamer_directory_avatar_url ?? null,
    streamer_directory_bio: user.streamer_directory_bio ?? null,
  };
}
