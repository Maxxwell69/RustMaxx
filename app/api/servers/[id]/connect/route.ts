import { NextRequest, NextResponse } from "next/server";
import { query, pool } from "@/lib/db";
import { ensureConnection } from "@/lib/rcon-manager";
import type { ServerRow } from "@/lib/db";

async function persistLog(serverId: string, type: "console" | "chat", message: string) {
  if (!pool) return;
  query(
    "INSERT INTO logs (server_id, type, message) VALUES ($1, $2, $3)",
    [serverId, type, message]
  ).catch(() => {});
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!pool) {
      return NextResponse.json(
        { ok: false, error: "DATABASE_URL is not set. Add it to .env to use servers and RCON." },
        { status: 503 }
      );
    }
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
      const msg = result.error ?? "Connection failed";
      console.error("[RCON connect]", serverId, msg);
      return NextResponse.json(
        { ok: false, error: msg },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[RCON connect]", message);
    return NextResponse.json(
      { ok: false, error: message || "Connection failed" },
      { status: 502 }
    );
  }
}
