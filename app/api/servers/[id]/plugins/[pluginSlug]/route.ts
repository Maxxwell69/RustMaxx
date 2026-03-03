import { NextRequest, NextResponse } from "next/server";
import { ensureConnection, runAndWait } from "@/lib/rcon-manager";
import { pool } from "@/lib/db";
import type { ServerRow } from "@/lib/db";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerIfAccessible } from "@/lib/server-access";
import {
  parseOxidePluginsOutput,
  parseOxidePermsOutput,
  permissionsForPlugin,
  pluginSlugFromFilename,
  type PluginEntry,
} from "@/lib/oxide-plugins";

async function ensureConnected(
  serverId: string,
  server: ServerRow
): Promise<{ ok: boolean; error?: string }> {
  if (!pool)
    return {
      ok: false,
      error: "Server not configured. Connect from the server page first.",
    };
  return ensureConnection(
    server.id,
    server.rcon_host,
    server.rcon_port,
    server.rcon_password,
    async () => {}
  );
}

function findPluginBySlug(plugins: PluginEntry[], slug: string): PluginEntry | null {
  const decoded = decodeURIComponent(slug).trim();
  const normalizedDecoded = decoded.toLowerCase();
  for (const p of plugins) {
    const fileSlug = pluginSlugFromFilename(p.filename);
    if (fileSlug === decoded || fileSlug.toLowerCase() === normalizedDecoded) return p;
    if (p.name.toLowerCase() === normalizedDecoded) return p;
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pluginSlug: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId, pluginSlug } = await params;
  const server = await getServerIfAccessible(serverId, session.userId, session.role);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const connected = await ensureConnected(serverId, server);
    if (!connected.ok) {
      return NextResponse.json(
        {
          error: connected.error ?? "Not connected",
          code: "not_connected",
          plugin: null,
          permissions: [],
        },
        { status: 502 }
      );
    }

    const pluginsRaw = await runAndWait(serverId, "oxide.plugins", 15000);
    const { plugins } = parseOxidePluginsOutput(pluginsRaw ?? "");
    const plugin = findPluginBySlug(plugins, pluginSlug);
    if (!plugin) {
      return NextResponse.json(
        { error: "Plugin not found", code: "not_found", plugin: null, permissions: [] },
        { status: 404 }
      );
    }

    let permissions: string[] = [];
    try {
      const permsRaw = await runAndWait(serverId, "oxide.show perms", 10000);
      const allPerms = parseOxidePermsOutput(permsRaw ?? "");
      permissions = permissionsForPlugin(allPerms, plugin.filename, plugin.name);
    } catch {
      // Permissions are optional; plugin info still returned
    }

    return NextResponse.json({
      plugin: {
        name: plugin.name,
        version: plugin.version,
        author: plugin.author,
        hookTime: plugin.hookTime,
        filename: plugin.filename,
      },
      permissions,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[plugins/pluginSlug] error", serverId, pluginSlug, message);
    return NextResponse.json(
      { error: message, code: "rcon_error", plugin: null, permissions: [] },
      { status: 502 }
    );
  }
}
