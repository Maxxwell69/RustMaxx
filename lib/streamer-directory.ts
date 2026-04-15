import { query } from "./db";
import {
  buildPublicSocialEntries,
  coerceDirectorySocialsFromDb,
  type ApplicationSocialFields,
  type PublicSocialEntry,
} from "./streamer-directory-socials";

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

export type PublicServerChip = {
  id: string;
  name: string;
};

export type StreamerPublicProfileDetail = {
  id: string;
  display_name: string | null;
  stream_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  directory_visible: boolean;
  application_approved: boolean;
  directory_socials: Record<string, string>;
  directory_show_servers: boolean;
  application_socials: ApplicationSocialFields;
  socials: PublicSocialEntry[];
  servers: PublicServerChip[];
};

type ProfileQueryRow = {
  id: string;
  display_name: string | null;
  stream_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  directory_visible: boolean;
  application_approved: boolean;
  directory_socials: unknown;
  directory_show_servers: boolean;
  app_tiktok_url: string | null;
  app_twitch_url: string | null;
  app_kick_url: string | null;
  app_youtube_url: string | null;
  app_twitter_url: string | null;
  app_instagram_url: string | null;
  app_discord_username: string | null;
  app_other_socials: string | null;
};

export async function listListedServersForApprovedStreamer(userId: string): Promise<PublicServerChip[]> {
  const { rows } = await query<{ id: string; listing_name: string | null; name: string }>(
    `SELECT s.id, s.listing_name, s.name
     FROM streamer_server_requests ssr
     INNER JOIN servers s ON s.id = ssr.server_id
     WHERE ssr.user_id = $1::uuid
       AND ssr.status = 'approved'
       AND COALESCE(s.listed, false) = true
     ORDER BY lower(COALESCE(s.listing_name, s.name))`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: (r.listing_name && r.listing_name.trim()) || r.name,
  }));
}

export async function getStreamerPublicProfileRow(userId: string): Promise<StreamerPublicProfileDetail | null> {
  const { rows } = await query<ProfileQueryRow>(
    `SELECT u.id,
            u.display_name,
            sa.preferred_stream_name AS stream_name,
            NULLIF(trim(u.streamer_directory_avatar_url), '') AS avatar_url,
            NULLIF(trim(u.streamer_directory_bio), '') AS bio,
            COALESCE(u.streamer_directory_visible, false) AS directory_visible,
            EXISTS (
              SELECT 1 FROM streamer_applications sa2
              WHERE sa2.user_id = u.id AND sa2.status = 'approved'
            ) AS application_approved,
            COALESCE(u.streamer_directory_socials, '{}'::jsonb) AS directory_socials,
            COALESCE(u.streamer_directory_show_servers, false) AS directory_show_servers,
            sa.tiktok_url AS app_tiktok_url,
            sa.twitch_url AS app_twitch_url,
            sa.kick_url AS app_kick_url,
            sa.youtube_url AS app_youtube_url,
            sa.twitter_url AS app_twitter_url,
            sa.instagram_url AS app_instagram_url,
            sa.discord_username AS app_discord_username,
            sa.other_socials AS app_other_socials
     FROM users u
     LEFT JOIN streamer_applications sa ON sa.user_id = u.id AND sa.status = 'approved'
     WHERE u.id = $1::uuid
     LIMIT 1`,
    [userId]
  );
  const r = rows[0];
  if (!r) return null;

  const application_socials: ApplicationSocialFields = {
    tiktok_url: r.app_tiktok_url,
    twitch_url: r.app_twitch_url,
    kick_url: r.app_kick_url,
    youtube_url: r.app_youtube_url,
    twitter_url: r.app_twitter_url,
    instagram_url: r.app_instagram_url,
    discord_username: r.app_discord_username,
    other_socials: r.app_other_socials,
  };

  const directory_socials = coerceDirectorySocialsFromDb(r.directory_socials);
  const socials = buildPublicSocialEntries(directory_socials, application_socials);

  let servers: PublicServerChip[] = [];
  if (r.directory_show_servers) {
    servers = await listListedServersForApprovedStreamer(userId);
  }

  return {
    id: r.id,
    display_name: r.display_name,
    stream_name: r.stream_name,
    avatar_url: r.avatar_url,
    bio: r.bio,
    directory_visible: r.directory_visible,
    application_approved: r.application_approved,
    directory_socials,
    directory_show_servers: r.directory_show_servers,
    application_socials,
    socials,
    servers,
  };
}
