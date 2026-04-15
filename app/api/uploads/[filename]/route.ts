import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import {
  absolutePathForUploadBasename,
  contentTypeForUploadBasename,
  isSafeUploadBasename,
} from "@/lib/upload-files";

/**
 * Serves files written by POST /api/upload. Needed because many deployments do not expose
 * runtime files under /public as static URLs reliably (read-only image, multiple instances, CDN).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename: raw } = await params;
  const filename = decodeURIComponent(raw);
  if (!isSafeUploadBasename(filename)) {
    return new NextResponse("Bad request", { status: 400 });
  }
  const abs = absolutePathForUploadBasename(filename);
  if (!abs) return new NextResponse("Not found", { status: 404 });

  let body: Buffer;
  try {
    body = await readFile(abs);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": contentTypeForUploadBasename(filename),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
