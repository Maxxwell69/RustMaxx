/**
 * Fetch Rust map info (seed, world size, level) via RCON.
 * Uses the existing WebRCON connection from rcon-manager.
 */

import { ensureConnection, runAndWait } from "@/lib/rcon-manager";
import { pool } from "@/lib/db";
import type { ServerRow } from "@/lib/db";

export type RustMapInfo = {
  seed: number | null;
  worldSize: number | null;
  level: string | null;
};

const COMMANDS_PRIMARY = [
  { key: "seed" as const, cmd: "global.printvar server.seed" },
  { key: "worldSize" as const, cmd: "global.printvar server.worldsize" },
  { key: "level" as const, cmd: "global.printvar server.level" },
];
const COMMANDS_FALLBACK = [
  { key: "seed" as const, cmd: "server.seed" },
  { key: "worldSize" as const, cmd: "server.worldsize" },
  { key: "level" as const, cmd: "server.level" },
];

function parseSeed(raw: string): number | null {
  const t = raw.trim();
  const num = parseInt(t.replace(/^[^0-9-]*([0-9-]+)[\s\S]*$/, "$1"), 10);
  if (Number.isInteger(num)) return num;
  const direct = parseInt(t, 10);
  return Number.isInteger(direct) ? direct : null;
}

function parseWorldSize(raw: string): number | null {
  const t = raw.trim();
  const num = parseInt(t.replace(/^[^0-9]*([0-9]+)[\s\S]*$/, "$1"), 10);
  if (Number.isInteger(num) && num >= 1000 && num <= 6000) return num;
  const direct = parseInt(t, 10);
  return Number.isInteger(direct) && direct >= 1000 && direct <= 6000 ? direct : null;
}

function parseLevel(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  const known = ["procedural", "barren", "hapis", "savas", "savasisland"];
  for (const k of known) {
    if (lower.includes(k)) return k;
  }
  const quoted = t.match(/"([^"]+)"/);
  if (quoted) return quoted[1].trim() || null;
  const afterColon = t.replace(/^[^:]*:\s*/, "").trim();
  if (afterColon) return afterColon;
  return t.length <= 64 ? t : null;
}

export async function ensureMapConnection(
  serverId: string,
  server: ServerRow
): Promise<{ ok: boolean; error?: string }> {
  if (!pool)
    return { ok: false, error: "Server not configured. Connect from the server page first." };
  return ensureConnection(
    server.id,
    server.rcon_host,
    server.rcon_port,
    server.rcon_password,
    async () => {}
  );
}

/**
 * Fetch map info from the Rust server via RCON.
 * Tries global.printvar first, then server.seed / server.worldsize / server.level.
 */
export async function fetchRustMapInfo(
  serverId: string,
  server: ServerRow
): Promise<{ ok: boolean; error?: string; data?: RustMapInfo }> {
  const connected = await ensureMapConnection(serverId, server);
  if (!connected.ok) return { ok: false, error: connected.error };

  const result: RustMapInfo = { seed: null, worldSize: null, level: null };
  const timeout = 8000;

  for (const { key, cmd } of COMMANDS_PRIMARY) {
    try {
      const response = await runAndWait(serverId, cmd, timeout);
      const raw = (response ?? "").trim();
      if (key === "seed") result.seed = parseSeed(raw);
      else if (key === "worldSize") result.worldSize = parseWorldSize(raw);
      else if (key === "level") result.level = parseLevel(raw);
    } catch {
      // try fallback for this key
      try {
        const fallback = COMMANDS_FALLBACK.find((f) => f.key === key);
        if (fallback) {
          const response = await runAndWait(serverId, fallback.cmd, timeout);
          const raw = (response ?? "").trim();
          if (key === "seed") result.seed = parseSeed(raw);
          else if (key === "worldSize") result.worldSize = parseWorldSize(raw);
          else if (key === "level") result.level = parseLevel(raw);
        }
      } catch {
        // leave null
      }
    }
  }

  return { ok: true, data: result };
}
