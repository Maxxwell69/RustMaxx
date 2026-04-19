/**
 * TikTok/TikFinity viewer names often include digits; strip them for Rust spawn / RCON display names.
 * Internal viewer ids (e.g. TikTok unique id, anon_* tokens) should not pass through here for the display slot.
 */
export function viewerDisplayNameWithoutDigits(raw: string): string {
  return raw.replace(/\d/g, "");
}
