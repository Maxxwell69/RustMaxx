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
      linkedAt: user.steam_linked_at?.toISOString() ?? null,
    };
  }

  return { ...base, steam };
}
