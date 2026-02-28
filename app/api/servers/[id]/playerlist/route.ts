import { NextRequest, NextResponse } from "next/server";
import { runAndWait } from "@/lib/rcon-manager";

function parsePlayerlist(raw: string): { id: string; name: string }[] {
  const lines = raw.trim().split(/\r?\n/).filter((l) => l.trim());
  const players: { id: string; name: string }[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/\s+/);
    if (parts.length >= 2) {
      const id = parts[0]!.replace(/[^\w.-]/g, "");
      const name = parts.slice(1).join(" ").trim() || id;
      if (id) players.push({ id, name });
    } else if (parts.length === 1 && parts[0]) {
      players.push({ id: parts[0], name: parts[0] });
    }
  }
  return players;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: serverId } = await params;
  try {
    const raw = await runAndWait(serverId, "playerlist", 8000);
    const players = parsePlayerlist(raw);
    return NextResponse.json({ players });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, players: [] }, { status: 502 });
  }
}
