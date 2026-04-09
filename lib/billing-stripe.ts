import Stripe from "stripe";
import { query } from "@/lib/db";

let stripeSingleton: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  if (!stripeSingleton) stripeSingleton = new Stripe(key);
  return stripeSingleton;
}

function mapStripeSubscriptionStatus(
  s: Stripe.Subscription.Status
): "trialing" | "active" | "canceled" | "past_due" | "inactive" {
  switch (s) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
      return "canceled";
    default:
      return "inactive";
  }
}

/** Upsert billing fields and promote guest/player → streamer when subscribing. */
export async function applySubscriptionFromStripe(opts: {
  userId: string;
  customerId: string;
  subscriptionId: string | null;
  stripeStatus: Stripe.Subscription.Status;
}): Promise<void> {
  const subStatus = mapStripeSubscriptionStatus(opts.stripeStatus);
  await query(
    `UPDATE users SET
      stripe_customer_id = COALESCE($1, stripe_customer_id),
      stripe_subscription_id = $2,
      subscription_status = $3,
      role = CASE
        WHEN role::text IN ('guest', 'player') THEN 'streamer'::user_role
        ELSE role
      END,
      updated_at = now()
    WHERE id = $4`,
    [opts.customerId, opts.subscriptionId, subStatus, opts.userId]
  );
}

export function getStripePriceId(): string | null {
  return process.env.STRIPE_PRICE_ID?.trim() ?? null;
}

export async function ensureUserStripeCustomerId(
  userId: string,
  email: string
): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;
  const { rows } = await query<{ stripe_customer_id: string | null }>(
    "SELECT stripe_customer_id FROM users WHERE id = $1",
    [userId]
  );
  const existing = rows[0]?.stripe_customer_id;
  if (existing) return existing;
  const customer = await stripe.customers.create({
    email,
    metadata: { rustmaxx_user_id: userId },
  });
  await query(
    "UPDATE users SET stripe_customer_id = $1, updated_at = now() WHERE id = $2",
    [customer.id, userId]
  );
  return customer.id;
}
