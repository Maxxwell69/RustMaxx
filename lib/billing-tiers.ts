/**
 * Product tiers: server owners (per server) and streamers (per account).
 * Prices are display-only; Stripe Price IDs come from env in checkout + webhook mapping.
 */

import type { ServerRow } from "@/lib/db";

export type ServerBillingTier = "free" | "pro" | "analytics";
export type StreamerBillingTier = "free" | "plus" | "max";

export const SERVER_TIER_LABELS: Record<ServerBillingTier, string> = {
  free: "Free",
  pro: "Pro",
  analytics: "Analytics",
};

export const STREAMER_TIER_LABELS: Record<StreamerBillingTier, string> = {
  free: "Free",
  plus: "Plus",
  max: "Max",
};

/** USD/month display (per server for server tiers). */
export const SERVER_TIER_PRICES_USD: Record<ServerBillingTier, number | null> = {
  free: 0,
  pro: 19.99,
  analytics: 29.99,
};

export const STREAMER_TIER_PRICES_USD: Record<StreamerBillingTier, number | null> = {
  free: 0,
  plus: 19.99,
  max: 39.99,
};

export const STREAMER_WEBHOOK_LIMITS: Record<StreamerBillingTier, number> = {
  free: 5,
  plus: 12,
  max: 25,
};

export function parseServerBillingTier(raw: unknown): ServerBillingTier | null {
  if (raw === "free" || raw === "pro" || raw === "analytics") return raw;
  return null;
}

export function parseStreamerBillingTier(raw: unknown): StreamerBillingTier | null {
  if (raw === "free" || raw === "plus" || raw === "max") return raw;
  return null;
}

export function serverTierAllowsStreamerInteraction(tier: ServerBillingTier): boolean {
  return tier === "pro" || tier === "analytics";
}

export function serverTierAllowsAnalytics(tier: ServerBillingTier): boolean {
  return tier === "analytics";
}

/** When SKIP_BILLING=1, limits and gates are relaxed for local/dev. */
export function billingSkippedInEnv(): boolean {
  const v = process.env.SKIP_BILLING?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function getStreamerWebhookLimit(tier: StreamerBillingTier | string | null | undefined): number {
  if (billingSkippedInEnv()) return 999;
  const t = parseStreamerBillingTier(tier) ?? "free";
  return STREAMER_WEBHOOK_LIMITS[t];
}

export function coerceServerBillingTier(row: ServerRow & { billing_tier?: string }): ServerBillingTier {
  return parseServerBillingTier(row.billing_tier) ?? "free";
}

export function stripePriceIdServerPro(): string | null {
  return process.env.STRIPE_PRICE_SERVER_PRO?.trim() ?? null;
}
export function stripePriceIdServerAnalytics(): string | null {
  return process.env.STRIPE_PRICE_SERVER_ANALYTICS?.trim() ?? null;
}
export function stripePriceIdStreamerPlus(): string | null {
  return process.env.STRIPE_PRICE_STREAMER_PLUS?.trim() ?? null;
}
export function stripePriceIdStreamerMax(): string | null {
  return process.env.STRIPE_PRICE_STREAMER_MAX?.trim() ?? null;
}
/** Legacy single streamer price (maps to plus tier). */
export function stripePriceIdStreamerLegacy(): string | null {
  return process.env.STRIPE_PRICE_ID?.trim() ?? null;
}

export function serverTierFromStripePriceId(priceId: string | null | undefined): ServerBillingTier | null {
  if (!priceId) return null;
  if (priceId === stripePriceIdServerAnalytics()) return "analytics";
  if (priceId === stripePriceIdServerPro()) return "pro";
  return null;
}

export function streamerTierFromStripePriceId(priceId: string | null | undefined): StreamerBillingTier | null {
  if (!priceId) return null;
  if (priceId === stripePriceIdStreamerMax()) return "max";
  if (priceId === stripePriceIdStreamerPlus()) return "plus";
  if (priceId === stripePriceIdStreamerLegacy()) return "plus";
  return null;
}
