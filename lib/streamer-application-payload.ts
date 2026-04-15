import type { StreamerApplicationInput } from "./streamer-applications";

const L = {
  name: 200,
  url: 2048,
  discord: 120,
  short: 500,
  long: 4000,
};

function trimStr(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function optionalUrl(v: unknown): string | null {
  let t = trimStr(v, L.url);
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) {
    t = `https://${t}`;
  }
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function optionalText(v: unknown, max: number): string | null {
  const t = trimStr(v, max);
  return t.length ? t : null;
}

/**
 * Validates JSON body for streamer application. Requires public stream name + fit copy;
 * requires at least one discoverable social (URL or other_socials text). No government-name field.
 */
export function parseStreamerApplicationPayload(
  body: unknown
): { ok: true; data: StreamerApplicationInput } | { ok: false; error: string } {
  if (body === null || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON" };
  }
  const b = body as Record<string, unknown>;

  const preferred_stream_name = trimStr(b.preferred_stream_name, L.name);
  const content_summary = trimStr(b.content_summary, L.long);
  const why_rustmaxx = trimStr(b.why_rustmaxx, L.long);

  if (preferred_stream_name.length < 2)
    return { ok: false, error: "Enter the name you use on stream." };
  /** DB column kept for compatibility; we do not collect government name—mirror public stream name. */
  const legal_name = preferred_stream_name;
  if (content_summary.length < 20)
    return { ok: false, error: "Describe what you stream (at least a few sentences)." };
  if (why_rustmaxx.length < 20)
    return { ok: false, error: "Tell us why RustMaxx is a good fit (at least a few sentences)." };

  const tiktok_url = optionalUrl(b.tiktok_url);
  const twitch_url = optionalUrl(b.twitch_url);
  const kick_url = optionalUrl(b.kick_url);
  const youtube_url = optionalUrl(b.youtube_url);
  const twitter_url = optionalUrl(b.twitter_url);
  const instagram_url = optionalUrl(b.instagram_url);

  const invalidUrl =
    (typeof b.tiktok_url === "string" && b.tiktok_url.trim() && !tiktok_url) ||
    (typeof b.twitch_url === "string" && b.twitch_url.trim() && !twitch_url) ||
    (typeof b.kick_url === "string" && b.kick_url.trim() && !kick_url) ||
    (typeof b.youtube_url === "string" && b.youtube_url.trim() && !youtube_url) ||
    (typeof b.twitter_url === "string" && b.twitter_url.trim() && !twitter_url) ||
    (typeof b.instagram_url === "string" && b.instagram_url.trim() && !instagram_url);

  if (invalidUrl) {
    return { ok: false, error: "Each social URL must be a valid http(s) link." };
  }

  const discord_username = optionalText(b.discord_username, L.discord);
  const other_socials = optionalText(b.other_socials, L.long);
  const avg_live_viewers = optionalText(b.avg_live_viewers, L.short);
  const stream_schedule = optionalText(b.stream_schedule, L.long);

  const hasSocial =
    !!tiktok_url ||
    !!twitch_url ||
    !!kick_url ||
    !!youtube_url ||
    !!twitter_url ||
    !!instagram_url ||
    (other_socials !== null && other_socials.length >= 15);

  if (!hasSocial) {
    return {
      ok: false,
      error:
        "Add at least one profile URL (TikTok recommended) or describe your other socials in the box provided.",
    };
  }

  return {
    ok: true,
    data: {
      legal_name,
      preferred_stream_name,
      tiktok_url,
      twitch_url,
      kick_url,
      youtube_url,
      twitter_url,
      instagram_url,
      discord_username,
      other_socials,
      avg_live_viewers,
      stream_schedule,
      content_summary,
      why_rustmaxx,
    },
  };
}
