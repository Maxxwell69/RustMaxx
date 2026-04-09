import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, applySubscriptionFromStripe } from "@/lib/billing-stripe";
import { query } from "@/lib/db";

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
        await applySubscriptionFromStripe({
          userId,
          customerId: customer,
          subscriptionId: subId,
          stripeStatus: sub.status,
        });
      }
    } else if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object as Stripe.Subscription;
      let userId = sub.metadata?.rustmaxx_user_id ?? null;
      const customer =
        typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      if (!userId) {
        const { rows } = await query<{ id: string }>(
          "SELECT id FROM users WHERE stripe_customer_id = $1 LIMIT 1",
          [customer]
        );
        userId = rows[0]?.id ?? null;
      }
      if (userId) {
        await applySubscriptionFromStripe({
          userId,
          customerId: customer,
          subscriptionId: event.type.endsWith("deleted") ? null : sub.id,
          stripeStatus: sub.status,
        });
      }
    }
  } catch (e) {
    console.error("[stripe webhook]", e);
    return NextResponse.json({ received: true, error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
