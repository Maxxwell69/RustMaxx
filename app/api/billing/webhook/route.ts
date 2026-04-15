import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  getStripe,
  applySubscriptionFromStripe,
  applyServerSubscriptionFromStripe,
} from "@/lib/billing-stripe";
import { query } from "@/lib/db";
import {
  parseServerBillingTier,
  parseStreamerBillingTier,
  serverTierFromStripePriceId,
  streamerTierFromStripePriceId,
} from "@/lib/billing-tiers";

function firstPriceId(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0];
  const price = item?.price;
  if (price && typeof price === "object" && "id" in price) {
    return typeof price.id === "string" ? price.id : null;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripe || !whSecret) {
    return NextResponse.json({ error: "Misconfigured" }, { status: 500 });
  }
  const raw = await request.text();
  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, whSecret);
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      const userId = s.metadata?.rustmaxx_user_id;
      const customer =
        typeof s.customer === "string" ? s.customer : s.customer?.id;
      const subRef = s.subscription;
      const subId =
        typeof subRef === "string" ? subRef : subRef?.id ?? null;
      if (userId && customer && subId) {
        const sub = await stripe.subscriptions.retrieve(subId);
        const kind = s.metadata?.rustmaxx_kind;
        if (kind === "server") {
          const serverId = s.metadata?.rustmaxx_server_id?.trim();
          const ownerUserId = s.metadata?.rustmaxx_owner_user_id ?? userId;
          const tierMeta = parseServerBillingTier(s.metadata?.rustmaxx_server_tier);
          const billingTierWhenActive =
            tierMeta ?? serverTierFromStripePriceId(firstPriceId(sub)) ?? "pro";
          if (serverId && ownerUserId) {
            await applyServerSubscriptionFromStripe({
              serverId,
              ownerUserId,
              subscriptionId: subId,
              stripeStatus: sub.status,
              billingTierWhenActive,
            });
          }
        } else {
          const streamerTier =
            parseStreamerBillingTier(s.metadata?.rustmaxx_streamer_tier) ??
            streamerTierFromStripePriceId(firstPriceId(sub)) ??
            null;
          await applySubscriptionFromStripe({
            userId,
            customerId: customer,
            subscriptionId: subId,
            stripeStatus: sub.status,
            streamerTier: streamerTier ?? undefined,
          });
        }
      }
    } else if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object as Stripe.Subscription;
      const meta = sub.metadata ?? {};
      const customer =
        typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const priceId = firstPriceId(sub);
      const isDeleted = event.type === "customer.subscription.deleted";

      if (meta.rustmaxx_kind === "server" && meta.rustmaxx_server_id) {
        const ownerUserId = meta.rustmaxx_owner_user_id ?? meta.rustmaxx_user_id;
        if (ownerUserId) {
          const billingTierWhenActive =
            parseServerBillingTier(meta.rustmaxx_server_tier) ??
            serverTierFromStripePriceId(priceId) ??
            "pro";
          await applyServerSubscriptionFromStripe({
            serverId: meta.rustmaxx_server_id,
            ownerUserId,
            subscriptionId: isDeleted ? null : sub.id,
            stripeStatus: sub.status,
            billingTierWhenActive,
          });
        }
      } else {
        const { rows: serverRows } = await query<{ id: string; owner_id: string }>(
          "SELECT id::text, owner_id::text FROM servers WHERE stripe_subscription_id = $1 LIMIT 1",
          [sub.id]
        );
        const hit = serverRows[0];
        if (hit) {
          const billingTierWhenActive =
            serverTierFromStripePriceId(priceId) ?? "pro";
          await applyServerSubscriptionFromStripe({
            serverId: hit.id,
            ownerUserId: hit.owner_id,
            subscriptionId: isDeleted ? null : sub.id,
            stripeStatus: sub.status,
            billingTierWhenActive,
          });
        } else {
          let userId = meta.rustmaxx_user_id ?? null;
          if (!userId) {
            const { rows } = await query<{ id: string }>(
              "SELECT id FROM users WHERE stripe_customer_id = $1 LIMIT 1",
              [customer]
            );
            userId = rows[0]?.id ?? null;
          }
          if (userId) {
            const streamerTier =
              parseStreamerBillingTier(meta.rustmaxx_streamer_tier) ??
              streamerTierFromStripePriceId(priceId) ??
              null;
            await applySubscriptionFromStripe({
              userId,
              customerId: customer,
              subscriptionId: isDeleted ? null : sub.id,
              stripeStatus: sub.status,
              streamerTier: streamerTier ?? undefined,
            });
          }
        }
      }
    }
  } catch (e) {
    console.error("[stripe webhook]", e);
    return NextResponse.json({ received: true, error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
