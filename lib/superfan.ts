import { query } from "@/lib/db";
import type { FanBoardTier } from "@/lib/streamer-fan-board";

export type ClubTier = FanBoardTier;

export type SuperfanSiteStatus = "pending" | "approved" | "rejected";
export type SuperfanMembershipStatus = "pending" | "approved" | "rejected" | "revoked";

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
  club_tier: ClubTier | null;
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

/**
 * Fans who register with "Fan / viewer" get site-wide approval immediately so they can request
 * access from individual streamers without submitting the viewer superfans form. Streamers still approve per channel.
 */
export async function ensureApprovedSiteApplicationForFanSignup(userId: string): Promise<void> {
  await query(
    `INSERT INTO viewer_superfan_site_applications (user_id, message, status, reviewed_at, updated_at)
     VALUES ($1::uuid, NULL, 'approved', now(), now())
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
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

/**
 * Site-wide viewer superfan step: auto-approved on submit (no RustMaxx staff queue).
 * Streamers still approve each channel separately.
 */
export async function submitViewerSiteApplication(
  userId: string,
  message: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await getViewerSiteApplication(userId);
  if (existing?.status === "approved") {
    return { ok: false, error: "You are already approved for the viewer superfan program." };
  }

  const msg = message?.trim() || null;

  if (!existing) {
    await query(
      `INSERT INTO viewer_superfan_site_applications (user_id, message, status, reviewed_at, updated_at)
       VALUES ($1::uuid, $2, 'approved', now(), now())`,
      [userId, msg]
    );
    return { ok: true };
  }

  if (existing.status === "pending") {
    await query(
      `UPDATE viewer_superfan_site_applications
       SET message = $2, status = 'approved', reviewed_by = NULL, reviewed_at = now(),
           admin_notes = NULL, updated_at = now()
       WHERE user_id = $1::uuid AND status = 'pending'`,
      [userId, msg]
    );
    return { ok: true };
  }

  // rejected — allow re-apply (auto-approved)
  await query(
    `UPDATE viewer_superfan_site_applications
     SET message = $2, status = 'approved', reviewed_by = NULL, reviewed_at = now(),
         admin_notes = NULL, updated_at = now()
     WHERE user_id = $1::uuid AND status = 'rejected'`,
    [userId, msg]
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
      error:
        "Complete the site step first (Viewer superfans). Fans who signed up as viewers are usually already approved at registration.",
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
      return { ok: false, error: "You already belong to this streamer's fan club." };
    }
    if (row.status === "pending") {
      return { ok: false, error: "You already have a pending request for this streamer." };
    }
    await query(
      `UPDATE viewer_streamer_superfan_memberships
       SET message = $2, status = 'pending', reviewed_by = NULL, reviewed_at = NULL,
           club_tier = NULL, updated_at = now()
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
    `SELECT m.id, m.viewer_user_id, m.streamer_user_id, m.message, m.status, m.club_tier::text, m.reviewed_at, m.created_at, m.updated_at,
            u.display_name AS streamer_display_name,
            sa.preferred_stream_name AS streamer_stream_name
     FROM viewer_streamer_superfan_memberships m
     INNER JOIN users u ON u.id = m.streamer_user_id
     LEFT JOIN streamer_applications sa ON sa.user_id = m.streamer_user_id AND sa.status = 'approved'
     WHERE m.viewer_user_id = $1::uuid
     ORDER BY m.updated_at DESC`,
    [viewerUserId]
  );
  return rows.map((r) => ({
    ...r,
    club_tier: (r.club_tier as ClubTier | null) ?? null,
  }));
}

export async function listIncomingSuperfanRequests(streamerUserId: string): Promise<
  (SuperfanMembershipRow & { viewer_email: string; viewer_display_name: string | null })[]
> {
  const { rows } = await query<
    SuperfanMembershipRow & { viewer_email: string; viewer_display_name: string | null }
  >(
    `SELECT m.id, m.viewer_user_id, m.streamer_user_id, m.message, m.status, m.club_tier::text, m.reviewed_at, m.created_at, m.updated_at,
            u.email AS viewer_email, u.display_name AS viewer_display_name
     FROM viewer_streamer_superfan_memberships m
     INNER JOIN users u ON u.id = m.viewer_user_id
     WHERE m.streamer_user_id = $1::uuid
     ORDER BY
       CASE m.status WHEN 'pending' THEN 0 ELSE 1 END,
       m.created_at DESC`,
    [streamerUserId]
  );
  return rows.map((r) => ({
    ...r,
    club_tier: (r.club_tier as ClubTier | null) ?? null,
  }));
}

