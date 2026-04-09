import { NextRequest, NextResponse } from "next/server";
import { requireCanManageAdmins } from "@/lib/api-auth";
import { query } from "@/lib/db";
import { findItemByShortname } from "@/lib/item-catalog";
import { listPlatformStreamerItems } from "@/lib/streamer-item-policy";

export async function GET(request: NextRequest) {
  const err = await requireCanManageAdmins(request);
  if (err) return err;
  const rows = await listPlatformStreamerItems();
  return NextResponse.json({ items: rows });
}

/** Add or refresh a row from the RustMaxx item catalog (shortname must exist in ITEM_CATALOG). */
export async function POST(request: NextRequest) {
  const err = await requireCanManageAdmins(request);
  if (err) return err;
  let body: { shortname?: string; default_amount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const shortname = typeof body.shortname === "string" ? body.shortname.trim() : "";
  if (!shortname) {
    return NextResponse.json({ error: "shortname is required" }, { status: 400 });
  }
  const base = findItemByShortname(shortname);
  if (!base) {
    return NextResponse.json(
      { error: "Unknown shortname — pick an item from the RustMaxx catalog search." },
      { status: 400 }
    );
  }
  const amt =
    typeof body.default_amount === "number" && Number.isFinite(body.default_amount)
      ? Math.max(1, Math.min(999999, Math.floor(body.default_amount)))
      : base.amount;

  const { rows } = await query<{
    shortname: string;
    label: string;
    category: string;
    default_amount: number;
    is_active: boolean;
  }>(
    `INSERT INTO streamer_platform_items (shortname, label, category, default_amount, is_active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (shortname) DO UPDATE SET
       label = EXCLUDED.label,
       category = EXCLUDED.category,
       default_amount = EXCLUDED.default_amount,
       updated_at = now()
     RETURNING shortname, label, category, default_amount, is_active`,
    [base.shortname, base.label, base.category, amt]
  );
  return NextResponse.json({ item: rows[0] });
}

export async function PATCH(request: NextRequest) {
  const err = await requireCanManageAdmins(request);
  if (err) return err;
  let body: { shortname?: string; isActive?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const shortname = typeof body.shortname === "string" ? body.shortname.trim() : "";
  if (!shortname) {
    return NextResponse.json({ error: "shortname is required" }, { status: 400 });
  }
  if (typeof body.isActive !== "boolean") {
    return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
  }
  await query(
    `UPDATE streamer_platform_items SET is_active = $1, updated_at = now() WHERE shortname = $2`,
    [body.isActive, shortname]
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const err = await requireCanManageAdmins(request);
  if (err) return err;
  const url = new URL(request.url);
  const shortname = url.searchParams.get("shortname")?.trim() ?? "";
  if (!shortname) {
    return NextResponse.json({ error: "shortname query required" }, { status: 400 });
  }
  await query(`DELETE FROM streamer_platform_items WHERE shortname = $1`, [shortname]);
  return NextResponse.json({ ok: true });
}
