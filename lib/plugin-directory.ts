import { query } from "@/lib/db";

export type PluginDirectoryRow = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  marketing_href: string | null;
  sort_order: number;
  published: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

export async function listPublishedPlugins(): Promise<PluginDirectoryRow[]> {
  const { rows } = await query<PluginDirectoryRow>(
    `SELECT id, slug, title, tagline, description, marketing_href, sort_order, published, created_at, updated_at
     FROM plugin_directory
     WHERE published = true
     ORDER BY sort_order ASC, title ASC`
  );
  return rows;
}

export async function listAllPluginsForAdmin(): Promise<PluginDirectoryRow[]> {
  const { rows } = await query<PluginDirectoryRow>(
    `SELECT id, slug, title, tagline, description, marketing_href, sort_order, published, created_at, updated_at
     FROM plugin_directory
     ORDER BY sort_order ASC, title ASC`
  );
  return rows;
}

export async function getPluginBySlug(slug: string): Promise<PluginDirectoryRow | null> {
  const { rows } = await query<PluginDirectoryRow>(
    `SELECT id, slug, title, tagline, description, marketing_href, sort_order, published, created_at, updated_at
     FROM plugin_directory
     WHERE slug = $1 AND published = true`,
    [slug]
  );
  return rows[0] ?? null;
}

export async function getPluginById(id: string): Promise<PluginDirectoryRow | null> {
  const { rows } = await query<PluginDirectoryRow>(
    `SELECT id, slug, title, tagline, description, marketing_href, sort_order, published, created_at, updated_at
     FROM plugin_directory
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export function slugifyPluginSlug(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 120);
}
