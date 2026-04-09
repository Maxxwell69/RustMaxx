import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { disconnect } from "@/lib/rcon-manager";
import { audit } from "@/lib/audit";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerWithRole, canEditServer, canDeleteServer } from "@/lib/server-access";
import type { ServerRow } from "@/lib/db";
import { parseSteam64Anchor } from "@/lib/maxxinvaders-anchor-steam";
import {
  assertOwnerActionsAllowedByCatalog,
  validateAllowedActionsPayload,
} from "@/lib/streamer-action-policy";
import {
  assertOwnerStreamerItemsAllowedByCatalog,
  validateStreamerItemShortnamesPayload,
} from "@/lib/streamer-item-policy";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id } = await params;
  const result = await getServerWithRole(id, session.userId, session.role);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { rcon_password: _pw, ...safe } = result.server as Record<string, unknown>;
  return NextResponse.json({ ...safe, myRole: result.serverRole });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;
  const result = await getServerWithRole(serverId, session.userId, session.role);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canEditServer(result.serverRole)) return NextResponse.json({ error: "Only owner or server admin can edit" }, { status: 403 });
  const existing = result.server;
  let body: {
    listed?: boolean;
    listing_name?: string | null;
    listing_description?: string | null;
    game_host?: string | null;
    game_port?: number | null;
    location?: string | null;
    logo_url?: string | null;
    map_preview_url?: string | null;
    /** WebRCON host (IP or hostname, no scheme). */
    rcon_host?: string;
    rcon_port?: number;
    /** Omit or leave empty to keep existing password; send non-empty to replace. */
    rcon_password?: string;
    /** TikFinity maxxinvaders default patrol anchor (Steam64); null or "" clears. */
    tikfinity_anchor_steam_id?: string | null;
    /** Allow streamers to use TikFinity hooks targeting this server. */
    streamer_interactions_enabled?: boolean;
    /** Actions streamers may use (RustChaos / social only); owner-chosen subset of platform catalog. */
    streamer_allowed_actions?: string[];
    /** Rust item shortnames streamers may reference; subset of platform streamer items. */
    streamer_allowed_item_shortnames?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

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
  if (body.map_preview_url !== undefined) {
    updates.push(`map_preview_url = $${idx++}`);
    values.push(
      typeof body.map_preview_url === "string" ? body.map_preview_url.trim() || null : null
    );
  }

  let rconCredentialsChanged = false;
  if (body.rcon_host !== undefined) {
    const h = typeof body.rcon_host === "string" ? body.rcon_host.trim() : "";
    if (!h) {
      return NextResponse.json({ error: "rcon_host cannot be empty" }, { status: 400 });
    }
    updates.push(`rcon_host = $${idx++}`);
    values.push(h);
    rconCredentialsChanged = true;
  }
  if (body.rcon_port !== undefined) {
    const p = typeof body.rcon_port === "number" ? body.rcon_port : Number(body.rcon_port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      return NextResponse.json({ error: "rcon_port must be 1–65535" }, { status: 400 });
    }
    updates.push(`rcon_port = $${idx++}`);
    values.push(p);
    rconCredentialsChanged = true;
  }
  if (
    body.rcon_password !== undefined &&
    typeof body.rcon_password === "string" &&
    body.rcon_password.trim() !== ""
  ) {
    updates.push(`rcon_password = $${idx++}`);
    values.push(body.rcon_password.trim());
    rconCredentialsChanged = true;
  }

  if (body.streamer_interactions_enabled !== undefined) {
    if (typeof body.streamer_interactions_enabled !== "boolean") {
      return NextResponse.json(
        { error: "streamer_interactions_enabled must be a boolean" },
        { status: 400 }
      );
    }
    updates.push(`streamer_interactions_enabled = $${idx++}`);
    values.push(body.streamer_interactions_enabled);
  }
  if (body.streamer_allowed_actions !== undefined) {
    const parsed = validateAllowedActionsPayload(body.streamer_allowed_actions);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const catOk = await assertOwnerActionsAllowedByCatalog(parsed);
    if ("error" in catOk) {
      return NextResponse.json({ error: catOk.error }, { status: 400 });
    }
    updates.push(`streamer_allowed_actions = $${idx++}`);
    values.push(parsed);
  }
  if (body.streamer_allowed_item_shortnames !== undefined) {
    const parsed = validateStreamerItemShortnamesPayload(body.streamer_allowed_item_shortnames);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const itemOk = await assertOwnerStreamerItemsAllowedByCatalog(parsed);
    if ("error" in itemOk) {
      return NextResponse.json({ error: itemOk.error }, { status: 400 });
    }
    updates.push(`streamer_allowed_item_shortnames = $${idx++}`);
    values.push(parsed);
  }

  if (body.tikfinity_anchor_steam_id !== undefined) {
    const raw = body.tikfinity_anchor_steam_id;
    if (raw === null || raw === "") {
      updates.push(`tikfinity_anchor_steam_id = $${idx++}`);
      values.push(null);
    } else if (typeof raw === "string") {
      const t = raw.trim();
      if (t === "") {
        updates.push(`tikfinity_anchor_steam_id = $${idx++}`);
        values.push(null);
      } else {
        const ok = parseSteam64Anchor(t);
        if (!ok) {
          return NextResponse.json(
            { error: "tikfinity_anchor_steam_id must be exactly 17 digits (Steam64) or empty" },
            { status: 400 }
          );
        }
        updates.push(`tikfinity_anchor_steam_id = $${idx++}`);
        values.push(ok);
      }
    }
  }

  if (updates.length === 0) {
    const { rcon_password: _sec, ...safeExisting } = existing as Record<string, unknown>;
    return NextResponse.json({ ...safeExisting, myRole: result.serverRole });
  }
  if (rconCredentialsChanged) disconnect(serverId);
  values.push(serverId);
  const { rows } = await query<ServerRow>(
    `UPDATE servers SET ${updates.join(", ")} WHERE id = $${idx} RETURNING id, name, rcon_host, rcon_port, created_at, listed, listing_name, listing_description, game_host, game_port, location, logo_url, seed, world_size, level, map_preview_url, map_last_fetched_at, tikfinity_anchor_steam_id, streamer_interactions_enabled, streamer_allowed_actions, streamer_allowed_item_shortnames`,
    values
  );
  const auditFields = Object.keys(body).filter((k) => k !== "rcon_password");
  if (body.rcon_password !== undefined && String(body.rcon_password).trim() !== "") {
    auditFields.push("rcon_password_set");
  }
  await audit(session.userId, "server.update", { serverId, fields: auditFields });
  return NextResponse.json({ ...rows[0], myRole: result.serverRole });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;
  const result = await getServerWithRole(serverId, session.userId, session.role);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canDeleteServer(result.serverRole)) return NextResponse.json({ error: "Only owner or server admin can delete" }, { status: 403 });
  disconnect(serverId);
  await query("DELETE FROM servers WHERE id = $1", [serverId]);
  await audit(session.userId, "server.delete", { serverId });
  return NextResponse.json({ ok: true });
}
