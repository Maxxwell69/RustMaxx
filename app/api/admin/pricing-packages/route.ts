import { NextRequest, NextResponse } from "next/server";
import { requireCanManageServersFromDb } from "@/lib/api-auth";
import { coerceFeatures, listAllPricingPackagesForAdmin } from "@/lib/pricing-packages";

/** Admin + super_admin: list all pricing packages for /admin/pricing-packages. */
export async function GET(request: NextRequest) {
  const err = await requireCanManageServersFromDb(request);
  if (err) return err;
  const packages = await listAllPricingPackagesForAdmin();
  return NextResponse.json({
    packages: packages.map((p) => ({
      id: p.id,
      package_kind: p.package_kind,
      tier_key: p.tier_key,
      name: p.name,
      price_display: p.price_display,
      price_usd: numUsd(p.price_usd),
      period_display: p.period_display,
      billing_note: p.billing_note,
      features: coerceFeatures(p.features),
      is_highlighted: p.is_highlighted,
      sort_order: p.sort_order,
      is_published: p.is_published,
      updated_at:
        p.updated_at instanceof Date ? p.updated_at.toISOString() : String(p.updated_at),
    })),
  });
}

function numUsd(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}
