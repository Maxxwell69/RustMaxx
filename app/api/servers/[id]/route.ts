import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { ServerRow } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { rows } = await query<ServerRow>(
    "SELECT id, name, rcon_host, rcon_port, created_at FROM servers WHERE id = $1",
    [id]
  );
  const server = rows[0];
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(server);
}
