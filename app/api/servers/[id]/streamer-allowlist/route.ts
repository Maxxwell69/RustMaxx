import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerWithRole, canEditServer } from "@/lib/server-access";
import { findUserByEmail } from "@/lib/users";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST: Add or remove a RustMaxx user from this server’s streamer TikFinity allowlist.
 * When the list is empty, any eligible streamer may use webhooks (legacy). Non-empty = restrict.
 * Removing a user also deletes their streamer_webhooks (and rules) for this server.
 */
export async function POST(
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
    return NextResponse.json({ error: "Only owner or server admin can manage the allowlist" }, { status: 403 });
  }

  let body: { addEmail?: string; removeUserId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.addEmail === "string" && body.addEmail.trim()) {
    const email = body.addEmail.trim();
    const u = await findUserByEmail(email);
    if (!u) {
      return NextResponse.json(
        { error: "No RustMaxx account with that email. The streamer must sign up first." },
        { status: 404 }
      );
    }
    await query(
      `UPDATE servers SET streamer_allowed_user_ids = (
         CASE
           WHEN $2::uuid = ANY (COALESCE(streamer_allowed_user_ids, '{}')) THEN COALESCE(streamer_allowed_user_ids, '{}')
           ELSE array_append(COALESCE(streamer_allowed_user_ids, '{}'), $2::uuid)
         END
       ) WHERE id = $1`,
      [serverId, u.id]
    );
  } else if (typeof body.removeUserId === "string" && body.removeUserId.trim()) {
    const rid = body.removeUserId.trim();
    if (!UUID_RE.test(rid)) {
      return NextResponse.json({ error: "removeUserId must be a UUID" }, { status: 400 });
    }
    await query(
      `UPDATE servers SET streamer_allowed_user_ids = array_remove(COALESCE(streamer_allowed_user_ids, '{}'), $2::uuid) WHERE id = $1`,
      [serverId, rid]
    );
    await query(`DELETE FROM streamer_webhooks WHERE server_id = $1 AND user_id = $2::uuid`, [
      serverId,
      rid,
    ]);
  } else {
    return NextResponse.json(
      { error: "Send addEmail (non-empty) or removeUserId (UUID)" },
      { status: 400 }
    );
  }

  const { rows } = await query<{ streamer_allowed_user_ids: string[] }>(
    `SELECT COALESCE(streamer_allowed_user_ids, '{}') AS streamer_allowed_user_ids FROM servers WHERE id = $1`,
    [serverId]
  );
  const ids = rows[0]?.streamer_allowed_user_ids ?? [];
  let streamer_allowlist_users: { id: string; email: string }[] = [];
  if (ids.length > 0) {
    const { rows: users } = await query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE id = ANY($1::uuid[]) ORDER BY lower(email)`,
      [ids]
    );
    streamer_allowlist_users = users;
  }

  return NextResponse.json({
    ok: true,
    streamer_allowed_user_ids: ids,
    streamer_allowlist_users,
  });
}
