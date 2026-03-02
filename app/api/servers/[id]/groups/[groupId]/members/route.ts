import { NextRequest, NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerWithRole, canManageServerAccess } from "@/lib/server-access";
import { ensureConnection, runAndWait } from "@/lib/rcon-manager";

type MemberRow = {
  id: string;
  group_id: string;
  player_id: string;
  player_name: string | null;
  created_at: Date;
};

export async function POST(
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
      { error: "Only owner or server admin can edit groups" },
      { status: 403 }
    );
  }

  let body: { player_id?: string; player_name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawId = typeof body.player_id === "string" ? body.player_id.trim() : "";
  if (!rawId) {
    return NextResponse.json({ error: "player_id is required" }, { status: 400 });
  }
  const playerName =
    typeof body.player_name === "string" ? body.player_name.trim() || null : null;

  // Look up group name so we can sync with Oxide.
  const { rows: groupRows } = await query<{ name: string }>(
    "SELECT name FROM server_groups WHERE id = $1 AND server_id = $2",
    [groupId, serverId]
  );
  const group = groupRows[0];
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  // Best-effort: add player to Oxide group first.
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
      if (!connected.ok) {
        return NextResponse.json(
          {
            error:
              connected.error ||
              "Could not connect to Rust server to add player to group.",
          },
          { status: 502 }
        );
      }
      // Standard Oxide syntax: oxide.usergroup add <user> <group>
      await runAndWait(server.id, `oxide.usergroup add ${rawId} ${group.name}`, 8000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: msg || "Rust server did not accept the usergroup add command." },
        { status: 502 }
      );
    }
  }

  const { rows } = await query<MemberRow>(
    `INSERT INTO server_group_members (group_id, player_id, player_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (group_id, player_id)
     DO UPDATE SET player_name = EXCLUDED.player_name
     RETURNING id, group_id, player_id, player_name, created_at`,
    [groupId, rawId, playerName]
  );

  const m = rows[0];
  return NextResponse.json({
    ...m,
    created_at: m.created_at.toISOString(),
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
      { error: "Only owner or server admin can edit groups" },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get("player_id")?.trim();
  if (!playerId) {
    return NextResponse.json({ error: "player_id is required" }, { status: 400 });
  }

  // Look up group name so we can sync with Oxide.
  const { rows: groupRows } = await query<{ name: string }>(
    "SELECT name FROM server_groups WHERE id = $1 AND server_id = $2",
    [groupId, serverId]
  );
  const group = groupRows[0];
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  // Best-effort: remove player from Oxide group first.
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
      if (!connected.ok) {
        return NextResponse.json(
          {
            error:
              connected.error ||
              "Could not connect to Rust server to remove player from group.",
          },
          { status: 502 }
        );
      }
      // Standard Oxide syntax: oxide.usergroup remove <user> <group>
      await runAndWait(
        server.id,
        `oxide.usergroup remove ${playerId} ${group.name}`,
        8000
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: msg || "Rust server did not accept the usergroup remove command." },
        { status: 502 }
      );
    }
  }

  await query(
    "DELETE FROM server_group_members WHERE group_id = $1 AND player_id = $2",
    [groupId, playerId]
  );

  return NextResponse.json({ ok: true });
}

