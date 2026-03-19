/**
 * TikFinity webhook handling: gift name → RustChaos action mapping.
 * Used by the webhook endpoint and by the admin action-maps API.
 */

/** Actions supported by RustChaos plugin (must match plugin whitelist). */
export const TIKTRIGGER_ACTIONS = [
  "test",
  "rose",
  "smoke",
  "fireworks",
  "scientist",
  "wolf",
  "bear",
  "shark",
  "pig",
  "supply",
  "likes",
  "chaos",
  "scientistboat",
  "chaoswave",
  "healinghands",
  "fullheal",
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
  Galaxy: "scientist",
  "Galaxy Gift": "scientist",
  Scientist: "scientist",
  Puppy: "wolf",
  "Puppy Kisses": "wolf",
  Wolf: "wolf",
  Bear: "bear",
  Shark: "shark",
  Pig: "pig",
  "Finger Heart": "smoke",
  FingerHeart: "smoke",
  Test: "test",
  Likes: "likes",
  Like: "likes",
  Supply: "supply",
  "Supply Signal": "supply",
  Chaos: "chaos",
  "Scientist Boat": "scientistboat",
  ScientistBoat: "scientistboat",
  "Chaos Wave": "chaoswave",
  ChaosWave: "chaoswave",
  "Healing Hands": "healinghands",
  HealingHands: "healinghands",
  "Full Health": "fullheal",
  FullHealth: "fullheal",
};

/** Default gift name → TikTok coin value (used when payload has no value/coins field). 1 coin = 1 scrap in-game. */
export const DEFAULT_GIFT_COINS: Record<string, number> = {
  "Puppy Kisses": 299,
  Puppy: 299,
  Rose: 1,
  Roses: 5,
  Galaxy: 999,
  "Galaxy Gift": 999,
  Scientist: 299,
  Bear: 50,
  Shark: 100,
  Pig: 10,
  Wolf: 299,
  "Finger Heart": 1,
  Smoke: 5,
  "Smoke Signal": 10,
  Firework: 50,
  Fireworks: 100,
  Test: 299,
  Likes: 1,
  Like: 1,
  Supply: 1,
  "Supply Signal": 1,
  Chaos: 50,
  "Scientist Boat": 150,
  ScientistBoat: 150,
  "Chaos Wave": 200,
  ChaosWave: 200,
  "Healing Hands": 50,
  HealingHands: 50,
  "Full Health": 75,
  FullHealth: 75,
};

/** Human-readable label and description for each action (for admin UI). */
export const ACTION_META: Record<
  TikTriggerAction,
  { label: string; description: string; exampleGifts: string[] }
