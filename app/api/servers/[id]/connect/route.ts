import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { ensureConnection } from "@/lib/rcon-manager";
import type { ServerRow } from "@/lib/db";

async function persistLog(serverId: string, type: "console" | "chat", message: string) {
  await query(
    "INSERT INTO logs (server_id, type, message) VALUES ($1, $2, $3)",
    [serverId, type, message]
  );
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: serverId } = await params;
    const { rows } = await query<ServerRow>(
      "SELECT id, rcon_host, rcon_port, rcon_password FROM servers WHERE id = $1",
      [serverId]
    );
    const server = rows[0];
    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const result = await ensureConnection(
      server.id,
      server.rcon_host,
      server.rcon_port,
      server.rcon_password,
      persistLog
    );
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "Connection failed" },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message || "Connection failed" },
      { status: 502 }
    );
  }
}
