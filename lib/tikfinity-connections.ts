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
  created_at: Date;
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** Get server action for an incoming event/action name from admin connections (case-insensitive). */
export async function getActionFromConnectionName(
  name: string
): Promise<TikTriggerAction | null> {
  const key = normalizeName(name);
  if (!key) return null;
  const { rows } = await query<TikfinityConnectionRow>(
    "SELECT server_action FROM tikfinity_connections WHERE lower(trim(name)) = $1 LIMIT 1",
    [key]
  );
  const action = rows[0]?.server_action;
  if (!action || !(TIKTRIGGER_ACTIONS as readonly string[]).includes(action))
    return null;
  return action as TikTriggerAction;
}

/** List all connections for admin UI. */
export async function listTikfinityConnections(): Promise<TikfinityConnectionRow[]> {
  const { rows } = await query<TikfinityConnectionRow>(
    "SELECT id, name, server_action, created_at FROM tikfinity_connections ORDER BY created_at DESC"
  );
  return rows;
}

/** Create a connection; name must be unique (case-insensitive). */
export async function createTikfinityConnection(
  name: string,
  serverAction: TikTriggerAction
): Promise<{ id: string } | { error: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Name is required" };
  if (!(TIKTRIGGER_ACTIONS as readonly string[]).includes(serverAction))
    return { error: "Invalid server action" };
  const { rows: existing } = await query<TikfinityConnectionRow>(
    "SELECT 1 FROM tikfinity_connections WHERE lower(trim(name)) = $1 LIMIT 1",
    [normalizeName(trimmed)]
  );
  if (existing.length > 0)
    return { error: "A connection with this name already exists" };
  const { rows } = await query<{ id: string }>(
    "INSERT INTO tikfinity_connections (name, server_action) VALUES ($1, $2) RETURNING id",
    [trimmed, serverAction]
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
</think>
Fixing the insert: Postgres ON CONFLICT with expression-based unique indexes is tricky. Using a select-then-insert approach:
<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>
StrReplace