import { NextRequest, NextResponse } from "next/server";
import { requireCanManageServersFromDb } from "@/lib/api-auth";
import {
  getAvailableActionsForAdmin,
  getGiftToActionMapForAdmin,
} from "@/lib/tikfinity";
import { listTikfinityConnections } from "@/lib/tikfinity-connections";
import { getTikfinityWebhookUrlOrNull } from "@/lib/tikfinity-webhook-public-url";

/**
 * GET: Return TikFinity webhook URL, available actions, gift→action map, and admin connections.
 * Admin and super_admin only (same as server management).
 */
export async function GET(request: NextRequest) {
  try {
    const authErr = await requireCanManageServersFromDb(request);
    if (authErr) return authErr;

    const webhookUrl = getTikfinityWebhookUrlOrNull();
    let connections: Awaited<ReturnType<typeof listTikfinityConnections>> = [];
    try {
      connections = await listTikfinityConnections();
    } catch (e) {
      console.error("[tikfinity action-maps] listTikfinityConnections failed:", e);
      // Table may not exist yet (migration not run); return rest of data with empty connections
    }

    const crewSpawnOnRegisterConfigured = Boolean(
      process.env.CREW_RNPC_TEMPLATE_KEY?.trim()
    );
    const npcmaxxRequireCrewRegistry =
      process.env.NPCMAXX_REQUIRE_CREW_REGISTRY === "true" ||
      process.env.NPCMAXX_REQUIRE_CREW_REGISTRY === "1";

    return NextResponse.json({
      webhookUrl,
      availableActions: getAvailableActionsForAdmin(),
      giftToActionMap: getGiftToActionMapForAdmin(),
      connections,
      tikfinityFeatures: {
        crewSpawnOnRegisterConfigured,
        npcmaxxRequireCrewRegistry,
      },
    });
  } catch (e) {
    console.error("[tikfinity action-maps] GET failed:", e);
    return NextResponse.json(
      { error: "Failed to load TikFinity settings" },
      { status: 500 }
    );
  }
}
