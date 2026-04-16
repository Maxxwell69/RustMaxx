import { query } from "@/lib/db";

export type SuperfanSiteStatus = "pending" | "approved" | "rejected";
export type SuperfanMembershipStatus = "pending" | "approved" | "rejected";

export type ViewerSuperfanSiteRow = {
  id: string;
  user_id: string;
  message: string | null;
  status: SuperfanSiteStatus;
  reviewed_at: Date | null;
  admin_notes: string | null;
  created_at: Date;
  updated_at: Date;
};

export type SuperfanMembershipRow = {
  id: string;
  viewer_user_id: string;
  streamer_user_id: string;
  message: string | null;
  status: SuperfanMembershipStatus;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** True if this user has an approved streamer application (public directory streamer). */
export async function userIsApprovedStreamer(streamerUserId: string): Promise<boolean> {
  const { rows } = await query<{ ok: boolean }>(
    `SELECT true AS ok FROM streamer_applications
     WHERE user_id = $1::uuid AND status = 'approved' LIMIT 1`,
    [streamerUserId]
  );
  return rows.length > 0;
}

export async function getViewerSiteApplication(
  userId: string
): Promise<ViewerSuperfanSiteRow | null> {
  const { rows } = await query<ViewerSuperfanSiteRow>(
    `SELECT id, user_id, message, status, reviewed_at, admin_notes, created_at, updated_at
     FROM viewer_superfan_site_applications WHERE user_id = $1::uuid`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function submitViewerSiteApplication(
  userId: string,
  message: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await getViewerSiteApplication(userId);
  if (existing?.status === "approved") {
    return { ok: false, error: "You are already approved for the viewer superfan program." };
  }

  if (!existing) {
    await query(
      `INSERT INTO viewer_superfan_site_applications (user_id, message, status)
       VALUES ($1::uuid, $2, 'pending')`,
      [userId, message?.trim() || null]
    );
    return { ok: true };
  }

  if (existing.status === "pending") {
    await query(
      `UPDATE viewer_superfan_site_applications
       SET message = $2, updated_at = now() WHERE user_id = $1::uuid AND status = 'pending'`,
      [userId, message?.trim() || null]
    );
    return { ok: true };
  }

  // rejected — allow re-apply
  await query(
    `UPDATE viewer_superfan_site_applications
     SET message = $2, status = 'pending', reviewed_by = NULL, reviewed_at = NULL,
         admin_notes = NULL, updated_at = now()
     WHERE user_id = $1::uuid AND status = 'rejected'`,
    [userId, message?.trim() || null]
  );
  return { ok: true };
}

export async function submitStreamerSuperfanRequest(
  viewerUserId: string,
  streamerUserId: string,
  message: string | null
): Promise<{ ok: true; membership_id: string } | { ok: false; error: string }> {
  if (viewerUserId === streamerUserId) {
    return { ok: false, error: "You cannot apply to your own channel." };
  }

  const site = await getViewerSiteApplication(viewerUserId);
  if (!site || site.status !== "approved") {
    return {
      ok: false,
      error: "Complete the site superfan application and wait for staff approval first.",
    };
  }

  const okStreamer = await userIsApprovedStreamer(streamerUserId);
  if (!okStreamer) {
    return { ok: false, error: "That user is not an approved streamer on RustMaxx." };
  }

  const { rows: existing } = await query<{ id: string; status: SuperfanMembershipStatus }>(
    `SELECT id, status FROM viewer_streamer_superfan_memberships
     WHERE viewer_user_id = $1::uuid AND streamer_user_id = $2::uuid`,
    [viewerUserId, streamerUserId]
  );
  const row = existing[0];
  if (row) {
    if (row.status === "approved") {
      return { ok: false, error: "You already have superfan access for this streamer." };
    }
    if (row.status === "pending") {
      return { ok: false, error: "You already have a pending request for this streamer." };
    }
    await query(
      `UPDATE viewer_streamer_superfan_memberships
       SET message = $2, status = 'pending', reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
       WHERE id = $1::uuid`,
      [row.id, message?.trim() || null]
    );
    return { ok: true, membership_id: row.id };
  }

  const { rows: ins } = await query<{ id: string }>(
    `INSERT INTO viewer_streamer_superfan_memberships (viewer_user_id, streamer_user_id, message, status)
     VALUES ($1::uuid, $2::uuid, $3, 'pending') RETURNING id`,
    [viewerUserId, streamerUserId, message?.trim() || null]
  );
  return { ok: true, membership_id: ins[0]!.id };
}

export async function listMembershipsForViewer(viewerUserId: string): Promise<
  (SuperfanMembershipRow & { streamer_display_name: string | null; streamer_stream_name: string | null })[]
> {
  const { rows } = await query<
    SuperfanMembershipRow & {
      streamer_display_name: string | null;
      streamer_stream_name: string | null;
    }
  >(
    `SELECT m.id, m.viewer_user_id, m.streamer_user_id, m.message, m.status, m.reviewed_at, m.created_at, m.updated_at,
            u.display_name AS streamer_display_name,
            sa.preferred_stream_name AS streamer_stream_name
     FROM viewer_streamer_superfan_memberships m
     INNER JOIN users u ON u.id = m.streamer_user_id
     LEFT JOIN streamer_applications sa ON sa.user_id = m.streamer_user_id AND sa.status = 'approved'
     WHERE m.viewer_user_id = $1::uuid
     ORDER BY m.updated_at DESC`,
    [viewerUserId]
  );
  return rows;
}

export async function listIncomingSuperfanRequests(streamerUserId: string): Promise<
  (SuperfanMembershipRow & { viewer_email: string; viewer_display_name: string | null })[]
> {
  const { rows } = await query<
    SuperfanMembershipRow & { viewer_email: string; viewer_display_name: string | null }
  >(
    `SELECT m.id, m.viewer_user_id, m.streamer_user_id, m.message, m.status, m.reviewed_at, m.created_at, m.updated_at,
            u.email AS viewer_email, u.display_name AS viewer_display_name
     FROM viewer_streamer_superfan_memberships m
     INNER JOIN users u ON u.id = m.viewer_user_id
     WHERE m.streamer_user_id = $1::uuid
     ORDER BY
       CASE m.status WHEN 'pending' THEN 0 ELSE 1 END,
       m.created_at DESC`,
    [streamerUserId]
  );
  return rows;
}

export async function setMembershipDecision(
  membershipId: string,
  streamerUserId: string,
  decision: "approved" | "rejected",
  reviewerUserId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const status: SuperfanMembershipStatus = decision === "approved" ? "approved" : "rejected";
  const { rowCount } = await query(
    `UPDATE viewer_streamer_superfan_memberships
     SET status = $2, reviewed_by = $3::uuid, reviewed_at = now(), updated_at = now()
     WHERE id = $1::uuid AND streamer_user_id = $4::uuid AND status = 'pending'`,
    [membershipId, status, reviewerUserId, streamerUserId]
  );
  if (rowCount === 0) {
    return { ok: false, error: "Request not found or already decided." };
  }
  return { ok: true };
}

export async function isApprovedSuperfanForStreamer(
  viewerUserId: string,
  streamerUserId: string
): Promise<boolean> {
  const { rows } = await query<{ ok: boolean }>(
    `SELECT true AS ok FROM viewer_streamer_superfan_memberships
     WHERE viewer_user_id = $1::uuid AND streamer_user_id = $2::uuid AND status = 'approved' LIMIT 1`,
    [viewerUserId, streamerUserId]
  );
  return rows.length > 0;
}

/** Admin: pending site applications with user email. */
export async function listPendingSiteApplicationsForAdmin(): Promise<
  (ViewerSuperfanSiteRow & { email: string })[]
> {
  const { rows } = await query<ViewerSuperfanSiteRow & { email: string }>(
    `SELECT a.id, a.user_id, a.message, a.status, a.reviewed_at, a.admin_notes, a.created_at, a.updated_at,
            u.email
     FROM viewer_superfan_site_applications a
     INNER JOIN users u ON u.id = a.user_id
     WHERE a.status = 'pending'
     ORDER BY a.created_at ASC`
  );
  return rows;
}

export async function setSiteApplicationDecision(
  applicantUserId: string,
  reviewerUserId: string,
  decision: "approved" | "rejected",
  adminNotes: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const status: SuperfanSiteStatus = decision === "approved" ? "approved" : "rejected";
  const { rowCount } = await query(
    `UPDATE viewer_superfan_site_applications
     SET status = $2, reviewed_by = $3::uuid, reviewed_at = now(), admin_notes = $4, updated_at = now()
     WHERE user_id = $1::uuid AND status = 'pending'`,
    [applicantUserId, status, reviewerUserId, adminNotes?.trim() || null]
  );
  if (rowCount === 0) {
    return { ok: false, error: "No pending application for that user." };
  }
  return { ok: true };
}
