/**
 * Optional: Steam Web API (GetPlayerSummaries) for persona name + avatar on profile.
 * Set STEAM_WEB_API_KEY in env — https://steamcommunity.com/dev/apikey
 */

export type SteamPlayerSummary = {
  personaName: string;
  profileUrl: string;
  avatarUrl: string;
};

export async function fetchSteamPlayerSummary(
  steamId64: string
): Promise<SteamPlayerSummary | null> {
  const key = process.env.STEAM_WEB_API_KEY?.trim();
  if (!key || !/^\d{17}$/.test(steamId64)) return null;

  const url = new URL(
    "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/"
  );
  url.searchParams.set("key", key);
  url.searchParams.set("steamids", steamId64);

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      response?: { players?: Array<Record<string, string>> };
    };
    const p = data.response?.players?.[0];
    if (!p) return null;
    const personaName = p.personaname ?? "Steam user";
    const profileUrl = p.profileurl ?? `https://steamcommunity.com/profiles/${steamId64}`;
    const avatarUrl =
      p.avatarfull || p.avatarmedium || p.avatar || "";
    return {
      personaName,
      profileUrl,
      avatarUrl: avatarUrl || "",
    };
  } catch {
    return null;
  }
}
