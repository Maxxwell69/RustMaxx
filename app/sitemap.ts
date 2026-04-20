import type { MetadataRoute } from "next";
import { listPublishedPlugins } from "@/lib/plugin-directory";

const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.rustmaxx.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/features`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/games`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.75 },
    { url: `${BASE}/pricing`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/docs`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/about`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/contact`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/server-list`, lastModified: new Date(), changeFrequency: "daily", priority: 0.7 },
    { url: `${BASE}/plugins`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.72 },
  ];

  try {
    const plugins = await listPublishedPlugins();
    const now = new Date();
    for (const p of plugins) {
      entries.push({
        url: `${BASE}/plugins/${encodeURIComponent(p.slug)}`,
        lastModified: now,
        changeFrequency: "weekly",
        priority: 0.65,
      });
    }
  } catch {
    // DATABASE_URL may be unset during static generation
  }

  return entries;
}
