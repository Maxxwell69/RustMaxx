import { NextResponse } from "next/server";
import {
  SERVER_TIER_LABELS,
  SERVER_TIER_PRICES_USD,
  STREAMER_TIER_LABELS,
  STREAMER_TIER_PRICES_USD,
  STREAMER_WEBHOOK_LIMITS,
} from "@/lib/billing-tiers";

/** Public tier catalog for pricing UI (amounts are display; Stripe Checkout uses env price IDs). */
export async function GET() {
  return NextResponse.json({
    server: {
      currency: "usd",
      tiers: [
        {
          id: "free",
          label: SERVER_TIER_LABELS.free,
          priceUsd: SERVER_TIER_PRICES_USD.free,
          features: ["Public server list listing"],
        },
        {
          id: "pro",
          label: SERVER_TIER_LABELS.pro,
          priceUsd: SERVER_TIER_PRICES_USD.pro,
          billingNote: "per server / month",
          features: ["Everything in Free", "Streamer interaction (TikFinity) on this server"],
        },
        {
          id: "analytics",
          label: SERVER_TIER_LABELS.analytics,
          priceUsd: SERVER_TIER_PRICES_USD.analytics,
          billingNote: "per server / month",
          features: ["Everything in Pro", "Server analytics (dashboard — coming soon)"],
        },
      ],
    },
    streamer: {
      currency: "usd",
      tiers: [
        {
          id: "free",
          label: STREAMER_TIER_LABELS.free,
          priceUsd: STREAMER_TIER_PRICES_USD.free,
          webhookLimit: STREAMER_WEBHOOK_LIMITS.free,
          features: [`Up to ${STREAMER_WEBHOOK_LIMITS.free} TikFinity server webhooks`],
        },
        {
          id: "plus",
          label: STREAMER_TIER_LABELS.plus,
          priceUsd: STREAMER_TIER_PRICES_USD.plus,
          billingNote: "per month",
          webhookLimit: STREAMER_WEBHOOK_LIMITS.plus,
          features: [`Up to ${STREAMER_WEBHOOK_LIMITS.plus} server webhooks`],
        },
        {
          id: "max",
          label: STREAMER_TIER_LABELS.max,
          priceUsd: STREAMER_TIER_PRICES_USD.max,
          billingNote: "per month",
          webhookLimit: STREAMER_WEBHOOK_LIMITS.max,
          features: [`Up to ${STREAMER_WEBHOOK_LIMITS.max} server webhooks`, "Viewer-based limits — coming soon"],
        },
      ],
    },
  });
}
