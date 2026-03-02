import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { ensureConnection, runAndWait } from "@/lib/rcon-manager";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerIfAccessible } from "@/lib/server-access";

function parseOxideGroups(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Prefer a simple \"Groups: ...\" pattern anywhere in the output.
  const headerMatch = trimmed.match(/Groups:\s*([^\r\n]+)/i);
  if (headerMatch && headerMatch[1]) {
    return headerMatch[1]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim());
  const groups: string[] = [];

  for (const line of lines) {
    if (!line) continue;
    const lower = line.toLowerCase();
    // Typical Oxide output is: "Groups: default, admin2, minispawn, admin7"
    if (lower.startsWith("groups:")) {
      const afterColon = line.split(":")[1] ?? "";
      const parts = afterColon
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      for (const p of parts) {
        if (!groups.includes(p)) groups.push(p);
      }
      continue;
    }
    // Skip obvious headers or noise lines
    if (
      lower.startsWith("oxide") ||
      lower.includes("usage") ||
      lower.includes("syntax") ||
      lower.includes("unknown command")
    ) {
      continue;
    }
    // Fallback: use first token as group name
    const name = line.split(/\s+/)[0]!;
    if (name && !groups.includes(name)) {
      groups.push(name);
    }
  }
  return groups;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;

  if (!pool) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set. Cannot connect to servers." },
      { status: 503 }
    );
  }

  const server = await getServerIfAccessible(serverId, session.userId, session.role);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const result = await ensureConnection(
      server.id,
      server.rcon_host,
      server.rcon_port,
      server.rcon_password,
      async () => {}
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "Not connected" },
        { status: 502 }
      );
    }

    // Oxide / uMod: show groups
    const raw = await runAndWait(server.id, "oxide.show groups", 8000);
    const groups = parseOxideGroups(raw);
    return NextResponse.json({ groups, raw });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message || "Failed to query groups" }, { status: 502 });
  }
}

