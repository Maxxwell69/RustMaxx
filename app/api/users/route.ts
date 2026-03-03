import { NextRequest, NextResponse } from "next/server";
import { requireCanManageAdmins, getSessionFromRequest } from "@/lib/api-auth";
import { listUsers } from "@/lib/users";

/** List all users (super_admin only). */
export async function GET(request: NextRequest) {
  const authErr = await requireCanManageAdmins(request);
  if (authErr) return authErr;
  const users = await listUsers();
  return NextResponse.json(users);
}
