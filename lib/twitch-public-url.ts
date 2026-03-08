/**
 * Public base URL for Twitch OAuth redirects. Uses only env vars—never request.url—
 * so redirects never point to localhost when the app runs behind a proxy.
 */

function getPublicOrigin(): string | null {
  const redirectUri = process.env.TWITCH_REDIRECT_URI?.trim();
  if (redirectUri && !redirectUri.includes("localhost") && !redirectUri.includes("127.0.0.1")) {
    try {
      const u = new URL(redirectUri);
      return u.origin;
    } catch {
      //
    }
  }
  const appUrl = process.env.APP_URL?.trim() || process.env.SITE_URL?.trim();
  if (appUrl) {
    const base = appUrl.replace(/\/$/, "");
    if (!base.includes("localhost") && !base.includes("127.0.0.1")) return base;
  }
  return null;
}

/** Public profile URL (e.g. https://www.rustmaxx.com/profile). Use for redirects so users never land on localhost. */
export function getPublicProfileUrl(path = "/profile"): string | null {
  const origin = getPublicOrigin();
  if (!origin) return null;
  try {
    return new URL(path, origin).href;
  } catch {
    return null;
  }
}

/** Public origin (e.g. https://www.rustmaxx.com). */
export function getPublicOriginOrNull(): string | null {
  return getPublicOrigin();
}
