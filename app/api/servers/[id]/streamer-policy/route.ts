import { NextRequest, NextResponse } from "next/server";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerWithRole, canEditServer } from "@/lib/server-access";
import {
  getSelectableStreamerActionsForServer,
} from "@/lib/streamer-action-policy";
import { query } from "@/lib/db";

/** Server owner/admin: list platform streamer actions + current server flags (for setup UI). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;
  const result = await getServerWithRole(serverId, session.userId, session.role);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canEditServer(result.serverRole)) {
    return NextResponse.json({ error: "Only owner or server admin can view this" }, { status: 403 });
  }
  const { rows } = await query<{
    streamer_interactions_enabled: boolean;
    streamer_allowed_actions: string[];
  }>(
    `SELECT streamer_interactions_enabled, streamer_allowed_actions FROM servers WHERE id = $1`,
    [serverId]
  );
  const row = rows[0];
  const selectable = await getSelectableStreamerActionsForServer();
  return NextResponse.json({
    streamer_interactions_enabled: row?.streamer_interactions_enabled ?? false,
    streamer_allowed_actions: Array.isArray(row?.streamer_allowed_actions)
      ? row.streamer_allowed_actions
      : [],
    selectable,
  });
}
