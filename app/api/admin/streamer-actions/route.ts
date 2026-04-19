import { NextRequest, NextResponse } from "next/server";
import { requireCanManageAdmins } from "@/lib/api-auth";
import { query } from "@/lib/db";
import {
  isBaseStreamerAction,
  isPlatformMaxxInvadersEnvEnabled,
} from "@/lib/streamer-action-policy";
import {
  labelForStreamerCatalogKey,
  mergeStreamerCatalogWithCodebase,
} from "@/lib/streamer-platform-catalog-admin";

/** Super admin: platform catalog of streamer actions (toggle availability). */
export async function GET(request: NextRequest) {
  const err = await requireCanManageAdmins(request);
  if (err) return err;
  const { rows } = await query<{
    action_key: string;
    is_active: boolean;
    label: string | null;
  }>(
    `SELECT action_key, is_active, label FROM streamer_platform_action_catalog ORDER BY action_key ASC`
  );
  return NextResponse.json({
    catalog: mergeStreamerCatalogWithCodebase(rows),
    platformEnv: {
      /** When false, maxxinvaders is hidden from all streamer flows (set RUSTMAXX_PLATFORM_MAXXINVADERS_ENABLED=false). */
      maxxInvadersEnabled: isPlatformMaxxInvadersEnvEnabled(),
    },
  });
}

export async function PATCH(request: NextRequest) {
  const err = await requireCanManageAdmins(request);
  if (err) return err;
  let body: { actionKey?: string; isActive?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const actionKey = typeof body.actionKey === "string" ? body.actionKey.trim() : "";
  if (!actionKey || !isBaseStreamerAction(actionKey)) {
    return NextResponse.json({ error: "Invalid actionKey" }, { status: 400 });
  }
  if (typeof body.isActive !== "boolean") {
    return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
  }
  const label = labelForStreamerCatalogKey(actionKey);
  await query(
    `INSERT INTO streamer_platform_action_catalog (action_key, is_active, label, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (action_key) DO UPDATE SET
       is_active = EXCLUDED.is_active,
       updated_at = now()`,
    [actionKey, body.isActive, label]
  );
  return NextResponse.json({ ok: true });
}
