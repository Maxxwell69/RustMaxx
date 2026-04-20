import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireCanManageServersFromDb } from "@/lib/api-auth";
import { getPluginById, slugifyPluginSlug, type PluginDirectoryRow } from "@/lib/plugin-directory";

type Ctx = { params: Promise<{ id: string }> };

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

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const err = await requireCanManageServersFromDb(request);
  if (err) return err;
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const existing = await getPluginById(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const slugRaw = typeof body.slug === "string" ? body.slug : existing.slug;
  const slug = slugifyPluginSlug(slugRaw);
  if (!slug) {
    return NextResponse.json({ error: "slug is invalid" }, { status: 400 });
  }
  if (slug !== existing.slug) {
    const dup = await query<{ slug: string }>(
      `SELECT slug FROM plugin_directory WHERE slug = $1 AND id <> $2`,
      [slug, id]
    );
    if (dup.rows.length > 0) {
      return NextResponse.json({ error: "That slug is already in use" }, { status: 409 });
    }
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const tagline = typeof body.tagline === "string" ? body.tagline.trim() || null : null;
  const description =
    typeof body.description === "string" ? body.description.trim() || null : null;

  let marketing_href = existing.marketing_href;
  if ("marketing_href" in body) {
    if (typeof body.marketing_href !== "string") {
      return NextResponse.json({ error: "marketing_href must be a string" }, { status: 400 });
    }
    const h = body.marketing_href.trim();
    if (!h) marketing_href = null;
    else {
      if (!h.startsWith("/")) {
        return NextResponse.json({ error: "marketing_href must start with /" }, { status: 400 });
      }
      marketing_href = h;
    }
  }

  const sortOrderRaw = body.sort_order;
  let sort_order = existing.sort_order;
  if (typeof sortOrderRaw === "number" && Number.isFinite(sortOrderRaw)) sort_order = sortOrderRaw;
  else if (typeof sortOrderRaw === "string" && sortOrderRaw.trim()) {
    const n = parseInt(sortOrderRaw, 10);
    if (Number.isFinite(n)) sort_order = n;
  }

  const published = typeof body.published === "boolean" ? body.published : existing.published;

  try {
    const { rows } = await query<PluginDirectoryRow>(
      `UPDATE plugin_directory
       SET slug = $2, title = $3, tagline = $4, description = $5, marketing_href = $6, sort_order = $7, published = $8,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, slug, title, tagline, description, marketing_href, sort_order, published, created_at, updated_at`,
      [id, slug, title, tagline, description, marketing_href, sort_order, published]
    );
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Update failed" }, { status: 500 });
    return NextResponse.json({ plugin: serialize(row) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const err = await requireCanManageServersFromDb(request);
  if (err) return err;
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const existing = await getPluginById(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await query(`DELETE FROM plugin_directory WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
