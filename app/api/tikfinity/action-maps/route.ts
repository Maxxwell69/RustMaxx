import { NextRequest, NextResponse } from "next/server";
import { requireCanManageServersFromDb } from "@/lib/api-auth";
import {
  getAvailableActionsForAdmin,
  getGiftToActionMapForAdmin,
} from "@/lib/tikfinity";
import { listTikfinityConnections } from "@/lib/tikfinity-connections";
import { getPublicOriginOrNull } from "@/lib/twitch-public-url";

/**
 * GET: Return TikFinity webhook URL, available actions, gift→action map, and admin connections.
 * Admin and super_admin only (same as server management).
 */
export async function GET(request: NextRequest) {
  try {
    const authErr = await requireCanManageServersFromDb(request);
    if (authErr) return authErr;

    const origin = getPublicOriginOrNull();
    const webhookUrl = origin ? `${origin}/api/tikfinity/webhook` : null;
    let connections: Awaited<ReturnType<typeof listTikfinityConnections>> = [];
    try {
      connections = await listTikfinityConnections();
    } catch (e) {
      console.error("[tikfinity action-maps] listTikfinityConnections failed:", e);
      // Table may not exist yet (migration not run); return rest of data with empty connections
    }

    return NextResponse.json({
      webhookUrl,
      availableActions: getAvailableActionsForAdmin(),
      giftToActionMap: getGiftToActionMapForAdmin(),
      connections,
    });
  } catch (e) {
    console.error("[tikfinity action-maps] GET failed:", e);
    return NextResponse.json(
      { error: "Failed to load TikFinity settings" },
      { status: 500 }
    );
  }
}
