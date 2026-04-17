import { query } from "@/lib/db";
import type { ServerRow } from "@/lib/db";
import {
  getDefaultGiftValue,
  isRustChaosStatusEffectAction,
  parseRustChaosStatusDurationSeconds,
  type TikTriggerAction,
} from "@/lib/tikfinity";
import { ensureConnection, runAndWait } from "@/lib/rcon-manager";
import { getStreamerPolicyForServer } from "@/lib/streamer-action-policy";

function sanitizeArg(s: string, maxLen = 48): string {
  return s.replace(/\s+/g, "_").slice(0, maxLen) || "Viewer";
}

export type FanBoardTriggerBody = {
  amount?: number;
  duration?: number;
  seconds?: number;
  timer?: number;
};

/**
 * Run RustChaos via RCON for a fan-board button (same shape as TikFinity test / simple webhook path).
 */
export async function executeFanBoardRustChaos(params: {
  serverId: string;
  action: TikTriggerAction;
  viewerDisplayName: string;
  body?: FanBoardTriggerBody;
}): Promise<
  { ok: true; command: string; rconResponse?: string } | { ok: false; error: string; step?: string; command?: string }
> {
  const policy = await getStreamerPolicyForServer(params.serverId);
  if (!policy?.enabled) {
    return { ok: false, error: "Streamer interactions are disabled for this server." };
  }
  const allow = new Set(policy.effectiveActions ?? []);
  if (!allow.has(params.action)) {
    return { ok: false, error: "This action is not enabled on the target server for streamers." };
  }

  const { rows } = await query<ServerRow>(
    "SELECT id, name, rcon_host, rcon_port, rcon_password FROM servers WHERE id = $1",
    [params.serverId]
  );
  const server = rows[0];
  if (!server) return { ok: false, error: "Server not found." };

  const viewerArg = sanitizeArg(params.viewerDisplayName);
  const giftArg = sanitizeArg("FanBoard");
  const body = params.body ?? {};
  const scrapAmount = (() => {
    const raw =
      typeof body.amount === "number" && Number.isFinite(body.amount)
        ? Math.trunc(body.amount)
        : getDefaultGiftValue("FanBoard");
    return Math.min(10000, Math.max(0, raw));
  })();

  const fourthArg = isRustChaosStatusEffectAction(params.action)
    ? parseRustChaosStatusDurationSeconds(new URLSearchParams(), body, scrapAmount)
    : scrapAmount;

  const command = `rustchaos ${params.action} ${viewerArg} ${giftArg} ${fourthArg}`;

  const connected = await ensureConnection(
    server.id,
    server.rcon_host,
    server.rcon_port,
    server.rcon_password,
    async () => {}
  );
  if (!connected.ok) {
    return {
      ok: false,
      error: connected.error?.trim() || "Could not connect to game server",
      step: "rcon_connect",
      command,
    };
  }

  let rconResponse = "";
  try {
    rconResponse = (await runAndWait(server.id, command, 15000)).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, step: "rcon_wait", command };
  }

  const failed =
    /^FAILED:/i.test(rconResponse) ||
    /^Unknown action:/i.test(rconResponse) ||
    /^Error:/i.test(rconResponse);
  if (failed) {
    return { ok: false, error: rconResponse || "Game server rejected the action.", step: "rcon_reply", command };
  }

  return { ok: true, command, rconResponse: rconResponse || undefined };
}
