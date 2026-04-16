import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireCanManageAdmins } from "@/lib/api-auth";
import { listPendingSiteApplicationsForAdmin } from "@/lib/superfan";

export async function GET(request: NextRequest) {
  const authErr = await requireCanManageAdmins(request);
  if (authErr) return authErr;

  const rows = await listPendingSiteApplicationsForAdmin();
  return NextResponse.json({
    applications: rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      email: r.email,
      message: r.message,
      status: r.status,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    })),
  });
}
