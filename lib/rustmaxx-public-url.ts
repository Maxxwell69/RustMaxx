/**
 * Canonical production hostname for admin copy, docs, and fallbacks when APP_URL is unset.
 * Matches robots/sitemap defaults and .env.example.
 */
export const RUSTMAXX_ORIGIN = "https://rustmaxx.com";

export function rustmaxxTikfinityWebhookUrl(): string {
  return `${RUSTMAXX_ORIGIN}/api/tikfinity/webhook`;
}
