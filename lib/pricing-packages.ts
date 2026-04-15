import { query } from "@/lib/db";
import {
  SERVER_TIER_LABELS,
  SERVER_TIER_PRICES_USD,
  STREAMER_TIER_LABELS,
  STREAMER_TIER_PRICES_USD,
  STREAMER_WEBHOOK_LIMITS,
} from "@/lib/billing-tiers";

export type PackageKind = "server" | "streamer" | "combo";

export type PricingPackageRow = {
  id: string;
  package_kind: PackageKind;
  tier_key: string;
  name: string;
  price_display: string;
  price_usd: string | number | null;
  period_display: string;
  billing_note: string | null;
  features: unknown;
  is_highlighted: boolean;
  sort_order: number;
  is_published: boolean;
  created_at: Date;
  updated_at: Date;
};

export type PricingPageTierCard = {
  id: string;
  name: string;
  price: string;
  priceUsd: number | null;
  period: string;
  note: string;
  features: string[];
  highlighted: boolean;
};

export type BillingTiersApiPayload = {
  server: {
    currency: "usd";
    tiers: Array<{
      id: string;
      label: string;
      priceUsd: number | null;
      billingNote?: string;
      features: string[];
    }>;
  };
  streamer: {
    currency: "usd";
    tiers: Array<{
      id: string;
      label: string;
      priceUsd: number | null;
      billingNote?: string;
      features: string[];
      webhookLimit: number;
    }>;
  };
  combo: {
    currency: "usd";
    tiers: Array<{
      id: string;
      label: string;
      priceUsd: number | null;
      billingNote?: string;
      features: string[];
    }>;
  };
};

