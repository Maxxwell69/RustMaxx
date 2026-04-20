import { NextResponse } from "next/server";
import { listPublicDirectoryStreamers } from "@/lib/streamer-directory";
import { logoUrlForImgSrc } from "@/lib/upload-files";

/** Public directory of streamers who opted in on their profile. */
export async function GET() {
  try {
    const streamers = await listPublicDirectoryStreamers();
    const fixed = streamers.map((s) => ({
      ...s,
      avatar_url: logoUrlForImgSrc(s.avatar_url),
    }));
    return NextResponse.json({ streamers: fixed });
  } catch (e) {
    console.error("[streamers] GET failed:", e);
    return NextResponse.json({ streamers: [], error: "Could not load directory" }, { status: 503 });
  }
}
