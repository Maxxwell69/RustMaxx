/**
 * Canonical production hostname for admin copy, docs, and fallbacks when APP_URL is unset.
 * Use **www** — TikFinity and some clients expect the same host as production (apex vs www must match APP_URL).
 */
export const RUSTMAXX_ORIGIN = "https://www.rustmaxx.com";

export function rustmaxxTikfinityWebhookUrl(): string {
  return `${RUSTMAXX_ORIGIN}/api/tikfinity/webhook`;
}