function numUsd(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export function coerceFeatures(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
}

function isMissingRelationError(e: unknown): boolean {
  if (e === null || typeof e !== "object") return false;
  const err = e as { code?: string };
  return err.code === "42P01";
}

/** In-memory defaults when DB has no published rows or table is missing. */
function defaultPackageRows(): PricingPackageRow[] {
  const now = new Date();
  const mk = (
    partial: Omit<PricingPackageRow, "id" | "created_at" | "updated_at" | "features"> & { features: string[] }
  ): PricingPackageRow => ({
    id: `default-${partial.package_kind}-${partial.tier_key}`,
    ...partial,
    features: partial.features,
    created_at: now,
    updated_at: now,
  });
  return [
    mk({
      package_kind: "server",
      tier_key: "free",
      name: SERVER_TIER_LABELS.free,
      price_display: "$0",
      price_usd: SERVER_TIER_PRICES_USD.free,
      period_display: "",
      billing_note: "Per server",
      features: ["Listed on the public server list"],
      is_highlighted: false,
      sort_order: 10,
      is_published: true,
    }),
    mk({
      package_kind: "server",
      tier_key: "pro",
      name: SERVER_TIER_LABELS.pro,
      price_display: "$19.99",
      price_usd: SERVER_TIER_PRICES_USD.pro,
      period_display: "/mo",
      billing_note: "Per server",
      features: [
        "Everything in Free",
        "Streamer interaction (TikFinity) enabled on this server",
      ],
      is_highlighted: true,
      sort_order: 20,
      is_published: true,
    }),
    mk({
      package_kind: "server",
      tier_key: "analytics",
      name: SERVER_TIER_LABELS.analytics,
      price_display: "$29.99",
      price_usd: SERVER_TIER_PRICES_USD.analytics,
      period_display: "/mo",
      billing_note: "Per server",
      features: ["Everything in Pro", "Server analytics dashboard (coming soon)"],
      is_highlighted: false,
      sort_order: 30,
      is_published: true,
    }),
    mk({
      package_kind: "streamer",
      tier_key: "free",
      name: STREAMER_TIER_LABELS.free,
      price_display: "$0",
      price_usd: STREAMER_TIER_PRICES_USD.free,
      period_display: "",
      billing_note: "Per account",
      features: [`Up to ${STREAMER_WEBHOOK_LIMITS.free} TikFinity server webhooks`],
      is_highlighted: false,
      sort_order: 10,
      is_published: true,
    }),
    mk({
      package_kind: "streamer",
      tier_key: "plus",
      name: STREAMER_TIER_LABELS.plus,
      price_display: "$19.99",
      price_usd: STREAMER_TIER_PRICES_USD.plus,
      period_display: "/mo",
      billing_note: "Per account",
      features: [`Up to ${STREAMER_WEBHOOK_LIMITS.plus} server webhooks`],
      is_highlighted: true,
      sort_order: 20,
      is_published: true,
    }),
    mk({
      package_kind: "streamer",
      tier_key: "max",
      name: STREAMER_TIER_LABELS.max,
      price_display: "$39.99",
      price_usd: STREAMER_TIER_PRICES_USD.max,
      period_display: "/mo",
      billing_note: "Per account",
      features: [
        `Up to ${STREAMER_WEBHOOK_LIMITS.max} server webhooks`,
        "More viewer-based perks — coming soon",
      ],
      is_highlighted: false,
      sort_order: 30,
      is_published: true,
    }),
    mk({
      package_kind: "combo",
      tier_key: "bundle",
      name: "Combo Bundle",
      price_display: "$34.99",
      price_usd: 34.99,
      period_display: "/mo",
      billing_note: "Server + streamer",
      features: [
        "Server Pro tier included",
        "Streamer Plus tier included",
        "One subscription for both sides",
      ],
      is_highlighted: true,
      sort_order: 10,
      is_published: true,
    }),
  ];
}

function mapDbRow(r: Record<string, unknown>): PricingPackageRow {
  return {
    id: String(r.id),
    package_kind:
      r.package_kind === "streamer" ? "streamer" : r.package_kind === "combo" ? "combo" : "server",
    tier_key: String(r.tier_key),
    name: String(r.name ?? ""),
    price_display: String(r.price_display ?? ""),
    price_usd: r.price_usd as string | number | null,
    period_display: String(r.period_display ?? ""),
    billing_note: r.billing_note == null ? null : String(r.billing_note),
    features: r.features,
    is_highlighted: r.is_highlighted === true,
    sort_order: Number(r.sort_order) || 0,
    is_published: r.is_published !== false,
    created_at:
      r.created_at instanceof Date ? r.created_at : new Date(String(r.created_at ?? Date.now())),
    updated_at:
      r.updated_at instanceof Date ? r.updated_at : new Date(String(r.updated_at ?? Date.now())),
  };
}

/** Published rows for marketing + public API (empty → built-in defaults). */
export async function loadPublishedPricingPackageRows(): Promise<PricingPackageRow[]> {
  try {
    const { rows } = await query<Record<string, unknown>>(
      `SELECT id, package_kind, tier_key, name, price_display, price_usd, period_display, billing_note,
              features, is_highlighted, sort_order, is_published, created_at, updated_at
       FROM pricing_packages
       WHERE is_published = true
       ORDER BY package_kind ASC, sort_order ASC, tier_key ASC`
    );
    if (rows.length === 0) return defaultPackageRows();
    return rows.map(mapDbRow);
  } catch (e) {
    if (isMissingRelationError(e)) return defaultPackageRows();
    throw e;
  }
}

/** All rows for super admin (includes unpublished). Table missing → defaults as single “virtual” set is confusing; return []. */
export async function listAllPricingPackagesForAdmin(): Promise<PricingPackageRow[]> {
  try {
    const { rows } = await query<Record<string, unknown>>(
      `SELECT id, package_kind, tier_key, name, price_display, price_usd, period_display, billing_note,
              features, is_highlighted, sort_order, is_published, created_at, updated_at
       FROM pricing_packages
       ORDER BY package_kind ASC, sort_order ASC, tier_key ASC`
    );
    return rows.map(mapDbRow);
  } catch (e) {
    if (isMissingRelationError(e)) return [];
    throw e;
  }
}

export function rowsToBillingTiersApiPayload(rows: PricingPackageRow[]): BillingTiersApiPayload {
  const serverRows = rows.filter((r) => r.package_kind === "server");
  const streamerRows = rows.filter((r) => r.package_kind === "streamer");

  return {
    server: {
      currency: "usd",
      tiers: serverRows.map((r) => {
        const note = r.billing_note?.trim();
        return {
          id: r.tier_key,
          label: r.name,
          priceUsd: numUsd(r.price_usd),
          ...(note ? { billingNote: note } : {}),
          features: coerceFeatures(r.features),
        };
      }),
    },
    streamer: {
      currency: "usd",
      tiers: streamerRows.map((r) => {
        const tier = r.tier_key as keyof typeof STREAMER_WEBHOOK_LIMITS;
        const webhookLimit =
          tier in STREAMER_WEBHOOK_LIMITS ? STREAMER_WEBHOOK_LIMITS[tier] : STREAMER_WEBHOOK_LIMITS.free;
        const note = r.billing_note?.trim();
        return {
          id: r.tier_key,
          label: r.name,
          priceUsd: numUsd(r.price_usd),
          ...(note ? { billingNote: note } : {}),
          features: coerceFeatures(r.features),
          webhookLimit,
        };
      }),
    },
    combo: {
      currency: "usd",
      tiers: rows
        .filter((r) => r.package_kind === "combo")
        .map((r) => {
          const note = r.billing_note?.trim();
          return {
            id: r.tier_key,
            label: r.name,
            priceUsd: numUsd(r.price_usd),
            ...(note ? { billingNote: note } : {}),
            features: coerceFeatures(r.features),
          };
        }),
    },
  };
}

export function rowsToPricingPageCards(rows: PricingPackageRow[]): {
  server: PricingPageTierCard[];
  streamer: PricingPageTierCard[];
} {
  const toCard = (r: PricingPackageRow): PricingPageTierCard => ({
    id: r.tier_key,
    name: r.name,
    price: r.price_display,
    priceUsd: numUsd(r.price_usd),
    period: r.period_display,
    note: r.billing_note?.trim() ?? "",
    features: coerceFeatures(r.features),
    highlighted: r.is_highlighted,
  });
  return {
    server: rows.filter((r) => r.package_kind === "server").map(toCard),
    streamer: rows.filter((r) => r.package_kind === "streamer").map(toCard),
    combo: rows.filter((r) => r.package_kind === "combo").map(toCard),
  };
}

export async function getPublishedBillingTiersApiPayload(): Promise<BillingTiersApiPayload> {
  const rows = await loadPublishedPricingPackageRows();
  return rowsToBillingTiersApiPayload(rows);
}

export async function getPublishedPricingPageData(): Promise<{
  server: PricingPageTierCard[];
  streamer: PricingPageTierCard[];
  combo: PricingPageTierCard[];
}> {
  const rows = await loadPublishedPricingPackageRows();
  return rowsToPricingPageCards(rows);
}

export type PricingPackagePatch = {
  name?: string;
  price_display?: string;
  price_usd?: number | null;
  period_display?: string;
  billing_note?: string | null;
  features?: string[];
  is_highlighted?: boolean;
  sort_order?: number;
  is_published?: boolean;
};

export async function updatePricingPackageById(
  id: string,
  patch: PricingPackagePatch
): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;

  if (typeof patch.name === "string") {
    sets.push(`name = $${i++}`);
    vals.push(patch.name.trim());
  }
  if (typeof patch.price_display === "string") {
    sets.push(`price_display = $${i++}`);
    vals.push(patch.price_display);
  }
  if (patch.price_usd !== undefined) {
    sets.push(`price_usd = $${i++}`);
    vals.push(patch.price_usd);
  }
  if (typeof patch.period_display === "string") {
    sets.push(`period_display = $${i++}`);
    vals.push(patch.period_display);
  }
  if (patch.billing_note !== undefined) {
    sets.push(`billing_note = $${i++}`);
    vals.push(patch.billing_note === null ? null : String(patch.billing_note).trim());
  }
  if (patch.features !== undefined) {
    sets.push(`features = $${i++}::jsonb`);
    vals.push(JSON.stringify(patch.features.filter((x) => typeof x === "string" && x.trim())));
  }
  if (typeof patch.is_highlighted === "boolean") {
    sets.push(`is_highlighted = $${i++}`);
    vals.push(patch.is_highlighted);
  }
  if (typeof patch.sort_order === "number" && Number.isFinite(patch.sort_order)) {
    sets.push(`sort_order = $${i++}`);
    vals.push(Math.round(patch.sort_order));
  }
  if (typeof patch.is_published === "boolean") {
    sets.push(`is_published = $${i++}`);
    vals.push(patch.is_published);
  }

  if (sets.length === 0) return false;
  sets.push("updated_at = now()");
  vals.push(id);
  const { rowCount } = await query(
    `UPDATE pricing_packages SET ${sets.join(", ")} WHERE id = $${i}::uuid`,
    vals
  );
  return (rowCount ?? 0) > 0;
}
