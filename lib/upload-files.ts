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
