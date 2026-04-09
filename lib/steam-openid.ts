/**
 * Steam OpenID 2.0 (lightweight): redirect to Steam, verify callback via check_authentication.
 * Docs: https://steamcommunity.com/dev
 */

const STEAM_OPENID = "https://steamcommunity.com/openid/login";

function appOrigin(): string | null {
  const u = process.env.APP_URL?.trim() ?? process.env.SITE_URL?.trim();
  if (!u) return null;
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}

export function steamOpenIdRedirectUrl(): string | null {
  const origin = appOrigin();
  if (!origin) return null;
  const returnTo = `${origin}/api/auth/steam/callback`;
  const p = new URLSearchParams();
  p.set("openid.ns", "http://specs.openid.net/auth/2.0");
  p.set("openid.mode", "checkid_setup");
  p.set("openid.return_to", returnTo);
  p.set("openid.realm", origin);
  p.set("openid.identity", "http://specs.openid.net/auth/2.0/identifier_select");
  p.set("openid.claimed_id", "http://specs.openid.net/auth/2.0/identifier_select");
  return `${STEAM_OPENID}?${p.toString()}`;
}

/** After Steam redirects back, validate and return Steam64 (17 digits) or null. */
export async function verifySteamOpenIdCallback(
  searchParams: URLSearchParams
): Promise<string | null> {
  const mode = searchParams.get("openid.mode");
  if (mode !== "id_res") return null;

  const claimed = searchParams.get("openid.claimed_id") ?? "";
  const params = new URLSearchParams();
  params.set("openid.ns", "http://specs.openid.net/auth/2.0");
  params.set("openid.mode", "check_authentication");
  for (const [k, v] of searchParams) {
    if (k.startsWith("openid.")) params.set(k, v);
  }

  const r = await fetch(STEAM_OPENID, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const text = await r.text();
  if (!/is_valid\s*:\s*true/i.test(text)) return null;

  const m = claimed.match(/\/(\d{17})$/);
  return m?.[1] ?? null;
}
