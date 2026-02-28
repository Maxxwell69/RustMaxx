import { NextRequest, NextResponse } from "next/server";
import { ensureConnection, runAndWait } from "@/lib/rcon-manager";
import { query, pool } from "@/lib/db";
import type { ServerRow } from "@/lib/db";
import { audit } from "@/lib/audit";

async function ensureConnected(serverId: string): Promise<{ ok: boolean; error?: string }> {
  if (!pool) return { ok: false, error: "Server not configured (no database). Connect from the server page first." };
  const { rows } = await query<ServerRow>(
    "SELECT id, rcon_host, rcon_port, rcon_password FROM servers WHERE id = $1",
    [serverId]
  );
  const server = rows[0];
  if (!server) return { ok: false, error: "Server not found" };

  return ensureConnection(
    server.id,
    server.rcon_host,
    server.rcon_port,
    server.rcon_password,
    async () => {}
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: serverId } = await params;
  let body: { command?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!command) {
    return NextResponse.json({ error: "command is required" }, { status: 400 });
  }

  try {
    const connected = await ensureConnected(serverId);
    if (!connected.ok) {
      const err = connected.error ?? "Not connected";
      console.error("[run] ensureConnected failed", serverId, err);
      return NextResponse.json(
        { ok: false, error: err },
        { status: 502 }
      );
    }

    const response = await runAndWait(serverId, command, 15000);
    audit("admin", "command.run", { serverId, command }).catch(() => {});
    return NextResponse.json({ ok: true, response });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[run] error", serverId, command, message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

