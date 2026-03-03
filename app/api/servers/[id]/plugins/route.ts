import { NextRequest, NextResponse } from "next/server";
import { ensureConnection, runAndWait } from "@/lib/rcon-manager";
import { pool } from "@/lib/db";
import type { ServerRow } from "@/lib/db";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerIfAccessible } from "@/lib/server-access";
import { parseOxidePluginsOutput } from "@/lib/oxide-plugins";

async function ensureConnected(
  serverId: string,
  server: ServerRow
): Promise<{ ok: boolean; error?: string }> {
  if (!pool)
    return {
      ok: false,
      error: "Server not configured. Connect from the server page first.",
    };
  return ensureConnection(
    server.id,
    server.rcon_host,
    server.rcon_port,
    server.rcon_password,
    async () => {}
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;
  const server = await getServerIfAccessible(serverId, session.userId, session.role);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const connected = await ensureConnected(serverId, server);
    if (!connected.ok) {
      return NextResponse.json(
        {
          error: connected.error ?? "Not connected",
          code: "not_connected",
          plugins: [],
          failed: [],
        },
        { status: 502 }
      );
    }

    const response = await runAndWait(serverId, "oxide.plugins", 15000);
    const { plugins, failed } = parseOxidePluginsOutput(response ?? "");
    return NextResponse.json({ plugins, failed, raw: response });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[plugins] error", serverId, message);
    return NextResponse.json(
      { error: message, code: "rcon_error", plugins: [], failed: [] },
      { status: 502 }
    );
  }
}
