import { NextResponse } from "next/server";
import { listPublishedPlugins } from "@/lib/plugin-directory";

function serialize(p: Awaited<ReturnType<typeof listPublishedPlugins>>[number]) {
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

/** Public plugin directory listing. */
export async function GET() {
  try {
    const rows = await listPublishedPlugins();
    return NextResponse.json({ plugins: rows.map(serialize) });
  } catch {
    return NextResponse.json({ plugins: [] });
  }
}
