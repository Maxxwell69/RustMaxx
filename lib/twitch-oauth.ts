/**
 * Twitch OAuth connect flow: auth URL, code exchange, token storage.
 * All Twitch API calls and secrets stay in backend.
 */

const TWITCH_AUTHORIZE = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_TOKEN = "https://id.twitch.tv/oauth2/token";
const TWITCH_VALIDATE = "https://id.twitch.tv/oauth2/validate";
const TWITCH_HELIX_USERS = "https://api.twitch.tv/helix/users";

/** In-memory cache for app access token (client credentials). EventSub requires app token to create webhook subscriptions. */
let appTokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Get an app access token via client_credentials. Cached until ~5 min before expiry.
 * Required by Twitch for creating EventSub webhook subscriptions.
 */
export async function getAppAccessToken(): Promise<string> {
  const now = Date.now();
  if (appTokenCache && appTokenCache.expiresAt > now + 5 * 60 * 1000) {
    return appTokenCache.token;
  }
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must be set");

  const res = await fetch(TWITCH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }).toString(),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Twitch app token failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  appTokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in - 300) * 1000, // refresh 5 min early
  };
  return appTokenCache.token;
}

const SCOPES = ["user:read:email", "channel:read:subscriptions", "channel:bot"].join(" ");

export function getTwitchAuthUrl(redirectUri: string, state: string): string {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) throw new Error("TWITCH_CLIENT_ID is not set");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
  });
  return `${TWITCH_AUTHORIZE}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must be set");

  const res = await fetch(TWITCH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Twitch token exchange failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return data;
}

export async function getTwitchUserFromToken(accessToken: string): Promise<{
  id: string;
  login: string;
  display_name: string;
}> {
  const res = await fetch(TWITCH_HELIX_USERS, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": process.env.TWITCH_CLIENT_ID!,
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Twitch user fetch failed: ${res.status} ${t}`);
  }
  const json = (await res.json()) as { data: Array<{ id: string; login: string; display_name: string }> };
  const user = json.data?.[0];
  if (!user) throw new Error("Twitch user not found");
  return user;
}

export async function refreshTwitchToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must be set");

  const res = await fetch(TWITCH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Twitch token refresh failed: ${res.status} ${t}`);
  }
  return (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
}
