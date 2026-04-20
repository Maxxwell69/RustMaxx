import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { query } from "@/lib/db";
import {
  absolutePathForUploadBasename,
  contentTypeForUploadBasename,
} from "@/lib/upload-files";
import { extractUploadBasenameFromPublicPath } from "@/lib/server-listing-logo";

type LogoRow = {
  listing_logo_bytes: Buffer | null;
  listing_logo_mime: string | null;
  logo_url: string | null;
};

/**
 * Public image for server list / marketing. Serves Postgres-backed bytes first, then legacy disk or redirect.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { serverId } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      serverId
    )
  ) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const { rows } = await query<LogoRow>(
    `SELECT listing_logo_bytes, listing_logo_mime, logo_url FROM servers WHERE id = $1`,
    [serverId]
  );
  const row = rows[0];
  if (!row) return new NextResponse("Not found", { status: 404 });

  if (row.listing_logo_bytes && row.listing_logo_bytes.length > 0) {
    const mime = (row.listing_logo_mime || "image/png").trim() || "image/png";
    return new NextResponse(new Uint8Array(row.listing_logo_bytes), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  const ref = (row.logo_url ?? "").trim();
  if (!ref) return new NextResponse("Not found", { status: 404 });

  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    return NextResponse.redirect(ref);
  }

  const base = extractUploadBasenameFromPublicPath(ref.startsWith("/") ? ref : `/${ref}`);
  if (base) {
    const abs = absolutePathForUploadBasename(base);
    if (abs) {
      try {
        const buf = await readFile(abs);
        return new NextResponse(new Uint8Array(buf), {
          status: 200,
          headers: {
            "Content-Type": contentTypeForUploadBasename(base),
            "Cache-Control": "public, max-age=3600",
          },
        });
      } catch {
        //
      }
    }
  }

  return new NextResponse("Not found", { status: 404 });
}
