import path from "path";

/** On-disk folder used by POST /api/upload (must match GET /api/uploads/[filename]). */
export const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Basename only; rejects traversal and odd characters. */
export function isSafeUploadBasename(filename: string): boolean {
  if (!filename || filename.length > 220) return false;
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) return false;
  if (filename.includes("?") || filename.includes("#")) return false;
  return /^[a-zA-Z0-9._-]+$/.test(filename);
}

export function absolutePathForUploadBasename(filename: string): string | null {
  if (!isSafeUploadBasename(filename)) return null;
  return path.join(UPLOADS_DIR, filename);
}

export function contentTypeForUploadBasename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

/** Same-origin paths that point at our upload GET route (after POST /api/upload). */
export function isOurHostedUploadPublicPath(trimmed: string): boolean {
  for (const prefix of ["/api/uploads/", "/uploads/"]) {
    if (trimmed.startsWith(prefix)) {
      const name = trimmed.slice(prefix.length);
      return isSafeUploadBasename(name);
    }
  }
  return false;
}

/**
 * Store RustMaxx-hosted logos as same-origin paths (`/api/uploads/...`) so public pages always
 * resolve on the current domain (avoids broken images when DB has `https://old-host/...` from copy-paste).
 */
export function normalizeHostedLogoUrlForStorage(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (t.startsWith("/")) return t;
  try {
    const u = new URL(t);
    const path = u.pathname + (u.search || "");
    if (isOurHostedUploadPublicPath(path)) return path;
    return t;
  } catch {
    return t;
  }
}

/** For `<img src>`: prefer relative path for our uploads so the browser hits the current origin. */
export function logoUrlForImgSrc(raw: string | null | undefined): string | null {
  return normalizeHostedLogoUrlForStorage(raw);
}
