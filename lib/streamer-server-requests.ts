import { query } from "./db";

export type StreamerServerRequestStatus = "pending" | "approved" | "rejected" | "revoked";

export type StreamerServerRequestRow = {
  id: string;
  server_id: string;
  user_id: string;
  message: string | null;
  status: StreamerServerRequestStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type StreamerServerRequestWithEmail = StreamerServerRequestRow & {
  applicant_email: string;
  /** Present when users.last_login_at exists (migration 028). */
  applicant_last_login_at?: Date | string | null;
};

export async function hasApprovedStreamerServerRequest(
  serverId: string,
  userId: string
): Promise<boolean> {
  const { rows } = await query<{ one: number }>(
    `SELECT 1 AS one FROM streamer_server_requests
     WHERE server_id = $1 AND user_id = $2 AND status = 'approved' LIMIT 1`,
    [serverId, userId]
  );
  return rows.length > 0;
}

export async function getStreamerServerRequestByPair(
  serverId: string,
  userId: string
): Promise<StreamerServerRequestRow | null> {
  const { rows } = await query<StreamerServerRequestRow>(
    `SELECT id, server_id, user_id, message, status, reviewed_by, reviewed_at, created_at, updated_at
     FROM streamer_server_requests WHERE server_id = $1 AND user_id = $2 LIMIT 1`,
    [serverId, userId]
  );
  return rows[0] ?? null;
}

export async function listStreamerServerRequestsWithEmails(
  serverId: string
): Promise<StreamerServerRequestWithEmail[]> {
  const { rows } = await query<StreamerServerRequestWithEmail>(
    `SELECT r.id, r.server_id, r.user_id, r.message, r.status, r.reviewed_by, r.reviewed_at, r.created_at, r.updated_at,
            u.email AS applicant_email,
            u.last_login_at AS applicant_last_login_at
     FROM streamer_server_requests r
     JOIN users u ON u.id = r.user_id
     WHERE r.server_id = $1
     ORDER BY
       CASE r.status
         WHEN 'pending' THEN 0
         WHEN 'approved' THEN 1
         WHEN 'rejected' THEN 2
         WHEN 'revoked' THEN 3
         ELSE 4
       END,
       r.updated_at DESC`,
    [serverId]
  );
  return rows;
}

export async function submitStreamerServerRequest(
  serverId: string,
  userId: string,
  message: string | null
): Promise<{ ok: true; row: StreamerServerRequestRow } | { ok: false; error: string; status?: number }> {
  const { rows: srv } = await query<{
    owner_id: string | null;
    listed: boolean;
    streamer_interactions_enabled: boolean;
    streamer_join_requires_owner_approval: boolean;
  }>(
    `SELECT owner_id, listed, streamer_interactions_enabled,
            COALESCE(streamer_join_requires_owner_approval, false) AS streamer_join_requires_owner_approval
     FROM servers WHERE id = $1 LIMIT 1`,
    [serverId]
  );
  const s = srv[0];
  if (!s) return { ok: false, error: "Server not found", status: 404 };
  if (!s.listed) {
    return { ok: false, error: "This server is not on the public list.", status: 400 };
  }
  if (!s.streamer_interactions_enabled) {
    return {
      ok: false,
      error: "This server does not accept streamer interactions yet.",
      status: 400,
    };
  }
  if (!s.streamer_join_requires_owner_approval) {
    return {
      ok: false,
      error:
        "This server is not accepting access requests from the public list. The owner can turn on “Require owner approval for streamers” under Server → Streamer interactions.",
      status: 400,
    };
  }
  if (s.owner_id === userId) {
    return { ok: false, error: "You already manage this server.", status: 400 };
  }

  const existing = await getStreamerServerRequestByPair(serverId, userId);
  if (existing?.status === "pending") {
    return { ok: false, error: "You already have a pending request for this server.", status: 409 };
  }
  if (existing?.status === "approved") {
    return { ok: false, error: "You are already approved for this server.", status: 400 };
  }

  const trimmed = message?.trim() || null;
  if (existing?.status === "rejected" || existing?.status === "revoked") {
    const { rows } = await query<StreamerServerRequestRow>(
      `UPDATE streamer_server_requests SET
        message = $3, status = 'pending', reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
       WHERE server_id = $1 AND user_id = $2
       RETURNING id, server_id, user_id, message, status, reviewed_by, reviewed_at, created_at, updated_at`,
      [serverId, userId, trimmed]
    );
    const row = rows[0];
    if (!row) return { ok: false, error: "Could not resubmit request" };
    return { ok: true, row };
  }

  const { rows } = await query<StreamerServerRequestRow>(
    `INSERT INTO streamer_server_requests (server_id, user_id, message)
     VALUES ($1, $2, $3)
     RETURNING id, server_id, user_id, message, status, reviewed_by, reviewed_at, created_at, updated_at`,
    [serverId, userId, trimmed]
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "Could not create request" };
  return { ok: true, row };
}

export async function resolveStreamerServerRequest(
  requestId: string,
  serverId: string,
  reviewerUserId: string,
  decision: "approve" | "reject"
): Promise<{ ok: true; row: StreamerServerRequestRow } | { ok: false; error: string }> {
  const { rows: reqRows } = await query<StreamerServerRequestRow>(
    `SELECT id, server_id, user_id, message, status, reviewed_by, reviewed_at, created_at, updated_at
     FROM streamer_server_requests WHERE id = $1 LIMIT 1`,
    [requestId]
  );
  const req = reqRows[0];
  if (!req || req.server_id !== serverId) {
    return { ok: false, error: "Request not found" };
  }
  if (req.status !== "pending") {
    return { ok: false, error: "This request is no longer pending" };
  }

  const next: StreamerServerRequestStatus = decision === "approve" ? "approved" : "rejected";
  const { rows } = await query<StreamerServerRequestRow>(
    `UPDATE streamer_server_requests SET
      status = $1, reviewed_by = $2, reviewed_at = now(), updated_at = now()
     WHERE id = $3 AND server_id = $4 AND status = 'pending'
     RETURNING id, server_id, user_id, message, status, reviewed_by, reviewed_at, created_at, updated_at`,
    [next, reviewerUserId, requestId, serverId]
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "Could not update request" };

  if (decision === "reject") {
    await query(`DELETE FROM streamer_webhooks WHERE server_id = $1 AND user_id = $2`, [
      serverId,
      req.user_id,
    ]);
  }

  return { ok: true, row };
}

/**
 * Owner kick: remove TikFinity webhook, revoke approved request (if any), remove from manual allowlist.
 */
export function serializeStreamerServerRequestForApi(r: StreamerServerRequestWithEmail): {
  id: string;
  user_id: string;
  applicant_email: string;
  applicant_last_login_at: string | null;
  message: string | null;
  status: string;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
} {
  const last = r.applicant_last_login_at ?? null;
  return {
    id: r.id,
    user_id: r.user_id,
    applicant_email: r.applicant_email,
    applicant_last_login_at:
      last instanceof Date ? last.toISOString() : typeof last === "string" ? last : null,
    message: r.message,
    status: r.status,
    reviewed_at: r.reviewed_at instanceof Date ? r.reviewed_at.toISOString() : r.reviewed_at,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

export async function kickStreamerFromServer(
  serverId: string,
  targetUserId: string,
  reviewerUserId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (targetUserId === reviewerUserId) {
    return { ok: false, error: "You cannot remove your own access this way." };
  }
  await query(`DELETE FROM streamer_webhooks WHERE server_id = $1 AND user_id = $2::uuid`, [
    serverId,
    targetUserId,
  ]);
  await query(
    `UPDATE streamer_server_requests SET
       status = 'revoked', reviewed_by = $3::uuid, reviewed_at = now(), updated_at = now()
     WHERE server_id = $1 AND user_id = $2::uuid AND status = 'approved'`,
    [serverId, targetUserId, reviewerUserId]
  );
  await query(
    `UPDATE servers SET streamer_allowed_user_ids = array_remove(COALESCE(streamer_allowed_user_ids, '{}'), $2::uuid) WHERE id = $1`,
    [serverId, targetUserId]
  );
  return { ok: true };
}
