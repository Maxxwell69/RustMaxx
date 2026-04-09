import { NextRequest, NextResponse } from "next/server";
import { requireCanManageAdmins } from "@/lib/api-auth";
import { query } from "@/lib/db";
import { isBaseStreamerAction } from "@/lib/streamer-action-policy";

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
    catalog: rows.filter((r) => isBaseStreamerAction(r.action_key)),
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
  await query(
    `UPDATE streamer_platform_action_catalog SET is_active = $1, updated_at = now() WHERE action_key = $2`,
    [body.isActive, actionKey]
  );
  return NextResponse.json({ ok: true });
}
