import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireCanManageServersFromDb } from "@/lib/api-auth";
import {
  listAllPluginsForAdmin,
  slugifyPluginSlug,
  type PluginDirectoryRow,
} from "@/lib/plugin-directory";

function serialize(p: PluginDirectoryRow) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    tagline: p.tagline,
    description: p.description,
    marketing_href: p.marketing_href,
    sort_order: p.sort_order,
    published: p.published,
    created_at: p.created_at instanceof Date ? p.created_at.toISOString() : String(p.created_at),
    updated_at: p.updated_at instanceof Date ? p.updated_at.toISOString() : String(p.updated_at),
  };
}

/** Admin + super_admin: list all plugins. */
export async function GET(request: NextRequest) {
  const err = await requireCanManageServersFromDb(request);
  if (err) return err;
  try {
    const rows = await listAllPluginsForAdmin();
    return NextResponse.json({ plugins: rows.map(serialize) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load plugins";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Admin + super_admin: create plugin row. */
export async function POST(request: NextRequest) {
  const err = await requireCanManageServersFromDb(request);
  if (err) return err;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slugRaw = typeof body.slug === "string" ? body.slug : "";
  const slug = slugifyPluginSlug(slugRaw);
  if (!slug) {
    return NextResponse.json({ error: "slug is required (letters, numbers, hyphens)" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const tagline =
    typeof body.tagline === "string" && body.tagline.trim() ? body.tagline.trim() : null;
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;
  let marketing_href: string | null = null;
  if (typeof body.marketing_href === "string" && body.marketing_href.trim()) {
    const h = body.marketing_href.trim();
    if (!h.startsWith("/")) {
      return NextResponse.json({ error: "marketing_href must start with /" }, { status: 400 });
    }
    marketing_href = h;
  }
  const sortOrderRaw = body.sort_order;
  let sort_order = 0;
  if (typeof sortOrderRaw === "number" && Number.isFinite(sortOrderRaw)) sort_order = sortOrderRaw;
  else if (typeof sortOrderRaw === "string" && sortOrderRaw.trim()) {
    const n = parseInt(sortOrderRaw, 10);
    if (Number.isFinite(n)) sort_order = n;
  }
  const published = body.published !== false;

  try {
    const dup = await query<{ n: string }>(
      `SELECT slug AS n FROM plugin_directory WHERE slug = $1`,
      [slug]
    );
    if (dup.rows.length > 0) {
      return NextResponse.json({ error: "That slug is already in use" }, { status: 409 });
    }
    const { rows } = await query<PluginDirectoryRow>(
      `INSERT INTO plugin_directory (slug, title, tagline, description, marketing_href, sort_order, published)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, slug, title, tagline, description, marketing_href, sort_order, published, created_at, updated_at`,
      [slug, title, tagline, description, marketing_href, sort_order, published]
    );
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    return NextResponse.json({ plugin: serialize(row) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Insert failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
