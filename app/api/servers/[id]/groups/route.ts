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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;
  const result = await getServerWithRole(serverId, session.userId, session.role);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { rows } = await query<GroupRow>(
    "SELECT id, server_id, name, description, created_at FROM server_groups WHERE server_id = $1 ORDER BY created_at ASC",
    [serverId]
  );

  return NextResponse.json(
    rows.map((g) => ({
      ...g,
      created_at: g.created_at.toISOString(),
    }))
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;
  const result = await getServerWithRole(serverId, session.userId, session.role);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canManageServerAccess(result.serverRole)) {
    return NextResponse.json(
      { error: "Only owner or server admin can manage groups" },
      { status: 403 }
    );
  }

  let body: { name?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  if (!rawName) {
    return NextResponse.json({ error: "Group name is required." }, { status: 400 });
  }
  // Oxide/uMod group names cannot contain spaces; they must be a single token.
  if (/\s/.test(rawName)) {
    return NextResponse.json(
      { error: "Group name cannot contain spaces. Use letters, numbers, - or _ (e.g. admin2 or staff_vip)." },
      { status: 400 }
    );
  }
  const description =
    typeof body.description === "string" ? body.description.trim() || null : null;

  try {
    // First, ensure the group exists on the live Rust server via Oxide.
    if (pool) {
      const server = result.server;
      const connected = await ensureConnection(
        server.id,
        server.rcon_host,
        server.rcon_port,
        server.rcon_password,
        async () => {}
      );
      if (!connected.ok) {
        throw new Error(
          connected.error ||
            "Could not connect to Rust server to create group. Make sure the server is online and RCON settings are correct."
        );
      }
      try {
        // oxide.group add <name>
        await runAndWait(server.id, `oxide.group add ${rawName}`, 8000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          msg || "Rust server did not accept the oxide.group add command for this group."
        );
      }
    }

    // If RCON succeeded (or pool is not configured), persist the group in RustMaxx.
    const { rows } = await query<GroupRow>(
      `INSERT INTO server_groups (server_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING id, server_id, name, description, created_at`,
      [serverId, rawName, description]
    );
    const g = rows[0];

    return NextResponse.json({
      ...g,
      created_at: g.created_at.toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("idx_server_groups_server_name")) {
      return NextResponse.json(
        { error: "A group with that name already exists on this server." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: msg || "Insert failed" }, { status: 500 });
  }
}