> = {
  test: {
    label: "Test",
    description: "Test event (chat only)",
    exampleGifts: ["Test"],
  },
  rose: {
    label: "Rose",
    description: "Thank viewer in chat",
    exampleGifts: ["Rose", "Roses"],
  },
  smoke: {
    label: "Smoke",
    description: "Spawn smoke effect at streamer",
    exampleGifts: ["Smoke", "Smoke Signal", "Finger Heart"],
  },
  fireworks: {
    label: "Fireworks",
    description: "Spawn fireworks effect at streamer",
    exampleGifts: ["Firework", "Fireworks"],
  },
  scientist: {
    label: "Scientist",
    description: "Spawn one scientist behind streamer",
    exampleGifts: ["Galaxy", "Galaxy Gift", "Scientist"],
  },
  wolf: {
    label: "Wolf",
    description: "Spawn wolf near streamer",
    exampleGifts: ["Puppy", "Puppy Kisses", "Wolf"],
  },
  bear: {
    label: "Bear",
    description: "Spawn bear near streamer",
    exampleGifts: ["Bear"],
  },
  shark: {
    label: "Shark",
    description: "Spawn shark near streamer (water)",
    exampleGifts: ["Shark"],
  },
  pig: {
    label: "Pig",
    description: "Spawn pig (boar) near streamer",
    exampleGifts: ["Pig"],
  },
  supply: {
    label: "Supply",
    description: "Call in airdrop at streamer (cargo plane)",
    exampleGifts: ["Supply Signal", "Supply"],
  },
  likes: {
    label: "Likes",
    description: "Call in airdrop at streamer (e.g. from Likes event)",
    exampleGifts: ["Likes", "Like"],
  },
  chaos: {
    label: "Chaos",
    description: "Detects land/sea/swimming and runs timed spawns and effects",
    exampleGifts: ["Chaos"],
  },
  scientistboat: {
    label: "Scientist Boat",
    description: "Spawn scientist RHIB or PT boat (AI + turrets) in water (streamer must be swimming or on boat)",
    exampleGifts: ["Scientist Boat", "ScientistBoat"],
  },
  chaoswave: {
    label: "Chaos Wave",
    description: "Land only: bear wave 1→10 (next wave when all bears killed). Each wave also gives the streamer weapons/meds/walls per your configured rounds; countdowns: 20s after wave1, 25s after wave2, 30s otherwise.",
    exampleGifts: ["Chaos Wave", "ChaosWave"],
  },
  healinghands: {
    label: "Healing Hands",
    description: "Heals the streamer +10 health every trigger",
    exampleGifts: ["Healing Hands", "HealingHands"],
  },
  fullheal: {
    label: "Full Health",
    description: "Heals the streamer to full health",
    exampleGifts: ["Full Health", "FullHealth"],
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

/** Try to get viewer and gift from a plain object (any nesting level). */
function extractFromObject(o: Record<string, unknown>): { viewerName: string; giftName: string } | null {
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
              : typeof o.username === "string"
                ? o.username.trim()
                : typeof o.sender === "string"
                  ? o.sender.trim()
                  : "";
  const giftName =
    typeof o.giftName === "string"
      ? o.giftName.trim()
      : typeof o.gift_name === "string"
        ? o.gift_name.trim()
        : typeof o.gift === "string"
          ? o.gift.trim()
          : typeof o.giftType === "string"
            ? o.giftType.trim()
            : "";
  if (!giftName) return null;
  return { viewerName: viewerName || "Viewer", giftName };
}

/** Normalize TikFinity webhook body to viewerName + giftName. Supports flat and nested payloads. */
export function normalizeWebhookPayload(body: unknown): {
  viewerName: string;
  giftName: string;
} | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;

  // Flat body
  const flat = extractFromObject(o);
  if (flat) return flat;

  // Nested: body.data or body.event or body.payload
  const nested = (o.data ?? o.event ?? o.payload) as Record<string, unknown> | undefined;
  if (nested && typeof nested === "object") {
    const fromNested = extractFromObject(nested as Record<string, unknown>);
    if (fromNested) return fromNested;
  }

  return null;
}

/** Return top-level keys of the body for debug messages (no sensitive values). */
export function getPayloadKeysForDebug(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  return Object.keys(body as Record<string, unknown>);
}

/** Parse gift coin value from payload (TikTok coins → scrap in-game). Checks value, coins, amount, giftValue, etc. */
export function getGiftValueFromPayload(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const o = body as Record<string, unknown>;
  const get = (obj: Record<string, unknown>): number => {
    const v = obj.value ?? obj.coins ?? obj.amount ?? obj.giftValue ?? obj.coinCount ?? obj.repeatCount;
    if (typeof v === "number" && !Number.isNaN(v)) return Math.max(0, Math.floor(v));
    if (typeof v === "string") {
      const n = parseInt(v, 10);
      if (!Number.isNaN(n)) return Math.max(0, n);
    }
    return 0;
  };
  const flat = get(o);
  if (flat > 0) return flat;
  const nested = (o.data ?? o.event ?? o.payload) as Record<string, unknown> | undefined;
  if (nested && typeof nested === "object") return get(nested as Record<string, unknown>);
  return 0;
}

/** Coin value for a gift name when payload has no value (from DEFAULT_GIFT_COINS). */
export function getDefaultGiftValue(giftName: string): number {
  if (!giftName || typeof giftName !== "string") return 0;
  const key = giftName.trim();
  const exact = DEFAULT_GIFT_COINS[key];
  if (exact !== undefined) return Math.max(0, exact);
  const lower = key.toLowerCase();
  for (const [name, value] of Object.entries(DEFAULT_GIFT_COINS)) {
    if (name.toLowerCase() === lower) return Math.max(0, value);
  }
  return 0;
}

const EVENT_TO_ACTION: Record<string, TikTriggerAction> = {
  likes: "likes",
  like: "likes",
  supply: "supply",
  wolf: "wolf",
  bear: "bear",
  shark: "shark",
  pig: "pig",
  rose: "rose",
  smoke: "smoke",
  fireworks: "fireworks",
  scientist: "scientist",
  test: "test",
  chaos: "chaos",
  scientistboat: "scientistboat",
  chaoswave: "chaoswave",
  healinghands: "healinghands",
  fullheal: "fullheal",
};

/** Get raw action/event name from body (action, actionName, or event) for admin-connection lookup. */
export function getRawActionNameFromPayload(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const o = body as Record<string, unknown>;
  const raw =
    typeof o.action === "string"
      ? o.action.trim()
      : typeof o.actionName === "string"
        ? o.actionName.trim()
        : typeof o.event === "string"
          ? o.event.trim()
          : "";
  return raw;
}

/** If TikFinity sends an action name directly (action, actionName, or event), return it. */
export function getActionFromPayload(body: unknown): TikTriggerAction | null {
  const raw = getRawActionNameFromPayload(body).toLowerCase();
  if (!raw) return null;
  if ((TIKTRIGGER_ACTIONS as readonly string[]).includes(raw)) return raw as TikTriggerAction;
  const fromEvent = EVENT_TO_ACTION[raw];
  if (fromEvent) return fromEvent;
  return null;
}

export function getAvailableActionsForAdmin(): {
  action: TikTriggerAction;
  label: string;
  description: string;
  exampleGifts: string[];
}[] {
  return TIKTRIGGER_ACTIONS.map((action) => ({
    action,
    label: ACTION_META[action].label,
    description: ACTION_META[action].description,
    exampleGifts: ACTION_META[action].exampleGifts,
  }));
}

export function getGiftToActionMapForAdmin(): Record<string, string> {
  return { ...DEFAULT_GIFT_TO_ACTION };
}
