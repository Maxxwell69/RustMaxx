import { NextRequest, NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerIfAccessible } from "@/lib/server-access";
import { ensureConnection, runAndWait } from "@/lib/rcon-manager";

type StoredPlayer = {
  player_id: string;
  player_name: string | null;
};

function parseOxideGroups(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const match = trimmed.match(/Groups:\s*([^\r\n]+)/i);
  if (match && match[1]) {
    return match[1]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return [];
}

type ServerPlayer = { player_id: string; player_name: string | null };

function parseGroupPlayers(raw: string): ServerPlayer[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const match = trimmed.match(/players:\s*([\s\S]*?)(?:Group\b|permissions?:|\r?\n|$)/i);
  if (!match || !match[1]) return [];
  const segment = match[1];
  const entries = segment.split(",").map((p) => p.trim()).filter(Boolean);
  const out: ServerPlayer[] = [];
  for (const entry of entries) {
    const idMatch = entry.match(/(\d{5,})/);
    const nameMatch = entry.match(/\(([^)]+)\)/);
    const player_id = idMatch ? idMatch[1] : entry;
    const player_name = nameMatch ? nameMatch[1].trim() : null;
    if (player_id && !out.some((p) => p.player_id === player_id)) {
      out.push({ player_id, player_name });
    }
  }
  return out;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;

  // Players that have been seen by RustMaxx on this server (via groups/members).
  const { rows: stored } = await query<StoredPlayer>(
    `SELECT DISTINCT m.player_id, m.player_name
     FROM server_group_members m
     JOIN server_groups g ON g.id = m.group_id
     WHERE g.server_id = $1`,
    [serverId]
  );

  // If we have no stored players and no server access, nothing to show.
  if (!pool) {
    return NextResponse.json(
      stored.map((p) => ({ ...p, active: false }))
    );
  }

  const server = await getServerIfAccessible(serverId, session.userId, session.role);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const activeIds = new Set<string>();
  const activePlayersById = new Map<string, ServerPlayer>();

  try {
    const connected = await ensureConnection(
      server.id,
      server.rcon_host,
      server.rcon_port,
      server.rcon_password,
      async () => {}
    );
    if (connected.ok) {
      // Get groups from Oxide, then players in each group.
      const rawGroups = await runAndWait(server.id, "oxide.show groups", 8000);
      const groups = parseOxideGroups(rawGroups);
      for (const g of groups) {
        try {
          const raw = await runAndWait(server.id, `oxide.show group ${g}`, 8000);
          const players = parseGroupPlayers(raw);
          for (const p of players) {
            activeIds.add(p.player_id);
            if (!activePlayersById.has(p.player_id)) {
              activePlayersById.set(p.player_id, p);
            }
          }
        } catch {
          // Ignore errors per group.
        }
      }
    }
  } catch {
    // If server access fails, we'll just fall back to stored data.
  }

  // Merge stored players (DB) with active players discovered from Oxide.
  const byId = new Map<string, { player_id: string; player_name: string | null }>();
  for (const p of stored) {
    byId.set(p.player_id, { player_id: p.player_id, player_name: p.player_name });
  }
  for (const [id, p] of activePlayersById.entries()) {
    if (!byId.has(id)) {
      byId.set(id, { player_id: p.player_id, player_name: p.player_name });
    } else {
      const existing = byId.get(id)!;
      if (!existing.player_name && p.player_name) {
        existing.player_name = p.player_name;
      }
    }
  }

  const result = Array.from(byId.values()).map((p) => ({
    ...p,
    active: activeIds.has(p.player_id),
  }));

  return NextResponse.json(result);
}

