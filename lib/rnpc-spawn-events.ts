import { query } from "@/lib/db";

export type RnpcSpawnEventRow = {
  id: string;
  server_id: string;
  connection_id: string | null;
  tikfinity_event_name: string | null;
  viewer_name: string;
  template_key: string;
  command: string;
  status: string;
  error_message: string | null;
  created_at: Date;
};

export async function insertRnpcSpawnEvent(params: {
  serverId: string;
  connectionId?: string | null;
  tikfinityEventName?: string | null;
  viewerName: string;
  templateKey: string;
  command: string;
  status: "success" | "failed";
  errorMessage?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO rnpc_spawn_events (
      server_id, connection_id, tikfinity_event_name, viewer_name, template_key, command, status, error_message
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.serverId,
      params.connectionId ?? null,
      params.tikfinityEventName ?? null,
      params.viewerName,
      params.templateKey,
      params.command,
      params.status,
      params.errorMessage ?? null,
    ]
  );
}

export async function listRnpcSpawnEvents(
  serverId: string,
  limit = 100
): Promise<RnpcSpawnEventRow[]> {
  const { rows } = await query<RnpcSpawnEventRow>(
    `SELECT id, server_id, connection_id, tikfinity_event_name, viewer_name, template_key, command, status, error_message, created_at
     FROM rnpc_spawn_events
     WHERE server_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [serverId, Math.min(500, Math.max(1, limit))]
  );
  return rows;
}
