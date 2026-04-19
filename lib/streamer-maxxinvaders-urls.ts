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

/** Build `?token=…&…` with stable ordering (token first). */
export function buildStreamerHookQueryUrl(
  webhookBase: string,
  token: string,
  params: Record<string, string>
): string {
  const parts: string[] = [`token=${encodeURIComponent(token)}`];
  for (const [k, v] of Object.entries(params)) {
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return `${webhookBase}?${parts.join("&")}`;
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
    params: { action: "maxxinvaders", template: "streamer_medic" },
  },
  {
    id: "npc-patrol",
    label: "Roaming NPC — npcmaxx + streamer_patrol",
    hint: "NPCMaxx.spawn path; often routed to MaxxInvaders on streamer servers.",
    params: { action: "npcmaxx", template: "streamer_patrol" },
  },
  {
    id: "npc-medic",
    label: "Roaming NPC — npcmaxx + streamer_medic",
    params: { action: "npcmaxx", template: "streamer_medic" },
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
