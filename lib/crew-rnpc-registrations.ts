import { query } from "@/lib/db";

export type CrewRnpcRegistrationRow = {
  id: string;
  server_id: string;
  tiktok_unique_id: string;
  display_name: string;
  created_at: Date;
};

/** Insert if new; returns inserted vs duplicate (same server + TikTok id). */
export async function registerCrewRnpcIfNew(params: {
  serverId: string;
  tiktokUniqueId: string;
  displayName: string;
}): Promise<"inserted" | "duplicate"> {
  const tid = params.tiktokUniqueId.trim();
  if (!tid) return "duplicate";
  const name = params.displayName.trim() || "Viewer";
  const { rows } = await query<{ id: string }>(
    `INSERT INTO crew_rnpc_registrations (server_id, tiktok_unique_id, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (server_id, tiktok_unique_id) DO NOTHING
     RETURNING id`,
    [params.serverId, tid, name]
  );
  return rows.length > 0 ? "inserted" : "duplicate";
}

export async function listCrewRnpcRegistrations(
  serverId: string,
  limit = 500
): Promise<CrewRnpcRegistrationRow[]> {
  const { rows } = await query<CrewRnpcRegistrationRow>(
    `SELECT id, server_id, tiktok_unique_id, display_name, created_at
     FROM crew_rnpc_registrations
     WHERE server_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [serverId, Math.min(2000, Math.max(1, limit))]
  );
  return rows;
}

export async function deleteCrewRnpcRegistration(
  id: string,
  serverId: string
): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM crew_rnpc_registrations WHERE id = $1 AND server_id = $2",
    [id, serverId]
  );
  return rowCount > 0;
}
