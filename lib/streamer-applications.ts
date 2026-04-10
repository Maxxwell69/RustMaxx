import { query } from "./db";
import type { UserRole } from "./permissions";
import { findUserById, updateUserRole } from "./users";

export type StreamerApplicationStatus = "pending" | "approved" | "rejected";

export type StreamerApplicationRow = {
  id: string;
  user_id: string;
  legal_name: string;
  preferred_stream_name: string;
  tiktok_url: string | null;
  twitch_url: string | null;
  kick_url: string | null;
  youtube_url: string | null;
  twitter_url: string | null;
  instagram_url: string | null;
  discord_username: string | null;
  other_socials: string | null;
  avg_live_viewers: string | null;
  stream_schedule: string | null;
  content_summary: string;
  why_rustmaxx: string;
  status: StreamerApplicationStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  admin_notes: string | null;
  created_at: Date;
  updated_at: Date;
};

export type StreamerApplicationInput = {
  legal_name: string;
  preferred_stream_name: string;
  tiktok_url: string | null;
  twitch_url: string | null;
  kick_url: string | null;
  youtube_url: string | null;
  twitter_url: string | null;
  instagram_url: string | null;
  discord_username: string | null;
  other_socials: string | null;
  avg_live_viewers: string | null;
  stream_schedule: string | null;
  content_summary: string;
  why_rustmaxx: string;
};

const SA_COLS = `sa.id, sa.user_id, sa.legal_name, sa.preferred_stream_name, sa.tiktok_url, sa.twitch_url, sa.kick_url,
  sa.youtube_url, sa.twitter_url, sa.instagram_url, sa.discord_username, sa.other_socials, sa.avg_live_viewers,
  sa.stream_schedule, sa.content_summary, sa.why_rustmaxx, sa.status, sa.reviewed_by, sa.reviewed_at, sa.admin_notes,
  sa.created_at, sa.updated_at`;

