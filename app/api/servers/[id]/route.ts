import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { disconnect } from "@/lib/rcon-manager";
import { audit } from "@/lib/audit";
import { requireCanManageServers, getSessionFromRequest } from "@/lib/api-auth";
import type { ServerRow } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { rows } = await query<ServerRow>(
    "SELECT id, name, rcon_host, rcon_port, created_at, listed, listing_name, listing_description, game_host, game_port, location, logo_url FROM servers WHERE id = $1",
    [id]
  );
  const server = rows[0];
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(server);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireCanManageServers(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;
  let body: {
    listed?: boolean;
    listing_name?: string | null;
    listing_description?: string | null;
    game_host?: string | null;
    game_port?: number | null;
    location?: string | null;
    logo_url?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { rows: existing } = await query<ServerRow>("SELECT id FROM servers WHERE id = $1", [serverId]);
  if (!existing[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (typeof body.listed === "boolean") {
    updates.push(`listed = $${idx++}`);
    values.push(body.listed);
  }
  if (body.listing_name !== undefined) {
    updates.push(`listing_name = $${idx++}`);
    values.push(typeof body.listing_name === "string" ? body.listing_name.trim() || null : null);
  }
  if (body.listing_description !== undefined) {
    updates.push(`listing_description = $${idx++}`);
    values.push(typeof body.listing_description === "string" ? body.listing_description.trim() || null : null);
  }
  if (body.game_host !== undefined) {
    updates.push(`game_host = $${idx++}`);
    values.push(typeof body.game_host === "string" ? body.game_host.trim() || null : null);
  }
  if (body.game_port !== undefined) {
    const gp = body.game_port == null ? null : Number(body.game_port);
    updates.push(`game_port = $${idx++}`);
    values.push(gp != null && Number.isInteger(gp) && gp >= 1 && gp <= 65535 ? gp : null);
  }
  if (body.location !== undefined) {
    updates.push(`location = $${idx++}`);
    values.push(typeof body.location === "string" ? body.location.trim() || null : null);
  }
  if (body.logo_url !== undefined) {
    updates.push(`logo_url = $${idx++}`);
    values.push(typeof body.logo_url === "string" ? body.logo_url.trim() || null : null);
  }
  if (updates.length === 0) {
    const { rows } = await query<ServerRow>(
      "SELECT id, name, rcon_host, rcon_port, created_at, listed, listing_name, listing_description, game_host, game_port, location, logo_url FROM servers WHERE id = $1",
      [serverId]
    );
    return NextResponse.json(rows[0]);
  }
  values.push(serverId);
  const { rows } = await query<ServerRow>(
    `UPDATE servers SET ${updates.join(", ")} WHERE id = $${idx} RETURNING id, name, rcon_host, rcon_port, created_at, listed, listing_name, listing_description, game_host, game_port, location, logo_url`,
    values
  );
  await audit(session.userId, "server.update", { serverId, fields: Object.keys(body) });
  return NextResponse.json(rows[0]);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireCanManageServers(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;
  const { rows } = await query<ServerRow>("SELECT id FROM servers WHERE id = $1", [serverId]);
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  disconnect(serverId);
  await query("DELETE FROM servers WHERE id = $1", [serverId]);
  await audit(session.userId, "server.delete", { serverId });
  return NextResponse.json({ ok: true });
}
