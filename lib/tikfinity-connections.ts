/**
 * Admin-defined TikFinity connections: event/action name → server action.
 * Used by webhook to resolve action from TikFinity event name and by admin API/UI.
 */

import { query } from "@/lib/db";
import {
  TIKTRIGGER_ACTIONS,
  type TikTriggerAction,
} from "@/lib/tikfinity";

export type TikfinityConnectionRow = {
  id: string;
  name: string;
  server_action: string;
  message: string | null;
  scrap_amount: number;
  npc_template_key: string | null;
  created_at: Date;
};

/** Full connection row for webhook (action + scrap + message + optional Roaming template). */
export type TikfinityConnectionForWebhook = {
  id: string;
  server_action: TikTriggerAction;
  scrap_amount: number;
  message: string | null;
  npc_template_key: string | null;
};

const NPC_TEMPLATE_KEY_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Valid RoamingNPCs template key for npcmaxx connections (alphanumeric, underscore, hyphen). */
export function parseNpcTemplateKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!NPC_TEMPLATE_KEY_RE.test(t)) return null;
  return t;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/^!+/, "");
}

/** Get server action for an incoming event/action name from admin connections (case-insensitive). */
export async function getActionFromConnectionName(
  name: string
): Promise<TikTriggerAction | null> {
  const conn = await getConnectionByEventName(name);
  return conn?.server_action ?? null;
}

/** Get full connection by event/action name for webhook (action, scrap_amount, message). */
export async function getConnectionByEventName(
  name: string
): Promise<TikfinityConnectionForWebhook | null> {
  const key = normalizeName(name);
  if (!key) return null;
  const { rows } = await query<TikfinityConnectionRow>(
    "SELECT id, server_action, COALESCE(scrap_amount, 0) AS scrap_amount, message, npc_template_key FROM tikfinity_connections WHERE lower(trim(name)) = $1 LIMIT 1",
    [key]
  );
  const row = rows[0];
  if (!row?.server_action || !(TIKTRIGGER_ACTIONS as readonly string[]).includes(row.server_action))
    return null;
  return {
    id: row.id,
    server_action: row.server_action as TikTriggerAction,
    scrap_amount: Number(row.scrap_amount) || 0,
    message: row.message ?? null,
    npc_template_key: row.npc_template_key ?? null,
  };
}

/** List all connections for admin UI. */
export async function listTikfinityConnections(): Promise<TikfinityConnectionRow[]> {
  const { rows } = await query<TikfinityConnectionRow>(
    "SELECT id, name, server_action, message, COALESCE(scrap_amount, 0) AS scrap_amount, npc_template_key, created_at FROM tikfinity_connections ORDER BY created_at DESC"
  );
  return rows.map((r) => ({
    ...r,
    scrap_amount: Number(r.scrap_amount) || 0,
  }));
}

const SCRAP_MAX = 10000;

/** Create a connection; name must be unique (case-insensitive). */
export async function createTikfinityConnection(
  name: string,
  serverAction: TikTriggerAction,
  options: {
    message?: string | null;
    scrapAmount?: number;
    npcTemplateKey?: string | null;
  } = {}
): Promise<{ id: string } | { error: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Name is required" };
  if (!(TIKTRIGGER_ACTIONS as readonly string[]).includes(serverAction))
    return { error: "Invalid server action" };
  const scrap = Math.min(SCRAP_MAX, Math.max(0, Number(options.scrapAmount) || 0));
  const message = options.message != null ? String(options.message).trim() || null : null;
  let npcTemplateKey: string | null = null;
  if (serverAction === "npcmaxx") {
    const parsed = parseNpcTemplateKey(options.npcTemplateKey);
    if (!parsed) {
      return {
        error:
          "Roaming template key is required for Roaming NPC: use 1–64 characters (letters, numbers, underscore, hyphen only) matching the template key in RoamingNPCs config.",
      };
    }
    npcTemplateKey = parsed;
  }
  const { rows: existing } = await query<TikfinityConnectionRow>(
    "SELECT 1 FROM tikfinity_connections WHERE lower(trim(name)) = $1 LIMIT 1",
    [normalizeName(trimmed)]
  );
  if (existing.length > 0)
    return { error: "A connection with this name already exists" };
  const { rows } = await query<{ id: string }>(
    "INSERT INTO tikfinity_connections (name, server_action, message, scrap_amount, npc_template_key) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [trimmed, serverAction, message, scrap, npcTemplateKey]
  );
  return { id: rows[0].id };
}

/** Delete a connection by id. */
export async function deleteTikfinityConnection(
  id: string
): Promise<{ deleted: boolean }> {
  const { rowCount } = await query(
    "DELETE FROM tikfinity_connections WHERE id = $1",
    [id]
  );
  return { deleted: rowCount > 0 };
}