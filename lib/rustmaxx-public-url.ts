/**
 * Canonical production hostname for admin copy, docs, and fallbacks when APP_URL is unset.
 * Use **www** — TikFinity and OAuth must use the same host as production (apex vs www differ).
 */
export const RUSTMAXX_ORIGIN = "https://www.rustmaxx.com";

export function rustmaxxTikfinityWebhookUrl(): string {
  return `${RUSTMAXX_ORIGIN}/api/tikfinity/webhook`;
}

/**
 * If `APP_URL` is apex `https://rustmaxx.com`, rewrite to `https://www.rustmaxx.com` for TikFinity webhooks.
 * Other hosts pass through unchanged (custom domains, localhost not returned from env).
 */
export function canonicalizeRustmaxxOriginForTikfinity(origin: string): string {
  const trimmed = origin.replace(/\/$/, "");
  try {
    const u = new URL(trimmed);
    if (u.hostname.toLowerCase() === "rustmaxx.com") {
      return "https://www.rustmaxx.com";
    }
    return u.origin;
  } catch {
    return trimmed;
  }
}

/** Same www rule for full webhook URLs (safe for client admin copy UI). */
export function normalizeTikfinityWebhookUrlForDisplay(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== "rustmaxx.com") return url;
    u.hostname = "www.rustmaxx.com";
    return u.toString();
  } catch {
    return url;
  }
}
