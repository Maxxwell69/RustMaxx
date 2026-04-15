import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { getServerWithRole } from "@/lib/server-access";
import {
  getStripe,
  ensureUserStripeCustomerId,
} from "@/lib/billing-stripe";
import {
  stripePriceIdServerAnalytics,
  stripePriceIdServerPro,
  stripePriceIdStreamerLegacy,
  stripePriceIdStreamerMax,
  stripePriceIdStreamerPlus,
  type ServerBillingTier,
  type StreamerBillingTier,
} from "@/lib/billing-tiers";

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

function priceForStreamerTier(tier: StreamerBillingTier): string | null {
  if (tier === "plus") return stripePriceIdStreamerPlus() ?? stripePriceIdStreamerLegacy();
  if (tier === "max") return stripePriceIdStreamerMax();
  return null;
}

function priceForServerTier(tier: ServerBillingTier): string | null {
  if (tier === "pro") return stripePriceIdServerPro();
  if (tier === "analytics") return stripePriceIdServerAnalytics();
  return null;
}

/**
 * Start Stripe Checkout for streamer tier (account) or server tier (per server).
 * Body: { kind: "streamer", tier: "plus" | "max" } | { kind: "server", serverId, tier: "pro" | "analytics" }
 */
export async function POST(request: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe is not configured (STRIPE_SECRET_KEY)" }, { status: 503 });
  }

  const session = getSession(request.headers.get("cookie"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await findUserById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let body: {
    kind?: string;
    tier?: string;
    serverId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kind = body.kind === "server" ? "server" : body.kind === "streamer" ? "streamer" : null;
  if (!kind) {
    return NextResponse.json({ error: 'kind must be "streamer" or "server"' }, { status: 400 });
  }

  const customerId = await ensureUserStripeCustomerId(user.id, user.email);
  if (!customerId) {
    return NextResponse.json({ error: "Could not create Stripe customer" }, { status: 500 });
  }

  const origin = appOrigin(request);
  let priceId: string | null = null;
  let metadata: Record<string, string> = { rustmaxx_user_id: user.id };
  let subscriptionMetadata: Record<string, string> = { rustmaxx_user_id: user.id };
  let successPath = "/streamer?checkout=success";

  if (kind === "streamer") {
    const tier = body.tier === "max" ? "max" : body.tier === "plus" ? "plus" : null;
    if (!tier) {
      return NextResponse.json({ error: 'streamer tier must be "plus" or "max"' }, { status: 400 });
    }
    priceId = priceForStreamerTier(tier);
    if (!priceId) {
      return NextResponse.json(
        {
          error:
            "Stripe price not configured. Set STRIPE_PRICE_STREAMER_PLUS and STRIPE_PRICE_STREAMER_MAX (or STRIPE_PRICE_ID for Plus as legacy).",
        },
        { status: 503 }
      );
    }
    metadata.rustmaxx_kind = "streamer";
    metadata.rustmaxx_streamer_tier = tier;
    subscriptionMetadata.rustmaxx_kind = "streamer";
    subscriptionMetadata.rustmaxx_streamer_tier = tier;
  } else {
    const serverId = typeof body.serverId === "string" ? body.serverId.trim() : "";
    const tier =
      body.tier === "analytics" ? "analytics" : body.tier === "pro" ? "pro" : null;
    if (!serverId || !tier) {
      return NextResponse.json(
        { error: 'server checkout requires serverId and tier "pro" or "analytics"' },
        { status: 400 }
      );
    }
    const access = await getServerWithRole(serverId, user.id, user.role);
    if (!access || access.server.owner_id !== user.id) {
      return NextResponse.json({ error: "Only the server owner can purchase a server plan" }, { status: 403 });
    }
    priceId = priceForServerTier(tier);
    if (!priceId) {
      return NextResponse.json(
        {
          error:
            "Stripe price not configured. Set STRIPE_PRICE_SERVER_PRO and STRIPE_PRICE_SERVER_ANALYTICS.",
        },
        { status: 503 }
      );
    }
    metadata.rustmaxx_kind = "server";
    metadata.rustmaxx_server_id = serverId;
    metadata.rustmaxx_server_tier = tier;
    subscriptionMetadata.rustmaxx_kind = "server";
    subscriptionMetadata.rustmaxx_server_id = serverId;
    subscriptionMetadata.rustmaxx_server_tier = tier;
    successPath = `/servers/${serverId}?checkout=success`;
  }

  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}${successPath}`,
    cancel_url: `${origin}${kind === "server" ? `/servers/${metadata.rustmaxx_server_id}?checkout=canceled` : "/streamer?checkout=canceled"}`,
    metadata,
    subscription_data: {
      metadata: subscriptionMetadata,
    },
  });
  if (!checkout.url) {
    return NextResponse.json({ error: "No checkout URL" }, { status: 500 });
  }
  return NextResponse.json({ url: checkout.url });
}
