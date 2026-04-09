import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

const pool =
  typeof connectionString === "string" && connectionString.length > 0
    ? new Pool({ connectionString })
    : null;

export async function query<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number }> {
  if (!pool) throw new Error("DATABASE_URL is not set");
  const result = await pool.query(text, params);
  return { rows: (result.rows as T[]) || [], rowCount: result.rowCount ?? 0 };
}

export { pool };

export type ServerRow = {
  id: string;
  name: string;
  rcon_host: string;
  rcon_port: number;
  rcon_password: string;
  created_at: Date;
  owner_id?: string | null;
  listed?: boolean;
  listing_name?: string | null;
  listing_description?: string | null;
  game_host?: string | null;
  game_port?: number | null;
  location?: string | null;
  logo_url?: string | null;
  seed?: number | null;
  world_size?: number | null;
  level?: string | null;
  map_preview_url?: string | null;
  map_last_fetched_at?: Date | string | null;
  /** TikFinity maxxinvaders: default patrol anchor (Steam64) when URL/body omit anchorSteam. */
  tikfinity_anchor_steam_id?: string | null;
  /** Server owner allows streamers to target this server for TikFinity webhooks. */
  streamer_interactions_enabled?: boolean;
  /** Subset of platform streamer actions this server allows (owner-chosen). */
  streamer_allowed_actions?: string[];
  /** Subset of streamer_platform_items streamers may reference on this server. */
  streamer_allowed_item_shortnames?: string[];
};

export type PublicServerRow = {
  id: string;
  name: string;
  listing_name: string | null;
  listing_description: string | null;
  game_host: string | null;
  game_port: number | null;
  location: string | null;
  logo_url: string | null;
};

export type LogRow = {
  id: string;
  server_id: string;
  type: string;
  message: string;
  created_at: Date;
};
