/** Keys aligned with streamer_applications + profile form. */
export const DIRECTORY_SOCIAL_KEYS = [
  "tiktok_url",
  "twitch_url",
  "kick_url",
  "youtube_url",
  "twitter_url",
  "instagram_url",
  "discord_username",
  "other_socials",
] as const;

export type DirectorySocialKey = (typeof DIRECTORY_SOCIAL_KEYS)[number];

export type ApplicationSocialFields = Partial<
  Record<
    | "tiktok_url"
    | "twitch_url"
    | "kick_url"
    | "youtube_url"
    | "twitter_url"
    | "instagram_url"
    | "discord_username"
    | "other_socials",
    string | null
  >
>;

export const DIRECTORY_SOCIAL_LABELS: Record<DirectorySocialKey, string> = {
  tiktok_url: "TikTok",
  twitch_url: "Twitch",
  kick_url: "Kick",
  youtube_url: "YouTube",
  twitter_url: "X / Twitter",
  instagram_url: "Instagram",
  discord_username: "Discord",
  other_socials: "Other links",
};

export type PublicSocialEntry = {
  key: DirectorySocialKey;
  label: string;
  /** "link" for http(s), "text" for discord / other plain text */
  type: "link" | "text";
  value: string;
};

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Normalize JSON from DB or API into string record (only known keys, non-empty). */
export function coerceDirectorySocialsFromDb(raw: unknown): Record<string, string> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const key of DIRECTORY_SOCIAL_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t) out[key] = t;
  }
  return out;
}

/**
 * Validates PATCH body for streamer_directory_socials (replace whole object).
 * Returns only non-empty strings; empty string clears override for that field.
 */
export function parseDirectorySocialOverrides(
  input: unknown
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  if (input == null) return { ok: true, value: {} };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "streamer_directory_socials must be an object" };
  }
  const src = input as Record<string, unknown>;
  for (const k of Object.keys(src)) {
    if (!DIRECTORY_SOCIAL_KEYS.includes(k as DirectorySocialKey)) {
      return { ok: false, error: `Unknown social field: ${k}` };
    }
  }
  const out: Record<string, string> = {};
  for (const key of DIRECTORY_SOCIAL_KEYS) {
    if (!(key in src)) continue;
    const v = src[key];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v !== "string") {
      return { ok: false, error: `${key} must be a string or empty` };
    }
    const t = v.trim();
    if (!t) continue;
    if (key === "discord_username") {
      if (t.length > 80) return { ok: false, error: "Discord username is too long" };
      if (/[\n\r\x00-\x08\x0b\x0c\x0e-\x1f]/.test(t)) {
        return { ok: false, error: "Discord username contains invalid characters" };
      }
      out[key] = t;
      continue;
    }
    if (key === "other_socials") {
      if (t.length > 600) return { ok: false, error: "Other socials text is too long" };
      out[key] = t;
      continue;
    }
    if (!isHttpUrl(t)) {
      return { ok: false, error: `${DIRECTORY_SOCIAL_LABELS[key]} URL must start with https:// or http://` };
    }
    if (t.length > 500) return { ok: false, error: `${DIRECTORY_SOCIAL_LABELS[key]} URL is too long` };
    out[key] = t;
  }
  return { ok: true, value: out };
}

function pickMerged(key: DirectorySocialKey, overrides: Record<string, string>, app: ApplicationSocialFields): string | null {
  const o = overrides[key]?.trim();
  if (o) return o;
  const a = app[key];
  if (typeof a === "string" && a.trim()) return a.trim();
  return null;
}

export function buildPublicSocialEntries(
  overrides: Record<string, string>,
  app: ApplicationSocialFields | null
): PublicSocialEntry[] {
  const appSafe = app ?? {};
  const entries: PublicSocialEntry[] = [];
  for (const key of DIRECTORY_SOCIAL_KEYS) {
    const value = pickMerged(key, overrides, appSafe);
    if (!value) continue;
    const type: "link" | "text" =
      key !== "discord_username" && key !== "other_socials" && isHttpUrl(value) ? "link" : "text";
    entries.push({
      key,
      label: DIRECTORY_SOCIAL_LABELS[key],
      type,
      value,
    });
  }
  return entries;
}
