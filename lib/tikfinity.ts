/**
 * TikFinity webhook handling: gift name → RustMaxxTikTrigger action mapping.
 * Used by the webhook endpoint and by the admin action-maps API.
 */

/** Actions supported by RustMaxxTikTrigger plugin (must match plugin whitelist). */
export const TIKTRIGGER_ACTIONS = [
  "test",
  "rose",
  "smoke",
  "fireworks",
  "npcwave",
  "wolf",
] as const;

export type TikTriggerAction = (typeof TIKTRIGGER_ACTIONS)[number];

/** Default gift name → action. Admins see this in the dashboard; TikFinity webhook uses it. */
export const DEFAULT_GIFT_TO_ACTION: Record<string, TikTriggerAction> = {
  Rose: "rose",
  Roses: "rose",
  "Smoke Signal": "smoke",
  Smoke: "smoke",
  Firework: "fireworks",
  Fireworks: "fireworks",
  Galaxy: "npcwave",
  "Galaxy Gift": "npcwave",
  Puppy: "wolf",
  "Puppy Kisses": "wolf",
  Wolf: "wolf",
  "Finger Heart": "smoke",
  FingerHeart: "smoke",
  Test: "test",
};

/** Human-readable description and example gifts for each action (for admin UI). */
export const ACTION_META: Record<
  TikTriggerAction,
  { description: string; exampleGifts: string[] }
> = {
  test: {
    description: "Test event (chat only)",
    exampleGifts: ["Test"],
  },
  rose: {
    description: "Thank viewer in chat",
    exampleGifts: ["Rose", "Roses"],
  },
  smoke: {
    description: "Spawn smoke effect at streamer",
    exampleGifts: ["Smoke", "Smoke Signal", "Finger Heart"],
  },
  fireworks: {
    description: "Spawn fireworks effect at streamer",
    exampleGifts: ["Firework", "Fireworks"],
  },
  npcwave: {
    description: "Spawn scientist NPC near streamer",
    exampleGifts: ["Galaxy", "Galaxy Gift"],
  },
  wolf: {
    description: "Spawn wolf near streamer",
    exampleGifts: ["Puppy", "Puppy Kisses", "Wolf"],
  },
};

export function getActionForGift(giftName: string): TikTriggerAction | null {
  if (!giftName || typeof giftName !== "string") return null;
  const key = giftName.trim();
  if (!key) return null;
  const exact = DEFAULT_GIFT_TO_ACTION[key];
  if (exact) return exact;
  const lower = key.toLowerCase();
  for (const [gift, action] of Object.entries(DEFAULT_GIFT_TO_ACTION)) {
    if (gift.toLowerCase() === lower) return action as TikTriggerAction;
  }
  return null;
}

/** Normalize TikFinity webhook body to viewerName + giftName. */
export function normalizeWebhookPayload(body: unknown): {
  viewerName: string;
  giftName: string;
} | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const viewerName =
    typeof o.viewerName === "string"
      ? o.viewerName.trim()
      : typeof o.viewer_name === "string"
        ? o.viewer_name.trim()
        : typeof o.userName === "string"
          ? o.userName.trim()
          : typeof o.user_name === "string"
            ? o.user_name.trim()
            : typeof o.nickname === "string"
              ? o.nickname.trim()
              : "Viewer";
  const giftName =
    typeof o.giftName === "string"
      ? o.giftName.trim()
      : typeof o.gift_name === "string"
        ? o.gift_name.trim()
        : typeof o.gift === "string"
          ? o.gift.trim()
          : "";
  if (!giftName) return null;
  return { viewerName: viewerName || "Viewer", giftName };
}

export function getAvailableActionsForAdmin(): {
  action: TikTriggerAction;
  description: string;
  exampleGifts: string[];
}[] {
  return TIKTRIGGER_ACTIONS.map((action) => ({
    action,
    description: ACTION_META[action].description,
    exampleGifts: ACTION_META[action].exampleGifts,
  }));
}

export function getGiftToActionMapForAdmin(): Record<string, string> {
  return { ...DEFAULT_GIFT_TO_ACTION };
}
