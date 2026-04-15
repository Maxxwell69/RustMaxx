import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { canAccessStreamerDashboard } from "@/lib/streamer-guard";
import { query } from "@/lib/db";

type ServerOption = {
  id: string;
  name: string;
  listing_name: string | null;
  streamer_interactions_enabled: boolean;
};

/**
 * Servers the streamer can attach their webhook to:
 * - Any server that has already enabled streamer interactions (public pool), OR
 * - Any server this user owns or is on the team for (so owners see their server and can enable the toggle first).
 * Super admins see every server for support/testing.
 */
export async function GET(_request: NextRequest) {
  const session = getSession(_request.headers.get("cookie"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await findUserById(session.userId);
  if (!user || !canAccessStreamerDashboard(user)) {
    return NextResponse.json(
      { error: "Forbidden: streamer subscription required" },
      { status: 403 }
    );
  }

  let rows: ServerOption[];

  if (user.role === "super_admin") {
    const res = await query<ServerOption>(
      `SELECT id, name, listing_name, streamer_interactions_enabled
       FROM servers
       ORDER BY COALESCE(listing_name, name) ASC`
    );
    rows = res.rows;
  } else {
    const res = await query<ServerOption>(
      `SELECT DISTINCT s.id, s.name, s.listing_name, s.streamer_interactions_enabled
       FROM servers s
       WHERE s.owner_id = $1
          OR EXISTS (
            SELECT 1 FROM server_users su
            WHERE su.server_id = s.id AND su.user_id = $1
          )
          OR (
            s.streamer_interactions_enabled = true
            AND (
              (
                COALESCE(s.streamer_join_requires_owner_approval, false) = false
                AND (
                  cardinality(COALESCE(s.streamer_allowed_user_ids, '{}')) = 0
                  OR $1::uuid = ANY (COALESCE(s.streamer_allowed_user_ids, '{}'))
                )
              )
              OR (
                COALESCE(s.streamer_join_requires_owner_approval, false) = true
                AND (
                  $1::uuid = ANY (COALESCE(s.streamer_allowed_user_ids, '{}'))
                  OR EXISTS (
                    SELECT 1 FROM streamer_server_requests r
                    WHERE r.server_id = s.id AND r.user_id = $1::uuid AND r.status = 'approved'
                  )
                )
              )
            )
          )
       ORDER BY COALESCE(s.listing_name, s.name) ASC`,
      [user.id]
    );
    rows = res.rows;
  }

  return NextResponse.json({ servers: rows });
}
