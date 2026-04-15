import { NextRequest, NextResponse } from "next/server";
import { requireCanManageServersFromDb } from "@/lib/api-auth";
import { updatePricingPackageById, type PricingPackagePatch } from "@/lib/pricing-packages";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const err = await requireCanManageServersFromDb(request);
  if (err) return err;
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid package id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: PricingPackagePatch = {};

  if (typeof body.name === "string") patch.name = body.name;
  if (typeof body.price_display === "string") patch.price_display = body.price_display;
  if (body.price_usd === null) patch.price_usd = null;
  else if (typeof body.price_usd === "number" && Number.isFinite(body.price_usd)) {
    patch.price_usd = body.price_usd;
  }
  if (typeof body.period_display === "string") patch.period_display = body.period_display;
  if (body.billing_note === null) patch.billing_note = null;
  else if (typeof body.billing_note === "string") patch.billing_note = body.billing_note;

  if (Array.isArray(body.features)) {
    const features = body.features
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 500)
      .slice(0, 40);
    patch.features = features;
  }

  if (typeof body.is_highlighted === "boolean") patch.is_highlighted = body.is_highlighted;
  if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) {
    patch.sort_order = Math.round(body.sort_order);
  }
  if (typeof body.is_published === "boolean") patch.is_published = body.is_published;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const ok = await updatePricingPackageById(id, patch);
  if (!ok) {
    return NextResponse.json({ error: "Package not found or nothing to update" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
