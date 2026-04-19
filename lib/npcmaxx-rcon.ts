import type { ServerRow } from "@/lib/db";
import { viewerDisplayNameWithoutDigits } from "@/lib/viewer-display-name-game";
import { ensureConnection, sendCommand } from "@/lib/rcon-manager";
import { insertRnpcSpawnEvent } from "@/lib/rnpc-spawn-events";

function sanitizeArg(s: string, maxLen = 48): string {
  return s.replace(/\s+/g, "_").slice(0, maxLen) || "Viewer";
}

export type NpcmaxxRconResult =
  | { ok: true; command: string }
  | {
      ok: false;
      command: string;
      error: string;
      step: "rcon_connect" | "rcon_send";
    };

/**
 * Send `npcmaxx.spawn <templateKey> <viewer>` over RCON and log to rnpc_spawn_events.
 */
export async function npcmaxxRconSpawn(params: {
  server: ServerRow;
  templateKey: string;
  viewerDisplayName: string;
  connectionId: string | null;
  tikfinityEventName: string | null;
}): Promise<NpcmaxxRconResult> {
  const viewerArg = sanitizeArg(viewerDisplayNameWithoutDigits(params.viewerDisplayName));
  const command = `npcmaxx.spawn ${params.templateKey} ${viewerArg}`;

  const connected = await ensureConnection(
    params.server.id,
    params.server.rcon_host,
    params.server.rcon_port,
    params.server.rcon_password,
    async () => {}
  );
  if (!connected.ok) {
    await insertRnpcSpawnEvent({
      serverId: params.server.id,
      connectionId: params.connectionId,
      tikfinityEventName: params.tikfinityEventName,
      viewerName: params.viewerDisplayName,
      templateKey: params.templateKey,
      command,
      status: "failed",
      errorMessage: connected.error ?? "RCON connect failed",
    }).catch(() => {});
    return {
      ok: false,
      command,
      error: connected.error ?? "RCON connect failed",
      step: "rcon_connect",
    };
  }

  const result = sendCommand(params.server.id, command);
  if (!result.ok) {
    await insertRnpcSpawnEvent({
      serverId: params.server.id,
      connectionId: params.connectionId,
      tikfinityEventName: params.tikfinityEventName,
      viewerName: params.viewerDisplayName,
      templateKey: params.templateKey,
      command,
      status: "failed",
      errorMessage: result.error ?? "RCON send failed",
    }).catch(() => {});
    return {
      ok: false,
      command,
      error: result.error ?? "RCON send failed",
      step: "rcon_send",
    };
  }

  await insertRnpcSpawnEvent({
    serverId: params.server.id,
    connectionId: params.connectionId,
    tikfinityEventName: params.tikfinityEventName,
    viewerName: params.viewerDisplayName,
    templateKey: params.templateKey,
    command,
    status: "success",
  }).catch(() => {});

  return { ok: true, command };
}
