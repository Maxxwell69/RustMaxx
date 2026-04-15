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

function isPgMissingSchemaError(e: unknown): boolean {
  if (e === null || typeof e !== "object") return false;
  const err = e as { code?: string };
  // 42P01: undefined_table, 42703: undefined_column
  return err.code === "42P01" || err.code === "42703";
}

/**
 * Servers the streamer can see for TikFinity setup:
 * - Any server this user owns or is on the team for (owners enable Streamer interactions / billing here first).
 * - Any server with streamer interactions on that passes allowlist / approval rules (public pool).
 * - Any server where this user has an approved access request but TikFinity is not enabled yet (so they see
 *   “waiting for owner” instead of an empty list).
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
      { error: "Forbidden: streamer dashboard access required" },
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
    try {
      const res = await query<ServerOption>(
        `SELECT DISTINCT s.id, s.name, s.listing_name, s.streamer_interactions_enabled
         FROM servers s
         WHERE s.owner_id = $1::uuid
            OR EXISTS (
              SELECT 1 FROM server_users su
              WHERE su.server_id = s.id AND su.user_id = $1::uuid
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
            OR EXISTS (
              SELECT 1 FROM streamer_server_requests r
              WHERE r.server_id = s.id
                AND r.user_id = $1::uuid
                AND r.status = 'approved'
                AND COALESCE(s.streamer_interactions_enabled, false) = false
            )
         ORDER BY COALESCE(s.listing_name, s.name) ASC`,
        [user.id]
      );
      rows = res.rows;
    } catch (e) {
      if (!isPgMissingSchemaError(e)) throw e;
      // Older DB without requester-gating migrations: return the legacy-safe subset
      // instead of failing this endpoint with HTTP 500.
      const res = await query<ServerOption>(
        `SELECT DISTINCT s.id, s.name, s.listing_name, s.streamer_interactions_enabled
         FROM servers s
         WHERE s.owner_id = $1::uuid
            OR EXISTS (
              SELECT 1 FROM server_users su
              WHERE su.server_id = s.id AND su.user_id = $1::uuid
            )
            OR s.streamer_interactions_enabled = true
         ORDER BY COALESCE(s.listing_name, s.name) ASC`,
        [user.id]
      );
      rows = res.rows;
    }
  }

  return NextResponse.json({ servers: rows });
}
