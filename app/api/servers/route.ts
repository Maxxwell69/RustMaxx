import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { ServerRow } from "@/lib/db";

export async function GET() {
  const { rows } = await query<ServerRow>("SELECT id, name, rcon_host, rcon_port, created_at FROM servers ORDER BY created_at DESC");
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  let body: { name?: string; host?: string; port?: number; password?: string };
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
  const { rows } = await query<ServerRow>(
    "INSERT INTO servers (name, rcon_host, rcon_port, rcon_password) VALUES ($1, $2, $3, $4) RETURNING id, name, rcon_host, rcon_port, created_at",
    [name, host, portNum, password]
  );
  const server = rows[0];
  if (!server) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  await audit("admin", "server.create", { serverId: server.id, name: server.name });
  return NextResponse.json(server);
}
