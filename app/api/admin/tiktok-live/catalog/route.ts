import { NextRequest, NextResponse } from "next/server";
import { requireCanManageServersFromDb } from "@/lib/api-auth";
import { getAvailableActionsForAdmin, getGiftToActionMapForAdmin } from "@/lib/tikfinity";

/** Admin catalog for direct TikTok board builder (gift/event + Rust action dropdowns). */
export async function GET(request: NextRequest) {
  const err = await requireCanManageServersFromDb(request);
  if (err) return err;

  const actions = getAvailableActionsForAdmin().map((a) => ({
    action: a.action,
    label: a.label,
    description: a.description,
  }));

  const giftMap = getGiftToActionMapForAdmin();
  const gifts = Object.keys(giftMap)
    .sort((x, y) => x.localeCompare(y))
    .map((gift) => ({
      gift,
      suggestedAction: giftMap[gift],
    }));

  return NextResponse.json({
    eventTypes: ["gift", "like", "follow", "share", "subscribe", "chat", "join"],
    gifts,
    actions,
  });
}
