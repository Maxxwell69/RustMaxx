import { NextRequest, NextResponse } from "next/server";
import { requireCanManageAdmins } from "@/lib/api-auth";
import { query } from "@/lib/db";
import { STREAMER_BASE_ACTION_KEYS } from "@/lib/streamer-action-policy";
import { labelForStreamerCatalogKey } from "@/lib/streamer-platform-catalog-admin";

/**
 * Super admin: insert any streamer-base actions missing from `streamer_platform_action_catalog`
 * (labels from ACTION_META). Existing rows are left unchanged (including is_active).
 */
export async function POST(req: NextRequest) {
  const err = await requireCanManageAdmins(req);
  if (err) return err;

  let fillEmptyLabels = false;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body === "object" && body.fillEmptyLabels === true) {
      fillEmptyLabels = true;
    }
  } catch {
    /* optional body */
  }

  let inserted = 0;
  for (const key of STREAMER_BASE_ACTION_KEYS) {
    const label = labelForStreamerCatalogKey(key);
    const { rowCount } = await query(
      `INSERT INTO streamer_platform_action_catalog (action_key, is_active, label, updated_at)
       VALUES ($1, true, $2, now())
       ON CONFLICT (action_key) DO NOTHING`,
      [key, label]
    );
    if (rowCount && rowCount > 0) inserted += 1;
  }

  let labelsUpdated = 0;
  if (fillEmptyLabels) {
    for (const key of STREAMER_BASE_ACTION_KEYS) {
      const label = labelForStreamerCatalogKey(key);
      const { rowCount } = await query(
        `UPDATE streamer_platform_action_catalog
         SET label = $2, updated_at = now()
         WHERE action_key = $1
           AND (label IS NULL OR trim(label) = '')`,
        [key, label]
      );
      if (rowCount && rowCount > 0) labelsUpdated += rowCount;
    }
  }

  return NextResponse.json({
    ok: true,
    inserted,
    keysTotal: STREAMER_BASE_ACTION_KEYS.length,
    labelsUpdated: fillEmptyLabels ? labelsUpdated : undefined,
  });
}
