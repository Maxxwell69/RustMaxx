import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerWithRole, getServerIfAccessible, canManageServerAccess } from "@/lib/server-access";
import { ITEM_CATALOG } from "@/lib/item-catalog";

type ServerItemRow = {
  id: string;
  server_id: string;
  shortname: string;
  label: string;
  amount: number;
  category: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;

  const url = new URL(request.url);
  const enabledOnly = url.searchParams.get("enabled") === "1";

  const server = await getServerIfAccessible(serverId, session.userId, session.role);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { rows } = await query<ServerItemRow>(
    "SELECT id, server_id, shortname, label, amount, category FROM server_items WHERE server_id = $1",
    [serverId]
  );

  const enabledMap = new Map<string, ServerItemRow>();
  for (const row of rows) {
    enabledMap.set(row.shortname, row);
  }

  if (enabledOnly) {
    // For the player page: only return enabled items, falling back to catalog values.
    const enabled: { shortname: string; label: string; amount: number; category: string }[] = [];
    for (const base of ITEM_CATALOG) {
      const row = enabledMap.get(base.shortname);
      if (!row) continue;
      enabled.push({
        shortname: base.shortname,
        label: row.label || base.label,
        amount: row.amount || base.amount,
        category: base.category,
      });
    }
    return NextResponse.json(enabled);
  }

  // For the Items admin page: return full catalog with enabled flag.
  const result = ITEM_CATALOG.map((item) => {
    const row = enabledMap.get(item.shortname);
    return {
      ...item,
      enabled: !!row,
      amount: row?.amount ?? item.amount,
      label: row?.label ?? item.label,
    };
  });

  return NextResponse.json(result);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;

  const result = await getServerWithRole(serverId, session.userId, session.role);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canManageServerAccess(result.serverRole)) {
    return NextResponse.json(
      { error: "Only owner or server admin can manage items" },
      { status: 403 }
    );
  }

  let body: { shortname?: string; enabled?: boolean; amount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shortname = typeof body.shortname === "string" ? body.shortname.trim() : "";
  if (!shortname) {
    return NextResponse.json({ error: "shortname is required" }, { status: 400 });
  }
  const enabled = Boolean(body.enabled);

  const base = ITEM_CATALOG.find((i) => i.shortname === shortname);
  if (!base) {
    return NextResponse.json({ error: "Unknown item shortname" }, { status: 400 });
  }

  const rawAmount = body.amount;
  const amount =
    typeof rawAmount === "number" && Number.isFinite(rawAmount)
      ? Math.max(1, Math.min(999999, Math.floor(rawAmount)))
      : base.amount;

  if (!enabled) {
    await query("DELETE FROM server_items WHERE server_id = $1 AND shortname = $2", [
      serverId,
      shortname,
    ]);
    return NextResponse.json({ ok: true, enabled: false });
  }

  const { rows } = await query<ServerItemRow>(
    `INSERT INTO server_items (server_id, shortname, label, amount, category)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (server_id, shortname)
     DO UPDATE SET label = EXCLUDED.label, amount = EXCLUDED.amount, category = EXCLUDED.category
     RETURNING id, server_id, shortname, label, amount, category`,
    [serverId, base.shortname, base.label, amount, base.category]
  );

  const row = rows[0];
  return NextResponse.json({
    id: row.id,
    shortname: row.shortname,
    label: row.label,
    amount: row.amount,
    category: row.category,
    enabled: true,
  });
}

