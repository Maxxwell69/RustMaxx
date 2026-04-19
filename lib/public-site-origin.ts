import type { NextRequest } from "next/server";

/**
 * Public site origin for user-facing URLs (webhooks, redirects).
 * Prefer APP_URL / SITE_URL; otherwise infer from proxy headers or the request URL.
 */
export function getPublicSiteOrigin(request?: NextRequest): string | null {
  const envRaw = process.env.APP_URL?.trim() ?? process.env.SITE_URL?.trim();
  if (envRaw) {
    try {
      return new URL(envRaw).origin;
    } catch {
      /* fall through */
    }
  }
  if (!request) return null;

  const xfHost = request.headers.get("x-forwarded-host");
  const host =
    xfHost?.split(",")[0]?.trim() || request.headers.get("host")?.trim();

  let proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (proto !== "http" && proto !== "https") {
    proto =
      host?.includes("localhost") || host?.startsWith("127.") ? "http" : "https";
  }

  if (host) {
    try {
      return new URL(`${proto}://${host}`).origin;
    } catch {
      /* fall through */
    }
  }

  try {
    return request.nextUrl.origin;
  } catch {
    return null;
  }
}
