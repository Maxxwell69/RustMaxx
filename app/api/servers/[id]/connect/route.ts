import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { query } from "@/lib/db";
import { ensureConnection } from "@/lib/rcon-manager";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerIfAccessible } from "@/lib/server-access";

async function persistLog(serverId: string, type: "console" | "chat", message: string) {
  if (!pool) return;
  query(
    "INSERT INTO logs (server_id, type, message) VALUES ($1, $2, $3)",
    [serverId, type, message]
  ).catch(() => {});
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authErr = requireSession(request);
    if (authErr) return authErr;
    const session = getSessionFromRequest(request)!;
    if (!pool) {
      return NextResponse.json(
        { ok: false, error: "DATABASE_URL is not set. Add it to .env to use servers and RCON." },
        { status: 503 }
      );
    }
    const { id: serverId } = await params;
    const server = await getServerIfAccessible(serverId, session.userId, session.role);
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
