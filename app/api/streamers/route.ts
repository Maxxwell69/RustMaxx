import { NextResponse } from "next/server";
import { listPublicDirectoryStreamers } from "@/lib/streamer-directory";

/** Public directory of streamers who opted in on their profile. */
export async function GET() {
  try {
    const streamers = await listPublicDirectoryStreamers();
    return NextResponse.json({ streamers });
  } catch (e) {
    console.error("[streamers] GET failed:", e);
    return NextResponse.json({ streamers: [], error: "Could not load directory" }, { status: 503 });
  }
}