export async function setMembershipDecision(
  membershipId: string,
  streamerUserId: string,
  decision: "approved" | "rejected",
  reviewerUserId: string,
  opts?: { initialClubTier?: ClubTier }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tier: ClubTier = opts?.initialClubTier ?? "fan";
  if (decision === "approved" && !["fan", "superfan", "mod"].includes(tier)) {
    return { ok: false, error: "Invalid initial club tier." };
  }

  let rowCount = 0;
  if (decision === "approved") {
    const r = await query(
      `UPDATE viewer_streamer_superfan_memberships
       SET status = 'approved',
           club_tier = $4::text,
           reviewed_by = $2::uuid,
           reviewed_at = now(),
           updated_at = now()
       WHERE id = $1::uuid AND streamer_user_id = $3::uuid AND status = 'pending'`,
      [membershipId, reviewerUserId, streamerUserId, tier]
    );
    rowCount = r.rowCount ?? 0;
  } else {
    const r = await query(
      `UPDATE viewer_streamer_superfan_memberships
       SET status = 'rejected',
           club_tier = NULL,
           reviewed_by = $2::uuid,
           reviewed_at = now(),
           updated_at = now()
       WHERE id = $1::uuid AND streamer_user_id = $3::uuid AND status = 'pending'`,
      [membershipId, reviewerUserId, streamerUserId]
    );
    rowCount = r.rowCount ?? 0;
  }
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

export async function getFanClubMembership(
  viewerUserId: string,
  streamerUserId: string
): Promise<SuperfanMembershipRow | null> {
  const { rows } = await query<SuperfanMembershipRow>(
    `SELECT id, viewer_user_id, streamer_user_id, message, status, club_tier::text, reviewed_at, created_at, updated_at
     FROM viewer_streamer_superfan_memberships
     WHERE viewer_user_id = $1::uuid AND streamer_user_id = $2::uuid
     LIMIT 1`,
    [viewerUserId, streamerUserId]
  );
  const r = rows[0];
  if (!r) return null;
  return { ...r, club_tier: (r.club_tier as ClubTier | null) ?? null };
}

export async function listApprovedFanClubMembers(streamerUserId: string): Promise<
  (SuperfanMembershipRow & { viewer_email: string; viewer_display_name: string | null })[]
> {
  const { rows } = await query<
    SuperfanMembershipRow & { viewer_email: string; viewer_display_name: string | null }
  >(
    `SELECT m.id, m.viewer_user_id, m.streamer_user_id, m.message, m.status, m.club_tier::text, m.reviewed_at, m.created_at, m.updated_at,
            u.email AS viewer_email, u.display_name AS viewer_display_name
     FROM viewer_streamer_superfan_memberships m
     INNER JOIN users u ON u.id = m.viewer_user_id
     WHERE m.streamer_user_id = $1::uuid AND m.status = 'approved'
     ORDER BY CASE m.club_tier WHEN 'mod' THEN 0 WHEN 'superfan' THEN 1 WHEN 'fan' THEN 2 ELSE 3 END,
              u.display_name NULLS LAST, u.email`,
    [streamerUserId]
  );
  return rows.map((r) => ({
    ...r,
    club_tier: (r.club_tier as ClubTier | null) ?? null,
  }));
}

export async function setMemberClubTier(
  streamerUserId: string,
  membershipId: string,
  clubTier: ClubTier
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { rowCount } = await query(
    `UPDATE viewer_streamer_superfan_memberships
     SET club_tier = $3::text, updated_at = now()
     WHERE id = $2::uuid AND streamer_user_id = $1::uuid AND status = 'approved'`,
    [streamerUserId, membershipId, clubTier]
  );
  if (rowCount === 0) return { ok: false, error: "Member not found or not active." };
  return { ok: true };
}

export async function revokeFanClubMembership(params: {
  membershipId: string;
  streamerUserId: string;
  actorUserId: string;
  actorIsStreamer: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { rows } = await query<{
    id: string;
    viewer_user_id: string;
    club_tier: string | null;
    status: string;
  }>(
    `SELECT id, viewer_user_id, club_tier::text, status::text FROM viewer_streamer_superfan_memberships
     WHERE id = $1::uuid AND streamer_user_id = $2::uuid`,
    [params.membershipId, params.streamerUserId]
  );
  const m = rows[0];
  if (!m || m.status !== "approved") {
    return { ok: false, error: "Member not found or not active." };
  }

  if (params.actorIsStreamer) {
    await query(
      `UPDATE viewer_streamer_superfan_memberships
       SET status = 'revoked', club_tier = NULL, updated_at = now() WHERE id = $1::uuid`,
      [params.membershipId]
    );
    return { ok: true };
  }

  const { rows: modRows } = await query<{ ok: boolean }>(
    `SELECT true AS ok FROM viewer_streamer_superfan_memberships
     WHERE viewer_user_id = $1::uuid AND streamer_user_id = $2::uuid
       AND status = 'approved' AND club_tier = 'mod' LIMIT 1`,
    [params.actorUserId, params.streamerUserId]
  );
  if (modRows.length === 0) {
    return { ok: false, error: "Only the streamer or a channel mod can remove members." };
  }
  if (m.club_tier === "mod") {
    return { ok: false, error: "Mods cannot remove other mods. Ask the streamer." };
  }
  if (m.viewer_user_id === params.actorUserId) {
    return { ok: false, error: "Use a different flow to leave the fan club (coming soon) or ask the streamer." };
  }

  await query(
    `UPDATE viewer_streamer_superfan_memberships
     SET status = 'revoked', club_tier = NULL, updated_at = now() WHERE id = $1::uuid`,
    [params.membershipId]
  );
  return { ok: true };
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
