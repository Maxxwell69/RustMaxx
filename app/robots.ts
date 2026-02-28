import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "https://rustmaxx.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/login", "/servers", "/api/"] },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
