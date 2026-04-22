import { NextRequest, NextResponse } from "next/server";
import { ensureConnection, runAndWait } from "@/lib/rcon-manager";
import { pool } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerIfAccessible } from "@/lib/server-access";
import { parseSteam64Anchor } from "@/lib/maxxinvaders-anchor-steam";
import { findUserById } from "@/lib/users";

const PRESETS = {
  easy: "chaosraid_easy",
  medium: "chaosraid_medium",
  hard: "chaosraid_hard",
} as const;

function sanitizeArg(s: string, maxLen = 48): string {
  const t = String(s ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, maxLen);
  return t || "Viewer";
}

/**
 * Trigger a chaos raid (RandomRaids preset) via WebRCON — **not** the TikFinity webhook.
 * Same rustchaos command as TikFinity; uses synchronous RCON so the game plugin reliably runs.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;
  const server = await getServerIfAccessible(serverId, session.userId, session.role);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!pool) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: { preset?: string; viewerName?: string; giftName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const p = typeof body.preset === "string" ? body.preset.trim().toLowerCase() : "";
  if (p !== "easy" && p !== "medium" && p !== "hard") {
    return NextResponse.json(
      { error: 'preset must be "easy", "medium", or "hard"' },
      { status: 400 }
    );
  }
  const action = PRESETS[p];
  const viewerArg = sanitizeArg(body.viewerName ?? "Streamer");
  const giftArg = sanitizeArg(body.giftName ?? action);
  const userRow = await findUserById(session.userId);
  const steamToken = parseSteam64Anchor(userRow?.steam_id ?? null);
  let command = `rustchaos ${action} ${viewerArg} ${giftArg} 0`;
  if (steamToken != null) command += ` ${steamToken}`;

  try {
    const connected = await ensureConnection(
      server.id,
      server.rcon_host,
      server.rcon_port,
      server.rcon_password,
      async () => {}
    );
    if (!connected.ok) {
      return NextResponse.json(
        { ok: false, error: connected.error ?? "RCON connect failed", command },
        { status: 502 }
      );
    }
    const rconResponse = (await runAndWait(server.id, command, 45_000)).trim();
    await audit(session.userId, "chaos_raid.trigger", { serverId, preset: p, command }).catch(() => {});
    const failed =
      /^FAILED:/i.test(rconResponse) ||
      /^Unknown action:/i.test(rconResponse) ||
      /^Error:/i.test(rconResponse);
    return NextResponse.json({
      ok: !failed,
      preset: p,
      action,
      command,
      rconResponse,
      debug: failed
        ? "RustChaos rejected the command — see rconResponse."
        : "Triggered from RustMaxx (no TikFinity webhook). Ensure RandomRaids is loaded with chaos_easy / chaos_medium / chaos_hard profiles.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message, command }, { status: 502 });
  }
}
