import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { getStripe, getStripePriceId, ensureUserStripeCustomerId } from "@/lib/billing-stripe";

function appOrigin(req: NextRequest): string {
  const env = process.env.APP_URL?.trim() ?? process.env.SITE_URL?.trim();
  if (env) {
    try {
      return new URL(env).origin;
    } catch {
      /* fall through */
    }
  }
  return req.nextUrl.origin;
}

/** Start Stripe Checkout for streamer subscription. */
export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const priceId = getStripePriceId();
  if (!stripe || !priceId) {
    return NextResponse.json(
      { error: "Stripe is not configured (STRIPE_SECRET_KEY, STRIPE_PRICE_ID)" },
      { status: 503 }
    );
  }
  const session = getSession(request.headers.get("cookie"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await findUserById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const customerId = await ensureUserStripeCustomerId(user.id, user.email);
  if (!customerId) {
    return NextResponse.json({ error: "Could not create Stripe customer" }, { status: 500 });
  }
  const origin = appOrigin(request);
  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/streamer?checkout=success`,
    cancel_url: `${origin}/streamer?checkout=canceled`,
    metadata: { rustmaxx_user_id: user.id },
    subscription_data: {
      metadata: { rustmaxx_user_id: user.id },
    },
  });
  if (!checkout.url) {
    return NextResponse.json({ error: "No checkout URL" }, { status: 500 });
  }
  return NextResponse.json({ url: checkout.url });
}
