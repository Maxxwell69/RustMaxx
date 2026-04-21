/**
 * TikFinity webhook query presets for MaxxInvaders / Roaming viewer bots (streamer per-hook URLs).
 * Token is always first in the query string for readability.
 */

export type StreamerMaxxPreset = {
  id: string;
  label: string;
  /** Short hint for the dashboard row. */
  hint?: string;
  params: Record<string, string>;
};

/** True if we can build TikFinity URLs (opaque path, or legacy path with token). */
export function canBuildStreamerHookUrl(
  webhookBase: string | null | undefined,
  token: string | null | undefined
): boolean {
  const b = (webhookBase ?? "").trim();
  if (!b) return false;
  if (webhookBaseUsesOpaqueSecret(b)) return true;
  return Boolean((token ?? "").trim());
}

/**
 * True when the webhook base URL uses the opaque 64-hex path segment (secret in URL; no ?token=).
 */
export function webhookBaseUsesOpaqueSecret(webhookBase: string): boolean {
  const s = webhookBase.trim();
  if (!s) return false;
  try {
    const u = new URL(s, "https://example.com");
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    return /^[a-f0-9]{64}$/i.test(last);
  } catch {
    const last = s.split("/").filter(Boolean).pop() ?? "";
    return /^[a-f0-9]{64}$/i.test(last);
  }
}

/**
 * Build query string for TikFinity. Opaque URLs skip `token=`; legacy UUID paths require token.
 */
export function buildStreamerHookQueryUrl(
  webhookBase: string,
  token: string | null,
  params: Record<string, string>
): string {
  const parts: string[] = [];
  if (!webhookBaseUsesOpaqueSecret(webhookBase)) {
    if (!token) {
      throw new Error("token required for legacy webhook URL");
    }
    parts.push(`token=${encodeURIComponent(token)}`);
  }
  for (const [k, v] of Object.entries(params)) {
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.length ? `${webhookBase}?${parts.join("&")}` : webhookBase;
}

const STEAM64_RE = /^\d{17}$/;

/**
 * Adds `anchorSteam` so TikFinity paste-in URLs match resolveMaxxInvadersAnchorSteam (query wins over Profile DB).
 * Call with Profile Steam64 from streamer state when building dashboard URLs.
 */
export function mergePresetParamsWithProfileAnchor(
  presetParams: Record<string, string>,
  profileSteam64: string | null | undefined
): Record<string, string> {
  const id = typeof profileSteam64 === "string" ? profileSteam64.trim() : "";
  if (!STEAM64_RE.test(id)) return { ...presetParams };
  return { ...presetParams, anchorSteam: id };
}

/**
 * All common MaxxInvaders-related setups for TikFinity “Trigger Webhook”.
 * Same hook base URL + secret as “Game servers & webhooks”; only query params differ.
 */
export const STREAMER_MAXXINVADERS_URL_PRESETS: StreamerMaxxPreset[] = [
  {
    id: "maxx-default",
    label: "MaxxInvaders — default patrol",
    hint: "Uses dashboard / env default Roaming template (usually streamer_patrol).",
    params: { action: "maxxinvaders" },
  },
  {
    id: "maxx-patrol",
    label: "MaxxInvaders — template streamer_patrol",
    params: { action: "maxxinvaders", template: "streamer_patrol" },
  },
  {
    id: "maxx-medic",
    label: "MaxxInvaders — template streamer_medic (field medic)",
    hint: "Use ?action=maxxinvaders (not npcmaxx) for streamer TikFinity allowlists.",
    params: { action: "maxxinvaders", template: "streamer_medic" },
  },
  {
    id: "maxx-miner",
    label: "MaxxInvaders — template streamer_miner (Kick hazmat + backpack + ore)",
    params: { action: "maxxinvaders", template: "streamer_miner" },
  },
  {
    id: "maxx-lumberjack",
    label: "MaxxInvaders — template streamer_lumberjack (Lumberjack hazmat + chainsaw)",
    params: { action: "maxxinvaders", template: "streamer_lumberjack" },
  },
  {
    id: "outfit-default",
    label: "MaxxInvaders — outfit default (template clothes)",
    params: { action: "maxxinvaders", outfit: "default" },
  },
  {
    id: "outfit-crew",
    label: "MaxxInvaders — outfit crew",
    params: { action: "maxxinvaders", outfit: "crew" },
  },
  {
    id: "outfit-bunny1",
    label: "MaxxInvaders — outfit bunny1",
    params: { action: "maxxinvaders", outfit: "bunny1" },
  },
  {
    id: "outfit-gingy",
    label: "MaxxInvaders — outfit gingy",
    params: { action: "maxxinvaders", outfit: "gingy" },
  },
  {
    id: "outfit-egg",
    label: "MaxxInvaders — outfit egg",
    params: { action: "maxxinvaders", outfit: "egg" },
  },
  {
    id: "outfit-vamp",
    label: "MaxxInvaders — outfit vamp",
    params: { action: "maxxinvaders", outfit: "vamp" },
  },
  {
    id: "bunny1npc",
    label: "Action bunny1npc (patrol + bunny wear)",
    hint: "Same spawn engine; fixed bunny outfit profile.",
    params: { action: "bunny1npc" },
  },
  {
    id: "gingynpc",
    label: "Action gingynpc",
    params: { action: "gingynpc" },
  },
  {
    id: "eggnpc",
    label: "Action eggnpc",
    params: { action: "eggnpc" },
  },
  {
    id: "vampnpc",
    label: "Action vampnpc",
    params: { action: "vampnpc" },
  },
];
