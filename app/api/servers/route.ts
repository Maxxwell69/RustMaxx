import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { findUserById } from "@/lib/users";
import type { ServerRow } from "@/lib/db";

type ServerWithRole = ServerRow & { myRole?: "owner" | "admin" | "moderator" };

export async function GET(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const user = await findUserById(session.userId);
  const isSuperAdmin = (user?.role ?? session.role) === "super_admin";
  try {
    let rows: ServerWithRole[];
    if (isSuperAdmin) {
      const r = await query<ServerRow>(
        "SELECT id, name, rcon_host, rcon_port, created_at, owner_id, listed, listing_name, listing_description, game_host, game_port, location, logo_url FROM servers ORDER BY created_at DESC"
      );
      rows = r.rows.map((s) => ({ ...s, myRole: "owner" as const }));
    } else {
      const r = await query<
        ServerRow & { my_role: string }
      >(
        `SELECT s.id, s.name, s.rcon_host, s.rcon_port, s.created_at, s.listed, s.listing_name, s.listing_description, s.game_host, s.game_port, s.location, s.logo_url,
                CASE WHEN s.owner_id = $1 THEN 'owner' WHEN su.role = 'admin' THEN 'admin' ELSE 'moderator' END AS my_role
         FROM servers s
         LEFT JOIN server_users su ON su.server_id = s.id AND su.user_id = $1 AND su.role IN ('admin', 'moderator')
         WHERE s.owner_id = $1 OR su.user_id IS NOT NULL
         ORDER BY s.created_at DESC`,
        [session.userId]
      );
      rows = r.rows.map(({ my_role, ...s }) => ({ ...s, myRole: my_role as "owner" | "admin" | "moderator" }));
    }
    return NextResponse.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("owner_id") || msg.includes("server_users") || msg.includes("does not exist")) {
      const { rows } = await query<ServerRow>(
        "SELECT id, name, rcon_host, rcon_port, created_at, listed, listing_name, listing_description, game_host, game_port, location, logo_url FROM servers WHERE owner_id = $1 ORDER BY created_at DESC",
        [session.userId]
      );
      return NextResponse.json(rows.map((s) => ({ ...s, myRole: "owner" as const })));
    }
    if (msg.includes("location") || msg.includes("logo_url")) {
      const r = await query<ServerRow>(
        "SELECT id, name, rcon_host, rcon_port, created_at, listed, listing_name, listing_description, game_host, game_port FROM servers WHERE owner_id = $1 ORDER BY created_at DESC",
        [session.userId]
      );
      return NextResponse.json(r.rows.map((s) => ({ ...s, location: null, logo_url: null, myRole: "owner" as const })));
    }
    throw err;
  }
}

export async function POST(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;

  let body: {
    name?: string;
    host?: string;
    port?: number;
    password?: string;
    listed?: boolean;
    listing_name?: string;
    listing_description?: string;
    game_host?: string;
    game_port?: number;
    location?: string;
    logo_url?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const host = typeof body.host === "string" ? body.host.trim() : "";
  const port = typeof body.port === "number" ? body.port : Number(body.port);
  const password = typeof body.password === "string" ? body.password : "";
  if (!name || !host || !password) {
    return NextResponse.json({ error: "name, host, and password are required" }, { status: 400 });
  }
  const portNum = Number(port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return NextResponse.json({ error: "port must be 1-65535" }, { status: 400 });
  }
  const listed = Boolean(body.listed);
  const listingName = typeof body.listing_name === "string" ? body.listing_name.trim() || null : null;
  const listingDesc = typeof body.listing_description === "string" ? body.listing_description.trim() || null : null;
  const gameHost = typeof body.game_host === "string" ? body.game_host.trim() || null : null;
  const gamePort = typeof body.game_port === "number" ? body.game_port : body.game_port != null ? Number(body.game_port) : null;
  const gamePortNum = gamePort != null && Number.isInteger(gamePort) && gamePort >= 1 && gamePort <= 65535 ? gamePort : null;
  const location = typeof body.location === "string" ? body.location.trim() || null : null;
  const logoUrl = typeof body.logo_url === "string" ? body.logo_url.trim() || null : null;

  try {
    const { rows } = await query<ServerRow>(
      `INSERT INTO servers (name, rcon_host, rcon_port, rcon_password, owner_id, listed, listing_name, listing_description, game_host, game_port, location, logo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, name, rcon_host, rcon_port, created_at, listed, listing_name, listing_description, game_host, game_port, location, logo_url`,
      [name, host, portNum, password, session.userId, listed, listingName, listingDesc, gameHost, gamePortNum, location, logoUrl]
    );
    const server = rows[0];
    if (!server) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    await audit(session.userId, "server.create", { serverId: server.id, name: server.name });
    return NextResponse.json(server);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const missingColumn = msg.includes("does not exist");
    if (missingColumn && (msg.includes("location") || msg.includes("logo_url"))) {
      try {
        const { rows } = await query<ServerRow>(
          `INSERT INTO servers (name, rcon_host, rcon_port, rcon_password, owner_id, listed, listing_name, listing_description, game_host, game_port)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, name, rcon_host, rcon_port, created_at, listed, listing_name, listing_description, game_host, game_port`,
          [name, host, portNum, password, session.userId, listed, listingName, listingDesc, gameHost, gamePortNum]
        );
        const server = rows[0];
        if (!server) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
        await audit(session.userId, "server.create", { serverId: server.id, name: server.name });
        return NextResponse.json({ ...server, location: null, logo_url: null });
      } catch {
        //
      }
    }
    if (missingColumn && (msg.includes("listed") || msg.includes("listing_name") || msg.includes("game_host"))) {
      try {
        const { rows } = await query<ServerRow>(
          "INSERT INTO servers (name, rcon_host, rcon_port, rcon_password, owner_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, rcon_host, rcon_port, created_at",
          [name, host, portNum, password, session.userId]
        );
        const server = rows[0];
        if (!server) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
        await audit(session.userId, "server.create", { serverId: server.id, name: server.name });
        return NextResponse.json({
          ...server,
          listed: false,
          listing_name: null,
          listing_description: null,
          game_host: null,
          game_port: null,
          location: null,
          logo_url: null,
        });
      } catch {
        //
      }
    }
    return NextResponse.json(
      { error: msg.includes("does not exist") ? "Database schema is out of date. Run: npm run migrate" : msg || "Insert failed" },
      { status: msg.includes("does not exist") ? 503 : 500 }
    );
  }
}
