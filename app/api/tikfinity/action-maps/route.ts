import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { CAN_MANAGE_SERVERS } from "@/lib/permissions";
import {
  getAvailableActionsForAdmin,
  getGiftToActionMapForAdmin,
} from "@/lib/tikfinity";
import { getPublicOriginOrNull } from "@/lib/twitch-public-url";

/**
 * GET: Return TikFinity webhook URL, available actions, and gift→action map.
 * Admin and super_admin only (same as server management).
 */
export async function GET(request: NextRequest) {
  const authErr = requireRole(request, CAN_MANAGE_SERVERS);
  if (authErr) return authErr;

  const origin = getPublicOriginOrNull();
  const webhookUrl = origin ? `${origin}/api/tikfinity/webhook` : null;

  return NextResponse.json({
    webhookUrl,
    availableActions: getAvailableActionsForAdmin(),
    giftToActionMap: getGiftToActionMapForAdmin(),
  });
}
