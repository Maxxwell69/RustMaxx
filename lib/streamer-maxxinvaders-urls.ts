/**
 * TikFinity webhook query presets for MaxxInvaders / Roaming viewer bots (streamer per-hook URLs).
 */

export type MaxxPresetGroup = "templates" | "outfits" | "characters";

export type StreamerMaxxPreset = {
  id: string;
  /** Groups rows under a heading on the streamer dashboard */
  group: MaxxPresetGroup;
  /** Short label in the copy UI */
  label: string;
  /** Optional subtext under the label */
  hint?: string;
  params: Record<string, string>;
};

/** Section order and titles on /streamer → Viewer bots */
export const MAXX_GROUP_ORDER: MaxxPresetGroup[] = [
  "templates",
  "outfits",
  "characters",
];

export const MAXX_GROUP_TITLE: Record<MaxxPresetGroup, string> = {
  templates: "Templates — patrol & jobs",
  outfits: "Outfits",
  characters: "Character shortcuts",
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
 * MaxxInvaders-related TikFinity lines — same webhook base as Game servers; query params vary.
 */
export const STREAMER_MAXXINVADERS_URL_PRESETS: StreamerMaxxPreset[] = [
  {
    id: "maxx-default",
    group: "templates",
    label: "Default patrol",
    hint: "Server default Roaming template (often streamer_patrol).",
    params: { action: "maxxinvaders" },
  },
  {
    id: "maxx-patrol",
    group: "templates",
    label: "Patrol (streamer_patrol)",
    params: { action: "maxxinvaders", template: "streamer_patrol" },
  },
  {
    id: "maxx-medic",
    group: "templates",
    label: "Field medic",
    hint: "Use action maxxinvaders on streamer allowlists.",
    params: { action: "maxxinvaders", template: "streamer_medic" },
  },
  {
    id: "maxx-miner",
    group: "templates",
    label: "Miner kit",
    params: { action: "maxxinvaders", template: "streamer_miner" },
  },
  {
    id: "maxx-lumberjack",
    group: "templates",
    label: "Lumberjack kit",
    params: { action: "maxxinvaders", template: "streamer_lumberjack" },
  },
  {
    id: "outfit-default",
    group: "outfits",
    label: "Template clothes",
    params: { action: "maxxinvaders", outfit: "default" },
  },
  {
    id: "outfit-crew",
    group: "outfits",
    label: "Crew look",
    params: { action: "maxxinvaders", outfit: "crew" },
  },
  {
    id: "outfit-bunny1",
    group: "outfits",
    label: "Bunny",
    params: { action: "maxxinvaders", outfit: "bunny1" },
  },
  {
    id: "outfit-gingy",
    group: "outfits",
    label: "Gingerbread",
    params: { action: "maxxinvaders", outfit: "gingy" },
  },
  {
    id: "outfit-egg",
    group: "outfits",
    label: "Egg",
    params: { action: "maxxinvaders", outfit: "egg" },
  },
  {
    id: "outfit-vamp",
    group: "outfits",
    label: "Vamp",
    params: { action: "maxxinvaders", outfit: "vamp" },
  },
  {
    id: "bunny1npc",
    group: "characters",
    label: "Bunny NPC pack",
    hint: "Patrol + bunny outfit profile.",
    params: { action: "bunny1npc" },
  },
  {
    id: "gingynpc",
    group: "characters",
    label: "Gingerbread NPC",
    params: { action: "gingynpc" },
  },
  {
    id: "eggnpc",
    group: "characters",
    label: "Egg NPC",
    params: { action: "eggnpc" },
  },
  {
    id: "vampnpc",
    group: "characters",
    label: "Vamp NPC",
    params: { action: "vampnpc" },
  },
];
