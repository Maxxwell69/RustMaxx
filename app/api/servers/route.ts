import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCanManageServers, getSessionFromRequest } from "@/lib/api-auth";
import type { ServerRow } from "@/lib/db";

export async function GET() {
  try {
    const { rows } = await query<ServerRow>(
      "SELECT id, name, rcon_host, rcon_port, created_at, listed, listing_name, listing_description, game_host, game_port, location, logo_url FROM servers ORDER BY created_at DESC"
    );
    return NextResponse.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("location") || msg.includes("logo_url") || msg.includes("does not exist")) {
      const { rows } = await query<ServerRow>(
        "SELECT id, name, rcon_host, rcon_port, created_at, listed, listing_name, listing_description, game_host, game_port FROM servers ORDER BY created_at DESC"
      );
      return NextResponse.json(rows.map((r) => ({ ...r, location: null, logo_url: null })));
    }
    throw err;
  }
}

export async function POST(request: NextRequest) {
  const authErr = requireCanManageServers(request);
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
      `INSERT INTO servers (name, rcon_host, rcon_port, rcon_password, listed, listing_name, listing_description, game_host, game_port, location, logo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, name, rcon_host, rcon_port, created_at, listed, listing_name, listing_description, game_host, game_port, location, logo_url`,
      [name, host, portNum, password, listed, listingName, listingDesc, gameHost, gamePortNum, location, logoUrl]
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
          `INSERT INTO servers (name, rcon_host, rcon_port, rcon_password, listed, listing_name, listing_description, game_host, game_port)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, name, rcon_host, rcon_port, created_at, listed, listing_name, listing_description, game_host, game_port`,
          [name, host, portNum, password, listed, listingName, listingDesc, gameHost, gamePortNum]
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
          "INSERT INTO servers (name, rcon_host, rcon_port, rcon_password) VALUES ($1, $2, $3, $4) RETURNING id, name, rcon_host, rcon_port, created_at",
          [name, host, portNum, password]
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
