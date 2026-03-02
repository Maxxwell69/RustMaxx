import { NextRequest, NextResponse } from "next/server";
import { requireCanManageAdmins, getSessionFromRequest } from "@/lib/api-auth";
import { updateUserRole, findUserById } from "@/lib/users";
import { audit } from "@/lib/audit";
import type { UserRole } from "@/lib/permissions";

const ALLOWED_ROLES: UserRole[] = [
  "guest",
  "player",
  "streamer",
  "support",
  "moderator",
  "admin",
  "super_admin",
];

/** Update a user's role (super_admin only). Use this to remove admins by setting role to guest. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireCanManageAdmins(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: userId } = await params;

  let body: { role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const role = body.role;
  if (typeof role !== "string" || !ALLOWED_ROLES.includes(role as UserRole)) {
    return NextResponse.json(
      { error: "role must be one of: " + ALLOWED_ROLES.join(", ") },
      { status: 400 }
    );
  }

  const target = await findUserById(userId);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (userId === session.userId && role !== "super_admin") {
    return NextResponse.json(
      { error: "You cannot demote yourself. Have another super_admin change your role." },
      { status: 400 }
    );
  }

  const updated = await updateUserRole(userId, role as UserRole);
  if (!updated) return NextResponse.json({ error: "Update failed" }, { status: 500 });

  await audit(session.userId, "user.role_update", { targetUserId: userId, newRole: role });
  return NextResponse.json({ id: updated.id, email: updated.email, role: updated.role });
}
