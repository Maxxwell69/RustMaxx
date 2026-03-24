import type { ServerRow } from "@/lib/db";
import { ensureConnection, sendCommand } from "@/lib/rcon-manager";
import { insertRnpcSpawnEvent } from "@/lib/rnpc-spawn-events";

export type MaxxinvadersRconResult =
  | { ok: true; command: string }
  | {
      ok: false;
      command: string;
      error: string;
      step: "rcon_connect" | "rcon_send";
    };

/** No spaces in tokens RCON passes to Oxide (viewer spawn uses ParseQuotedArgs; we still avoid spaces in unquoted segments). */
function sanitizeToken(s: string, maxLen: number): string {
  const t = s.replace(/\s+/g, "_").replace(/"/g, "").slice(0, maxLen);
  return t || "Viewer";
}

/** Escape for Oxide quoted args in maxxinvaders.spawn. */
function quoteRconArg(s: string): string {
  const cleaned = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${cleaned}"`;
}

/**
 * Send `maxxinvaders.spawn <viewerName> <viewerId> <tier> <kit|-> <mode>` over RCON.
 * Uses ViewerRoamingTemplateKey / tier defs on the server (anchor is null for console — no streamer protection from webhook).
 */
export async function maxxinvadersRconSpawn(params: {
  server: ServerRow;
  viewerDisplayName: string;
  viewerId: string;
  tier: number;
  kit: string;
  mode: string;
  connectionId: string | null;
  tikfinityEventName: string | null;
}): Promise<MaxxinvadersRconResult> {
  const nameTok = sanitizeToken(params.viewerDisplayName, 48);
  const idTok = sanitizeToken(params.viewerId, 80);
  const tier = Math.min(99, Math.max(1, Math.trunc(params.tier)));
  const kitRaw = params.kit.trim();
  const kitArg = kitRaw === "" || kitRaw === "-" ? "-" : sanitizeToken(kitRaw, 32);
  const modeArg = sanitizeToken(params.mode || "roaming", 24).toLowerCase();

  const command = `maxxinvaders.spawn ${quoteRconArg(nameTok)} ${quoteRconArg(idTok)} ${tier} ${kitArg} ${modeArg}`;
  const templateKey = `maxxinvaders:t${tier}:${modeArg}`;

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
      templateKey,
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
      templateKey,
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
    templateKey,
    command,
    status: "success",
  }).catch(() => {});

  return { ok: true, command };
}
