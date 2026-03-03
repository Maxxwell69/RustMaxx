import { NextRequest, NextResponse } from "next/server";
import { requireCanManageAdmins } from "@/lib/api-auth";
import { getAdminStats } from "@/lib/admin-stats";

/** Aggregate stats for super_admin dashboard (super_admin only). */
export async function GET(request: NextRequest) {
  const authErr = await requireCanManageAdmins(request);
  if (authErr) return authErr;
  const stats = await getAdminStats();
  return NextResponse.json(stats);
}
