import { NextRequest, NextResponse } from "next/server";
import { requireCanManageServersFromDb } from "@/lib/api-auth";
import { query } from "@/lib/db";
import type { ServerRow } from "@/lib/db";
import {
  getActionForGift,
  getDefaultGiftValue,
  TIKTRIGGER_ACTIONS,
  type TikTriggerAction,
} from "@/lib/tikfinity";
import { ensureConnection, sendCommand } from "@/lib/rcon-manager";

const TIKFINITY_SERVER_ID = process.env.TIKFINITY_SERVER_ID?.trim() ?? null;

function sanitizeArg(s: string, maxLen = 48): string {
  return s.replace(/\s+/g, "_").slice(0, maxLen) || "Viewer";
}

/**
 * POST: Simulate a TikFinity webhook (admin-only). Same flow as webhook but with a test payload.
 * Body: { giftName: string, viewerName?: string }
 * Use this to test RCON and plugin without sending a real TikTok gift.
 */
export async function POST(request: NextRequest) {
  const authErr = await requireCanManageServersFromDb(request);
  if (authErr) return authErr;

  let body: { giftName?: string; viewerName?: string; amount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON", debug: "Send JSON body: { giftName, viewerName? }" },
      { status: 400 }
    );
  }

  const giftName = typeof body.giftName === "string" ? body.giftName.trim() : "Puppy";
  const viewerName = typeof body.viewerName === "string" ? body.viewerName.trim() || "TestViewer" : "TestViewer";

  const action = getActionForGift(giftName);
  if (!action) {
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason: "Gift not mapped to an action",
      debug: `No mapping for gift "${giftName}". Check lib/tikfinity.ts DEFAULT_GIFT_TO_ACTION.`,
      giftName,
      viewerName,
      availableActions: [...TIKTRIGGER_ACTIONS],
    });
  }

  if (!TIKFINITY_SERVER_ID) {
    return NextResponse.json({
      ok: false,
      error: "TikFinity integration not configured",
      debug: "Set TIKFINITY_SERVER_ID in .env to your Rust server ID.",
    });
  }

  const { rows } = await query<ServerRow>(
    "SELECT id, name, rcon_host, rcon_port, rcon_password FROM servers WHERE id = $1",
    [TIKFINITY_SERVER_ID]
  );
  const server = rows[0];
  if (!server) {
    return NextResponse.json({
      ok: false,
      error: "Server not found",
      debug: `No server with id ${TIKFINITY_SERVER_ID}. Check TIKFINITY_SERVER_ID matches a server in your dashboard.`,
    });
  }

  const viewerArg = sanitizeArg(viewerName);
  const giftArg = sanitizeArg(giftName);
  // Ensure every gift gives at least 1 scrap to streamer (same as webhook).
  const scrapAmount = Math.min(10000, Math.max(1, typeof body.amount === "number" ? body.amount : getDefaultGiftValue(giftName)));
  const command = `rustchaos ${action} ${viewerArg} ${giftArg} ${scrapAmount}`;

  const connected = await ensureConnection(
    server.id,
    server.rcon_host,
    server.rcon_port,
    server.rcon_password,
    async () => {}
  );
  if (!connected.ok) {
    return NextResponse.json({
      ok: false,
      error: "Could not connect to game server",
      debug: connected.error ?? "WebRCON timeout or wrong host/port/password. Open the server's live console in the dashboard to connect first, or check RCON settings.",
      serverName: server.name,
    });
  }

  const result = sendCommand(server.id, command);
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      error: result.error ?? "Command send failed",
      debug: "RCON connection is open but sending the command failed. Check server logs.",
      command,
    });
  }

  return NextResponse.json({
    ok: true,
    action: action as TikTriggerAction,
    viewerName,
    giftName,
    scrapAmount: scrapAmount > 0 ? scrapAmount : undefined,
    command,
    debug: "Trigger sent. Check the Rust server console or in-game for the effect." + (scrapAmount > 0 ? ` Streamer receives ${scrapAmount} scrap.` : ""),
  });
}
