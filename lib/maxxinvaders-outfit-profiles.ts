/**
 * Named outfit overrides for MaxxInvaders → RoamingNPCs (wear pipe only).
 * Same spawn path and AI as the Roaming template; only Wear.items are replaced when non-null.
 * Add keys here to expose new TikFinity / webhook profiles (e.g. santa, hazmat).
 */
export const MAXX_INVADERS_OUTFIT_PROFILES: Record<string, string | null> = {
  /** Template JSON clothes only (e.g. streamer_patrol default). */
  default: null,
  /** Alias of default — useful for TikFinity labels (“crew look”). */
  crew: null,
  bunny1: "attire.bunny.onesie|attire.bunnyears",
};

/** Backward-compatible export for scripts and docs that referenced the bunny pipe directly. */
export const MAXX_INVADERS_BUNNY_WEAR_PIPE =
  MAXX_INVADERS_OUTFIT_PROFILES.bunny1 ?? "attire.bunny.onesie|attire.bunnyears";

export function sanitizeWearPipeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._|]/g, "");
}

/**
 * Resolve an outfit id or raw pipe string to the RCON wear argument.
 * - Named profiles: lowercase keys in MAXX_INVADERS_OUTFIT_PROFILES.
 * - Raw pipe: any value containing `|` is sanitized and passed through.
 * - Unknown names: null wear (template clothes); caller may log.
 */
export function resolveRoamingWearPipeForOutfit(outfitId: string): {
  wearPipe: string | null;
  resolvedId: string;
  knownProfile: boolean;
} {
  const raw = outfitId.trim();
  if (!raw) {
    return { wearPipe: null, resolvedId: "default", knownProfile: true };
  }
  if (raw.includes("|")) {
    const cleaned = sanitizeWearPipeSegment(raw);
    return {
      wearPipe: cleaned.length > 0 ? cleaned : null,
      resolvedId: "custom",
      knownProfile: true,
    };
  }
  const key = raw.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MAXX_INVADERS_OUTFIT_PROFILES, key)) {
    return {
      wearPipe: MAXX_INVADERS_OUTFIT_PROFILES[key] ?? null,
      resolvedId: key,
      knownProfile: true,
    };
  }
  return { wearPipe: null, resolvedId: key, knownProfile: false };
}

/** Human-readable list for admin UI / docs (keep in sync with MAXX_INVADERS_OUTFIT_PROFILES). */
export const MAXX_INVADERS_OUTFIT_PROFILE_DOCS: {
  id: string;
  wearPipe: string | null;
  note: string;
}[] = [
  {
    id: "default",
    wearPipe: null,
    note: "Use Roaming template wear only (normal streamer_patrol look).",
  },
  {
    id: "crew",
    wearPipe: null,
    note: "Same as default — label for “crew” outfits in TikFinity.",
  },
  {
    id: "bunny1",
    wearPipe: "attire.bunny.onesie|attire.bunnyears",
    note: "Bunny onesie + ears (same as bunny1npc action).",
  },
];
