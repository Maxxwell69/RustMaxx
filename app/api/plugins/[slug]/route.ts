import { NextResponse } from "next/server";
import { getPluginBySlug } from "@/lib/plugin-directory";

type Ctx = { params: Promise<{ slug: string }> };

function serialize(p: NonNullable<Awaited<ReturnType<typeof getPluginBySlug>>>) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    tagline: p.tagline,
    description: p.description,
    marketing_href: p.marketing_href,
    sort_order: p.sort_order,
    created_at: p.created_at instanceof Date ? p.created_at.toISOString() : String(p.created_at),
    updated_at: p.updated_at instanceof Date ? p.updated_at.toISOString() : String(p.updated_at),
  };
}

/** Public single plugin by slug (published only). */
export async function GET(_request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const row = await getPluginBySlug(decodeURIComponent(slug));
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ plugin: serialize(row) });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
