import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { query } from "@/lib/db";
import {
  absolutePathForUploadBasename,
  contentTypeForUploadBasename,
} from "@/lib/upload-files";
import { extractUploadBasenameFromPublicPath } from "@/lib/server-listing-logo";

type Row = {
  streamer_directory_avatar_bytes: Buffer | null;
  streamer_directory_avatar_mime: string | null;
  streamer_directory_avatar_url: string | null;
};

/** Public avatar image for streamer directory cards and profiles. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)
  ) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const { rows } = await query<Row>(
    `SELECT streamer_directory_avatar_bytes, streamer_directory_avatar_mime, streamer_directory_avatar_url
     FROM users WHERE id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row) return new NextResponse("Not found", { status: 404 });

  if (row.streamer_directory_avatar_bytes && row.streamer_directory_avatar_bytes.length > 0) {
    const mime =
      (row.streamer_directory_avatar_mime || "image/png").trim() || "image/png";
    return new NextResponse(new Uint8Array(row.streamer_directory_avatar_bytes), {
      status: 200,
      headers: {
        "Content-Type": mime.startsWith("image/") ? mime : "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  const ref = (row.streamer_directory_avatar_url ?? "").trim();
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
