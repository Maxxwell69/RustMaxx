import { NextRequest, NextResponse } from "next/server";
import { runAndWait } from "@/lib/rcon-manager";

function parsePlayerlist(raw: string): { id: string; name: string }[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Rust `playerlist` often returns JSON. Try JSON first.
  try {
    const json = JSON.parse(trimmed) as unknown;
    const out: { id: string; name: string }[] = [];

    const push = (id: unknown, name: unknown) => {
      const sid = typeof id === "string" ? id : typeof id === "number" ? String(id) : "";
      const sname = typeof name === "string" ? name : typeof name === "number" ? String(name) : "";
      const cleanId = sid.trim();
      const cleanName = (sname.trim() || cleanId).trim();
      if (cleanId) out.push({ id: cleanId, name: cleanName });
    };

    if (Array.isArray(json)) {
      for (const row of json) {
        if (row && typeof row === "object") {
          const r = row as Record<string, unknown>;
          push(
            r.SteamID ?? r.steamid ?? r.UserID ?? r.userid ?? r.id,
            r.DisplayName ?? r.displayName ?? r.Username ?? r.username ?? r.Name ?? r.name
          );
        } else {
          push(row, row);
        }
      }
      if (out.length) return out;
    }

    if (json && typeof json === "object") {
      const obj = json as Record<string, unknown>;
      // Handle edge cases where JSON is a map of ids -> names
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string") push(k, v);
      }
      if (out.length) return out;
    }
  } catch {
    // fall back to line parsing
  }

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
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
