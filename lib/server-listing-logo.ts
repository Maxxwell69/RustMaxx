import { readFile } from "fs/promises";
import {
  absolutePathForUploadBasename,
  contentTypeForUploadBasename,
  isOurHostedUploadPublicPath,
  isSafeUploadBasename,
} from "@/lib/upload-files";

/** Public URL pattern for logos stored in `servers.listing_logo_bytes`. */
export function canonicalListingLogoPath(serverId: string): string {
  return `/api/listing-logos/${serverId}`;
}

export function extractUploadBasenameFromPublicPath(normalizedPath: string): string | null {
  for (const prefix of ["/api/uploads/", "/uploads/"]) {
    if (normalizedPath.startsWith(prefix)) {
      const name = normalizedPath.slice(prefix.length);
      return isSafeUploadBasename(name) ? name : null;
    }
  }
  return null;
}

export type UploadIngestResult =
  | { ok: true; bytes: Buffer; mime: string; basename: string }
  | { ok: false; reason: "invalid" | "missing" };

/** Read a file previously written by POST /api/upload (local disk). */
export async function readHostedUploadForLogoIngest(
  normalizedPublicPath: string
): Promise<UploadIngestResult> {
  if (!isOurHostedUploadPublicPath(normalizedPublicPath)) {
    return { ok: false, reason: "invalid" };
  }
  const basename = extractUploadBasenameFromPublicPath(normalizedPublicPath);
  if (!basename) return { ok: false, reason: "invalid" };
  const abs = absolutePathForUploadBasename(basename);
  if (!abs) return { ok: false, reason: "invalid" };
  try {
    const bytes = await readFile(abs);
    const mime = contentTypeForUploadBasename(basename);
    return { ok: true, bytes, mime, basename };
  } catch {
    return { ok: false, reason: "missing" };
  }
}
