import { NextRequest, NextResponse } from "next/server";
import { requireCanManageAdmins } from "@/lib/api-auth";
import { ITEM_CATALOG } from "@/lib/item-catalog";

/** Search the bundled Rust item list (for adding rows to streamer_platform_items). */
export async function GET(request: NextRequest) {
  const err = await requireCanManageAdmins(request);
  if (err) return err;
  const q = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
  const limit = 80;
  if (!q) {
    return NextResponse.json({ items: ITEM_CATALOG.slice(0, limit) });
  }
  const out = [];
  for (const item of ITEM_CATALOG) {
    if (
      item.shortname.toLowerCase().includes(q) ||
      item.label.toLowerCase().includes(q)
    ) {
      out.push(item);
      if (out.length >= limit) break;
    }
  }
  return NextResponse.json({ items: out });
}
