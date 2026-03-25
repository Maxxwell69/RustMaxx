import { NextRequest, NextResponse } from "next/server";
import { requireCanManageServersFromDb } from "@/lib/api-auth";
import { query } from "@/lib/db";
import type { ServerRow } from "@/lib/db";
import { getTikfinityWebhookUrlOrNull } from "@/lib/tikfinity-webhook-public-url";
import { getPublicOriginOrNull } from "@/lib/twitch-public-url";
import { ensureConnection } from "@/lib/rcon-manager";

const TIKFINITY_SERVER_ID = process.env.TIKFINITY_SERVER_ID?.trim() ?? null;

/**
 * GET: Admin-only snapshot of TikFinity webhook + RCON readiness (no secrets).
 * Optional: ?probeRcon=1 — attempts WebRCON connect to TIKFINITY_SERVER_ID (may take a few seconds).
 */
export async function GET(request: NextRequest) {
  const authErr = await requireCanManageServersFromDb(request);
  if (authErr) return authErr;

  const probeRcon = request.nextUrl.searchParams.get("probeRcon") === "1";

  const originRaw = getPublicOriginOrNull();
  const webhookUrl = getTikfinityWebhookUrlOrNull();

  const crewSpawnOnRegisterConfigured = Boolean(
    process.env.CREW_RNPC_TEMPLATE_KEY?.trim()
  );
  const npcmaxxRequireCrewRegistry =
    process.env.NPCMAXX_REQUIRE_CREW_REGISTRY === "true" ||
    process.env.NPCMAXX_REQUIRE_CREW_REGISTRY === "1";

  let server: Pick<ServerRow, "id" | "name" | "rcon_host" | "rcon_port"> | null = null;
  let rconProbe: { ok: boolean; error?: string } | undefined;

  if (TIKFINITY_SERVER_ID) {
    const { rows } = await query<ServerRow>(
      "SELECT id, name, rcon_host, rcon_port, rcon_password FROM servers WHERE id = $1",
      [TIKFINITY_SERVER_ID]
    );
    const row = rows[0];
    if (row) {
      server = {
        id: row.id,
        name: row.name,
        rcon_host: row.rcon_host,
        rcon_port: row.rcon_port,
      };
      if (probeRcon && row.rcon_host && row.rcon_port && row.rcon_password) {
        rconProbe = await ensureConnection(
          row.id,
          row.rcon_host,
          row.rcon_port,
          row.rcon_password,
          async () => {}
        );
      } else if (probeRcon) {
        rconProbe = { ok: false, error: "RCON host, port, or password missing in server row" };
      }
    }
  }

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    tikfinityServerId: TIKFINITY_SERVER_ID ? "configured" : "MISSING",
    tikfinityServerIdMatchesServer: Boolean(server),
    server: server
      ? {
          id: server.id,
          name: server.name,
          rconHostSet: Boolean(server.rcon_host?.trim()),
          rconPortSet: Boolean(server.rcon_port),
        }
      : null,
    webhookUrl,
    appUrlConfigured: Boolean(originRaw),
    features: {
      crewSpawnOnRegisterConfigured,
      npcmaxxRequireCrewRegistry,
    },
    rconProbe: probeRcon ? rconProbe : undefined,
    hints: buildHints({
      hasServerId: Boolean(TIKFINITY_SERVER_ID),
      serverFound: Boolean(server),
      webhookUrl: Boolean(webhookUrl),
      npcmaxxRequireCrewRegistry,
    }),
  });
}

function buildHints(opts: {
  hasServerId: boolean;
  serverFound: boolean;
  webhookUrl: boolean;
  npcmaxxRequireCrewRegistry: boolean;
}): string[] {
  const h: string[] = [];
  if (!opts.hasServerId) {
    h.push("Set TIKFINITY_SERVER_ID to the UUID from RustMaxx → Servers → open server → copy from URL.");
  } else if (!opts.serverFound) {
    h.push("TIKFINITY_SERVER_ID does not match any server in the database — fix the env var or re-add the server.");
  }
  if (!opts.webhookUrl) {
    h.push("APP_URL / SITE_URL not set — webhook URL in admin may be wrong; set public base URL in production.");
  }
  if (opts.npcmaxxRequireCrewRegistry) {
    h.push("NPCMAXX_REQUIRE_CREW_REGISTRY is on: npcmaxx webhooks need userId/uniqueId and a crew registry row from ?event=join.");
  }
  if (h.length === 0) {
    h.push("Config looks OK. If webhooks still fail: use Streamer interactions → Roaming NPC spawns log, Railway logs, and curl tests (see docs/TIKFINITY_WEBHOOK_DEBUG.md).");
  }
  return h;
}
