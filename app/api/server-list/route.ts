import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { PublicServerRow } from "@/lib/db";

/**
 * Public API: returns servers that have opted in to the public list.
 * Only safe fields are returned (no RCON credentials).
 */
export async function GET() {
  try {
    const { rows } = await query<PublicServerRow>(
      `SELECT id, name, listing_name, listing_description, game_host, game_port, location, logo_url
       FROM servers
       WHERE listed = true
       ORDER BY name ASC`
    );
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
