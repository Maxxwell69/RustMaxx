import { NextRequest, NextResponse } from "next/server";
import { requireCanManageAdmins, getSessionFromRequest } from "@/lib/api-auth";
import {
  updateUserRole,
  findUserById,
  updateUserMembershipLevel,
  toProfile,
  countUsersWithRole,
  deleteUserById,
} from "@/lib/users";
import { audit } from "@/lib/audit";
import type { UserRole } from "@/lib/permissions";
import { parseMembershipLevel } from "@/lib/membership-level";

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
  const authErr = await requireCanManageAdmins(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: userId } = await params;

  let body: { role?: string; membershipLevel?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const hasRole = body.role !== undefined;
  const hasLevel = body.membershipLevel !== undefined;
  if (!hasRole && !hasLevel) {
    return NextResponse.json(
      { error: "Provide role and/or membershipLevel" },
      { status: 400 }
    );
  }

  const target = await findUserById(userId);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (hasRole) {
    const role = body.role;
    if (typeof role !== "string" || !ALLOWED_ROLES.includes(role as UserRole)) {
      return NextResponse.json(
        { error: "role must be one of: " + ALLOWED_ROLES.join(", ") },
        { status: 400 }
      );
    }
    if (userId === session.userId && role !== "super_admin") {
      return NextResponse.json(
        {
          error:
            "You cannot demote yourself. Have another super_admin change your role.",
        },
        { status: 400 }
      );
    }
    const updated = await updateUserRole(userId, role as UserRole);
    if (!updated) return NextResponse.json({ error: "Update failed" }, { status: 500 });
    await audit(session.userId, "user.role_update", {
      targetUserId: userId,
      newRole: role,
    });
  }

  if (hasLevel) {
    const level = parseMembershipLevel(body.membershipLevel);
    if (!level) {
      return NextResponse.json(
        {
          error: "membershipLevel must be standard, pro, or elite",
        },
        { status: 400 }
      );
    }
    const updated = await updateUserMembershipLevel(userId, level);
    if (!updated) return NextResponse.json({ error: "Update failed" }, { status: 500 });
    await audit(session.userId, "user.membership_update", {
      targetUserId: userId,
      membershipLevel: level,
    });
  }

  const fresh = await findUserById(userId);
  if (!fresh) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json(toProfile(fresh));
}

/** Permanently delete a user (super_admin only). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = await requireCanManageAdmins(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: targetUserId } = await params;

  const target = await findUserById(targetUserId);
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (targetUserId === session.userId) {
    return NextResponse.json(
      { error: "You cannot delete your own account." },
      { status: 400 }
    );
  }

  if (target.role === "super_admin") {
    const n = await countUsersWithRole("super_admin");
    if (n <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the only remaining super_admin." },
        { status: 400 }
      );
    }
  }

  const deleted = await deleteUserById(targetUserId);
  if (!deleted) {
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }

  await audit(session.userId, "user.delete", {
    targetUserId,
    email: target.email,
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
