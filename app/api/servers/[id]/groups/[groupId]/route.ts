import { NextRequest, NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerWithRole, canManageServerAccess } from "@/lib/server-access";
import { ensureConnection, runAndWait } from "@/lib/rcon-manager";

type GroupRow = {
  id: string;
  server_id: string;
  name: string;
  description: string | null;
  created_at: Date;
};

type MemberRow = {
  id: string;
  group_id: string;
  player_id: string;
  player_name: string | null;
  created_at: Date;
};

function parseGroupPermissions(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Look for a simple "Permissions: ..." pattern first.
  const match = trimmed.match(/Permissions?:\s*([^\r\n]+)/i);
  if (match && match[1]) {
    return match[1]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim());
  const perms: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    const lower = line.toLowerCase();
    if (
      lower.includes("permission") ||
      lower.includes("perm ") ||
      lower.startsWith("oxide.") ||
      lower.startsWith("rust.") ||
      lower.startsWith("plugin.")
    ) {
      // Take the last token or split by ':' / ',' as fallback.
      const parts = line
        .replace(/^[-*\s]+/, "")
        .split(/[:,]/)
        .map((p) => p.trim())
        .filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && !perms.includes(last)) perms.push(last);
    }
  }
  return perms;
}

type ServerPlayer = {
  player_id: string;
  player_name: string | null;
};

function parseGroupPlayers(raw: string): ServerPlayer[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Example: Group 'minispawn' players: 7656... (Pirate Maxx), 7656... (Wildonicus) Group 'minispawn' permissions: ...
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
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId, groupId } = await params;

  const result = await getServerWithRole(serverId, session.userId, session.role);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { rows: groupRows } = await query<GroupRow>(
    "SELECT id, server_id, name, description, created_at FROM server_groups WHERE id = $1 AND server_id = $2",
    [groupId, serverId]
  );
  const group = groupRows[0];
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  const { rows: memberRows } = await query<MemberRow>(
    "SELECT id, group_id, player_id, player_name, created_at FROM server_group_members WHERE group_id = $1 ORDER BY created_at ASC",
    [groupId]
  );

  // Try to read permissions and players for this group from the live Rust server via Oxide.
  let permissions: string[] = [];
  let serverPlayers: ServerPlayer[] = [];
  if (pool) {
    try {
      const server = result.server;
      const connected = await ensureConnection(
        server.id,
        server.rcon_host,
        server.rcon_port,
        server.rcon_password,
        async () => {}
      );
      if (connected.ok) {
        const raw = await runAndWait(
          server.id,
          `oxide.show group ${group.name}`,
          8000
        );
        permissions = parseGroupPermissions(raw);
        serverPlayers = parseGroupPlayers(raw);
      }
    } catch {
      // Ignore RCON errors; just don't return permissions/players.
      permissions = [];
      serverPlayers = [];
    }
  }

  return NextResponse.json({
    group: {
      ...group,
      created_at: group.created_at.toISOString(),
    },
    members: memberRows.map((m) => ({
      ...m,
      created_at: m.created_at.toISOString(),
    })),
    permissions,
    serverPlayers,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId, groupId } = await params;

  const result = await getServerWithRole(serverId, session.userId, session.role);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canManageServerAccess(result.serverRole)) {
    return NextResponse.json(
      { error: "Only owner or server admin can delete groups" },
      { status: 403 }
    );
  }

  // Look up the group name before deleting so we can also remove it from Oxide.
  const { rows: groupRows } = await query<GroupRow>(
    "SELECT id, server_id, name FROM server_groups WHERE id = $1 AND server_id = $2",
    [groupId, serverId]
  );
  const group = groupRows[0];
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  // Delete from our DB (members will cascade via FK).
  await query("DELETE FROM server_groups WHERE id = $1", [groupId]);

  // Best-effort: also remove the Oxide group.
  if (pool) {
    try {
      const server = result.server;
      const connected = await ensureConnection(
        server.id,
        server.rcon_host,
        server.rcon_port,
        server.rcon_password,
        async () => {}
      );
      if (connected.ok) {
        await runAndWait(server.id, `oxide.group remove ${group.name}`, 8000);
      }
    } catch {
      // Ignore RCON errors so delete still succeeds in RustMaxx.
    }
  }

  return NextResponse.json({ ok: true });
}

