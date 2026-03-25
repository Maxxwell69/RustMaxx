import type { ServerRow } from "@/lib/db";
import { ensureConnection, runAndWait } from "@/lib/rcon-manager";
import { insertRnpcSpawnEvent } from "@/lib/rnpc-spawn-events";

export type MaxxinvadersRconResult =
  | { ok: true; command: string; rconResponse: string }
  | {
      ok: false;
      command: string;
      error: string;
      step: "rcon_connect" | "rcon_send" | "rcon_reply";
    };

/** Oxide maxxinvaders.spawn replies with OK npcId=… or Error: … */
function isMaxxInvadersSpawnOkReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^error\b/i.test(t) || /\berror\s*:/i.test(t)) return false;
  if (/^usage\s*:/i.test(t) || /^invalid\b/i.test(t)) return false;
  return /^OK\b/i.test(t) || /\bnpcId\s*=/i.test(t);
}

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
 * Send `maxxinvaders.spawn … [roamingBotKey]` over RCON (6th arg = RoamingNPCs bot key, e.g. streamer_patrol).
 */
export async function maxxinvadersRconSpawn(params: {
  server: ServerRow;
  viewerDisplayName: string;
  viewerId: string;
  tier: number;
  kit: string;
  mode: string;
  /** RoamingNPCs Bots key (letters, numbers, _, -). Passed as 6th RCON arg so webhook can force e.g. streamer_patrol. */
  roamingBotKey: string;
  connectionId: string | null;
  tikfinityEventName: string | null;
}): Promise<MaxxinvadersRconResult> {
  const nameTok = sanitizeToken(params.viewerDisplayName, 48);
  const idTok = sanitizeToken(params.viewerId, 80);
  const tier = Math.min(99, Math.max(1, Math.trunc(params.tier)));
  const kitRaw = params.kit.trim();
  const kitArg = kitRaw === "" || kitRaw === "-" ? "-" : sanitizeToken(kitRaw, 32);
  const modeArg = sanitizeToken(params.mode || "roaming", 24).toLowerCase();
  const botTok = sanitizeToken(params.roamingBotKey, 64);

  const command = `maxxinvaders.spawn ${quoteRconArg(nameTok)} ${quoteRconArg(idTok)} ${tier} ${kitArg} ${modeArg} ${quoteRconArg(botTok)}`;
  const templateKey = `maxxinvaders:t${tier}:${modeArg}:${botTok}`;

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

  let reply: string;
  try {
    reply = (await runAndWait(params.server.id, command, 20000)).trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await insertRnpcSpawnEvent({
      serverId: params.server.id,
      connectionId: params.connectionId,
      tikfinityEventName: params.tikfinityEventName,
      viewerName: params.viewerDisplayName,
      templateKey,
      command,
      status: "failed",
      errorMessage: msg,
    }).catch(() => {});
    return {
      ok: false,
      command,
      error: msg,
      step: "rcon_reply",
    };
  }

  if (!isMaxxInvadersSpawnOkReply(reply)) {
    await insertRnpcSpawnEvent({
      serverId: params.server.id,
      connectionId: params.connectionId,
      tikfinityEventName: params.tikfinityEventName,
      viewerName: params.viewerDisplayName,
      templateKey,
      command,
      status: "failed",
      errorMessage: reply || "empty RCON reply",
    }).catch(() => {});
    return {
      ok: false,
      command,
      error: reply || "MaxxInvaders did not confirm spawn (check game console and MaxxInvaders.json).",
      step: "rcon_reply",
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

  return { ok: true, command, rconResponse: reply };
}
