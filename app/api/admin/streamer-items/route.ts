import { NextRequest, NextResponse } from "next/server";
import { requireCanManageAdmins } from "@/lib/api-auth";
import { query } from "@/lib/db";
import { findItemByShortname } from "@/lib/item-catalog";
import {
  amountsFromCatalogDefaults,
  listPlatformStreamerItems,
  normalizeAmountsForCatalog,
  type GiveMode,
  type StreamerPlatformItemRow,
} from "@/lib/streamer-item-policy";

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
  let body: {
    shortname?: string;
    default_amount?: number;
    max_amount?: number;
    giveMode?: GiveMode;
  };
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
  const giveMode: GiveMode = body.giveMode === "single" ? "single" : "quantity";
  let default_amount: number;
  let max_amount: number;
  let give_mode: GiveMode = giveMode;
  if (giveMode === "single") {
    default_amount = 1;
    max_amount = 1;
  } else {
    const qty = amountsFromCatalogDefaults(base);
    const defIn =
      typeof body.default_amount === "number" && Number.isFinite(body.default_amount)
        ? body.default_amount
        : qty.default_amount;
    const maxIn =
      typeof body.max_amount === "number" && Number.isFinite(body.max_amount) ? body.max_amount : qty.max_amount;
    const n = normalizeAmountsForCatalog(shortname, "quantity", defIn, maxIn);
    default_amount = n.default_amount;
    max_amount = n.max_amount;
    give_mode = n.give_mode;
  }

  const { rows } = await query<StreamerPlatformItemRow>(
    `INSERT INTO streamer_platform_items (shortname, label, category, default_amount, max_amount, give_mode, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     ON CONFLICT (shortname) DO UPDATE SET
       label = EXCLUDED.label,
       category = EXCLUDED.category,
       default_amount = EXCLUDED.default_amount,
       max_amount = EXCLUDED.max_amount,
       give_mode = EXCLUDED.give_mode,
       updated_at = now()
     RETURNING shortname, label, category, default_amount, max_amount, give_mode, is_active`,
    [base.shortname, base.label, base.category, default_amount, max_amount, give_mode]
  );
  const list = await listPlatformStreamerItems();
  const enriched = list.find((r) => r.shortname === rows[0]?.shortname) ?? {
    ...rows[0]!,
    stack_cap: base.amount,
  };
  return NextResponse.json({ item: enriched });
}

export async function PATCH(request: NextRequest) {
  const err = await requireCanManageAdmins(request);
  if (err) return err;
  let body: {
    shortname?: string;
    isActive?: boolean;
    giveMode?: GiveMode;
    defaultAmount?: number;
    maxAmount?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const shortname = typeof body.shortname === "string" ? body.shortname.trim() : "";
  if (!shortname) {
    return NextResponse.json({ error: "shortname is required" }, { status: 400 });
  }
  const { rows: existingRows } = await query<StreamerPlatformItemRow>(
    `SELECT shortname, label, category, default_amount, max_amount, give_mode, is_active
     FROM streamer_platform_items WHERE shortname = $1`,
    [shortname]
  );
  const row = existingRows[0];
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const touched =
    body.giveMode !== undefined || body.defaultAmount !== undefined || body.maxAmount !== undefined;
  let give_mode = (body.giveMode ?? row.give_mode) as GiveMode;
  let default_amount = body.defaultAmount ?? row.default_amount;
  let max_amount = body.maxAmount ?? row.max_amount;
  if (touched) {
    if (
      give_mode === "quantity" &&
      body.defaultAmount === undefined &&
      body.maxAmount === undefined &&
      row.give_mode === "single"
    ) {
      const cat = findItemByShortname(shortname);
      if (cat) {
        const q = amountsFromCatalogDefaults(cat);
        default_amount = q.default_amount;
        max_amount = q.max_amount;
      }
    }
    const n = normalizeAmountsForCatalog(shortname, give_mode, default_amount, max_amount);
    give_mode = n.give_mode;
    default_amount = n.default_amount;
    max_amount = n.max_amount;
  }
  const is_active = typeof body.isActive === "boolean" ? body.isActive : row.is_active;

  await query(
    `UPDATE streamer_platform_items
     SET give_mode = $1, default_amount = $2, max_amount = $3, is_active = $4, updated_at = now()
     WHERE shortname = $5`,
    [give_mode, default_amount, max_amount, is_active, shortname]
  );
  const list = await listPlatformStreamerItems();
  const enriched = list.find((r) => r.shortname === shortname);
  return NextResponse.json({ item: enriched ?? { shortname } });
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
