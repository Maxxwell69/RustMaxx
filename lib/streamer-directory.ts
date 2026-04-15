import { query } from "./db";

export type PublicStreamerCard = {
  id: string;
  display_name: string | null;
  stream_name: string | null;
  avatar_url: string | null;
  bio_summary: string | null;
};

/** Users who opted in and have a staff-approved streamer application. */
export async function listPublicDirectoryStreamers(): Promise<PublicStreamerCard[]> {
  const { rows } = await query<PublicStreamerCard>(
    `SELECT u.id,
            u.display_name,
            sa.preferred_stream_name AS stream_name,
            NULLIF(trim(u.streamer_directory_avatar_url), '') AS avatar_url,
            NULLIF(trim(u.streamer_directory_bio), '') AS bio_summary
     FROM users u
     INNER JOIN streamer_applications sa ON sa.user_id = u.id AND sa.status = 'approved'
     WHERE COALESCE(u.streamer_directory_visible, false) = true
     ORDER BY lower(COALESCE(sa.preferred_stream_name, u.display_name, u.email)) ASC`
  );
  return rows;
}

export type PublicStreamerProfileRow = {
  id: string;
  display_name: string | null;
  stream_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  directory_visible: boolean;
  application_approved: boolean;
};

export async function getStreamerPublicProfileRow(
  userId: string
): Promise<PublicStreamerProfileRow | null> {
  const { rows } = await query<{
    id: string;
    display_name: string | null;
    stream_name: string | null;
    avatar_url: string | null;
    bio: string | null;
    directory_visible: boolean;
    application_approved: boolean;
  }>(
    `SELECT u.id,
            u.display_name,
            (SELECT sa.preferred_stream_name FROM streamer_applications sa
              WHERE sa.user_id = u.id AND sa.status = 'approved' LIMIT 1) AS stream_name,
            NULLIF(trim(u.streamer_directory_avatar_url), '') AS avatar_url,
            NULLIF(trim(u.streamer_directory_bio), '') AS bio,
            COALESCE(u.streamer_directory_visible, false) AS directory_visible,
            EXISTS (
              SELECT 1 FROM streamer_applications sa2
              WHERE sa2.user_id = u.id AND sa2.status = 'approved'
            ) AS application_approved
     FROM users u
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    display_name: r.display_name,
    stream_name: r.stream_name,
    avatar_url: r.avatar_url,
    bio: r.bio,
    directory_visible: r.directory_visible,
    application_approved: r.application_approved,
  };
}