export async function getStreamerApplicationByUserId(
  userId: string
): Promise<StreamerApplicationRow | null> {
  const { rows } = await query<StreamerApplicationRow>(
    `SELECT id, user_id, legal_name, preferred_stream_name, tiktok_url, twitch_url, kick_url, youtube_url, twitter_url, instagram_url,
     discord_username, other_socials, avg_live_viewers, stream_schedule, content_summary, why_rustmaxx,
     status, reviewed_by, reviewed_at, admin_notes, created_at, updated_at
     FROM streamer_applications WHERE user_id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function getStreamerApplicationById(
  id: string
): Promise<StreamerApplicationRow | null> {
  const { rows } = await query<StreamerApplicationRow>(
    `SELECT id, user_id, legal_name, preferred_stream_name, tiktok_url, twitch_url, kick_url, youtube_url, twitter_url, instagram_url,
     discord_username, other_socials, avg_live_viewers, stream_schedule, content_summary, why_rustmaxx,
     status, reviewed_by, reviewed_at, admin_notes, created_at, updated_at
     FROM streamer_applications WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export type StreamerApplicationListRow = StreamerApplicationRow & {
  applicant_email: string;
  applicant_display_name: string | null;
};

export async function listStreamerApplications(
  status?: StreamerApplicationStatus
): Promise<StreamerApplicationListRow[]> {
  const base = `SELECT ${SA_COLS}, u.email AS applicant_email, u.display_name AS applicant_display_name
     FROM streamer_applications sa
     JOIN users u ON u.id = sa.user_id`;
  if (status) {
    const { rows } = await query<StreamerApplicationListRow>(
      `${base} WHERE sa.status = $1 ORDER BY sa.updated_at DESC`,
      [status]
    );
    return rows;
  }
  const { rows } = await query<StreamerApplicationListRow>(
    `${base} ORDER BY sa.updated_at DESC`
  );
  return rows;
}

export async function upsertStreamerApplication(
  userId: string,
  input: StreamerApplicationInput
): Promise<{ ok: true; row: StreamerApplicationRow } | { ok: false; error: string }> {
  const existing = await getStreamerApplicationByUserId(userId);
  if (existing?.status === "approved") {
    return {
      ok: false,
      error: "Your application was already approved. Contact support if you need changes.",
    };
  }

  const vals = [
    input.legal_name,
    input.preferred_stream_name,
    input.tiktok_url,
    input.twitch_url,
    input.kick_url,
    input.youtube_url,
    input.twitter_url,
    input.instagram_url,
    input.discord_username,
    input.other_socials,
    input.avg_live_viewers,
    input.stream_schedule,
    input.content_summary,
    input.why_rustmaxx,
  ];

  if (existing) {
    const { rows } = await query<StreamerApplicationRow>(
      `UPDATE streamer_applications SET
        legal_name = $1, preferred_stream_name = $2, tiktok_url = $3, twitch_url = $4, kick_url = $5,
        youtube_url = $6, twitter_url = $7, instagram_url = $8, discord_username = $9, other_socials = $10,
        avg_live_viewers = $11, stream_schedule = $12, content_summary = $13, why_rustmaxx = $14,
        status = 'pending', reviewed_by = NULL, reviewed_at = NULL, admin_notes = NULL, updated_at = now()
       WHERE user_id = $15
       RETURNING id, user_id, legal_name, preferred_stream_name, tiktok_url, twitch_url, kick_url, youtube_url, twitter_url, instagram_url,
         discord_username, other_socials, avg_live_viewers, stream_schedule, content_summary, why_rustmaxx,
         status, reviewed_by, reviewed_at, admin_notes, created_at, updated_at`,
      [...vals, userId]
    );
    if (!rows[0]) return { ok: false, error: "Update failed" };
    return { ok: true, row: rows[0] };
  }

  const { rows } = await query<StreamerApplicationRow>(
    `INSERT INTO streamer_applications (
        user_id, legal_name, preferred_stream_name, tiktok_url, twitch_url, kick_url, youtube_url, twitter_url, instagram_url,
        discord_username, other_socials, avg_live_viewers, stream_schedule, content_summary, why_rustmaxx
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, user_id, legal_name, preferred_stream_name, tiktok_url, twitch_url, kick_url, youtube_url, twitter_url, instagram_url,
        discord_username, other_socials, avg_live_viewers, stream_schedule, content_summary, why_rustmaxx,
        status, reviewed_by, reviewed_at, admin_notes, created_at, updated_at`,
    [userId, ...vals]
  );
  if (!rows[0]) return { ok: false, error: "Insert failed" };
  return { ok: true, row: rows[0] };
}

export async function setStreamerApplicationDecision(
  applicationId: string,
  reviewerUserId: string,
  decision: "approve" | "reject",
  adminNotes: string | null
): Promise<
  { ok: true; row: StreamerApplicationRow } | { ok: false; error: string }
> {
  const app = await getStreamerApplicationById(applicationId);
  if (!app) return { ok: false, error: "Application not found" };
  if (app.status !== "pending") {
    return { ok: false, error: "Application is not pending" };
  }

  const status: StreamerApplicationStatus = decision === "approve" ? "approved" : "rejected";
  const { rows } = await query<StreamerApplicationRow>(
    `UPDATE streamer_applications SET
      status = $1, reviewed_by = $2, reviewed_at = now(), admin_notes = $3, updated_at = now()
     WHERE id = $4 AND status = 'pending'
     RETURNING id, user_id, legal_name, preferred_stream_name, tiktok_url, twitch_url, kick_url, youtube_url, twitter_url, instagram_url,
       discord_username, other_socials, avg_live_viewers, stream_schedule, content_summary, why_rustmaxx,
       status, reviewed_by, reviewed_at, admin_notes, created_at, updated_at`,
    [status, reviewerUserId, adminNotes?.trim() || null, applicationId]
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "Could not update application" };

  if (decision === "approve") {
    const user = await findUserById(app.user_id);
    const role = (user?.role ?? "guest") as UserRole;
    if (role === "guest" || role === "player") {
      await updateUserRole(app.user_id, "streamer");
    }
  }

  return { ok: true, row };
}
