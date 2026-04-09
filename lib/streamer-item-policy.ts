import { query } from "@/lib/db";
import { findItemByShortname, type ItemDefinition } from "@/lib/item-catalog";

export type GiveMode = "single" | "quantity";

export type StreamerPlatformItemRow = {
  shortname: string;
  label: string;
  category: string;
  default_amount: number;
  max_amount: number;
  give_mode: GiveMode;
  is_active: boolean;
};

/** Row plus catalog stack size for UI caps. */
export type StreamerSelectableItem = StreamerPlatformItemRow & {
  stack_cap: number;
};

export type StreamerItemDisplay = {
  shortname: string;
  label: string;
  category: string;
  /** Default grant amount (1 for single-mode). */
  amount: number;
  max_amount: number;
  give_mode: GiveMode;
  stack_cap: number;
};

function stackCapForShortname(shortname: string): number {
  const cat = findItemByShortname(shortname);
  return cat?.amount ?? 1;
}

function enrichRow(row: StreamerPlatformItemRow): StreamerSelectableItem {
  return { ...row, stack_cap: stackCapForShortname(row.shortname) };
}

export async function listPlatformStreamerItems(): Promise<StreamerSelectableItem[]> {
  const { rows } = await query<StreamerPlatformItemRow>(
    `SELECT shortname, label, category, default_amount, max_amount, give_mode, is_active
     FROM streamer_platform_items
     ORDER BY CASE give_mode WHEN 'single' THEN 0 ELSE 1 END, category ASC, label ASC`
  );
  return rows.map(enrichRow);
}

/** Items server owners may offer to streamers (active platform rows). */
export async function getSelectablePlatformStreamerItems(): Promise<StreamerSelectableItem[]> {
  const { rows } = await query<StreamerPlatformItemRow>(
    `SELECT shortname, label, category, default_amount, max_amount, give_mode, is_active
     FROM streamer_platform_items
     WHERE is_active = true
     ORDER BY CASE give_mode WHEN 'single' THEN 0 ELSE 1 END, category ASC, label ASC`
  );
  return rows.map(enrichRow);
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
    `SELECT shortname, label, category, default_amount, max_amount, give_mode, is_active
     FROM streamer_platform_items
     WHERE is_active = true AND shortname = ANY($1::text[])`,
    [picked]
  );
  const map = new Map(plat.map((r) => [r.shortname, r]));
  const out: StreamerItemDisplay[] = [];
  for (const sn of picked) {
    const row = map.get(sn);
    if (row) {
      const stack_cap = stackCapForShortname(row.shortname);
      out.push({
        shortname: row.shortname,
        label: row.label,
        category: row.category,
        amount: row.default_amount,
        max_amount: row.max_amount,
        give_mode: row.give_mode,
        stack_cap,
      });
    }
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

/** Clamp amounts to catalog stack and DB limits; single mode forces 1. */
export function normalizeAmountsForCatalog(
  shortname: string,
  giveMode: GiveMode,
  defaultAmount: number,
  maxAmount: number
): { default_amount: number; max_amount: number; give_mode: GiveMode } {
  const cat = findItemByShortname(shortname);
  const cap = cat ? Math.min(999999, Math.max(1, cat.amount)) : 999999;
  if (giveMode === "single") {
    return { give_mode: "single", default_amount: 1, max_amount: 1 };
  }
  const d = Math.max(1, Math.min(cap, Math.floor(defaultAmount)));
  const m = Math.max(d, Math.min(cap, Math.floor(maxAmount)));
  return { give_mode: "quantity", default_amount: d, max_amount: m };
}

export function amountsFromCatalogDefaults(base: ItemDefinition): {
  give_mode: GiveMode;
  default_amount: number;
  max_amount: number;
} {
  const cap = Math.min(999999, Math.max(1, base.amount));
  return {
    give_mode: "quantity",
    default_amount: cap,
    max_amount: cap,
  };
}
