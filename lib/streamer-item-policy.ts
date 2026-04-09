import { query } from "@/lib/db";
export type StreamerPlatformItemRow = {
  shortname: string;
  label: string;
  category: string;
  default_amount: number;
  is_active: boolean;
};

export type StreamerItemDisplay = {
  shortname: string;
  label: string;
  category: string;
  amount: number;
};

export async function listPlatformStreamerItems(): Promise<StreamerPlatformItemRow[]> {
  const { rows } = await query<StreamerPlatformItemRow>(
    `SELECT shortname, label, category, default_amount, is_active
     FROM streamer_platform_items
     ORDER BY category ASC, label ASC`
  );
  return rows;
}

/** Items server owners may offer to streamers (active platform rows). */
export async function getSelectablePlatformStreamerItems(): Promise<StreamerPlatformItemRow[]> {
  const { rows } = await query<StreamerPlatformItemRow>(
    `SELECT shortname, label, category, default_amount, is_active
     FROM streamer_platform_items
     WHERE is_active = true
     ORDER BY category ASC, label ASC`
  );
  return rows;
}

export function validateStreamerItemShortnamesPayload(
  keys: unknown
): string[] | { error: string } {
  if (!Array.isArray(keys)) {
    return { error: "streamer_allowed_item_shortnames must be an array of strings" };
  }
  const out: string[] = [];
  for (const k of keys) {
    if (typeof k !== "string" || !k.trim()) {
      return { error: "Invalid item shortname" };
    }
    const t = k.trim();
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

export async function assertOwnerStreamerItemsAllowedByCatalog(
  shortnames: string[]
): Promise<{ ok: true } | { error: string }> {
  if (shortnames.length === 0) return { ok: true };
  const { rows } = await query<{ shortname: string }>(
    `SELECT shortname FROM streamer_platform_items
     WHERE is_active = true AND shortname = ANY($1::text[])`,
    [shortnames]
  );
  const found = new Set(rows.map((r) => r.shortname));
  for (const s of shortnames) {
    if (!found.has(s)) {
      return {
        error: `Item "${s}" is not in the active streamer item catalog. Ask a super admin to add or enable it.`,
      };
    }
  }
  return { ok: true };
}

/** Items a streamer may use on this server (owner selection ∩ platform active). */
export async function getEffectiveStreamerItemsForServer(
  serverId: string
): Promise<StreamerItemDisplay[]> {
  const { rows: srvRows } = await query<{
    streamer_interactions_enabled: boolean;
    streamer_allowed_item_shortnames: string[] | null;
  }>(
    `SELECT streamer_interactions_enabled, streamer_allowed_item_shortnames FROM servers WHERE id = $1`,
    [serverId]
  );
  const srv = srvRows[0];
  if (!srv?.streamer_interactions_enabled) return [];
  const picked = Array.isArray(srv.streamer_allowed_item_shortnames)
    ? srv.streamer_allowed_item_shortnames
    : [];
  if (picked.length === 0) return [];

  const { rows: plat } = await query<StreamerPlatformItemRow>(
    `SELECT shortname, label, category, default_amount, is_active
     FROM streamer_platform_items
     WHERE is_active = true AND shortname = ANY($1::text[])`,
    [picked]
  );
  const map = new Map(plat.map((r) => [r.shortname, r]));
  const out: StreamerItemDisplay[] = [];
  for (const sn of picked) {
    const row = map.get(sn);
    if (row) {
      out.push({
        shortname: row.shortname,
        label: row.label,
        category: row.category,
        amount: row.default_amount,
      });
    }
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}
