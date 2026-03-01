import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import type { UserRole } from "./permissions";
import { canManageServers, canManageServerUsers, canManageAdmins } from "./permissions";

export function getSessionFromRequest(request: NextRequest) {
  const cookie = request.headers.get("cookie");
  return getSession(cookie);
}

/**
 * Returns 401 JSON if not logged in, or 403 JSON if role is insufficient.
 * Otherwise returns null (caller should proceed).
 */
export function requireSession(request: NextRequest): NextResponse | null {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Require one of the given roles. Returns 401 if no session, 403 if wrong role.
 */
export function requireRole(
  request: NextRequest,
  allowedRoles: UserRole[]
): NextResponse | null {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!allowedRoles.includes(session.role)) {
    return NextResponse.json(
      { error: "Forbidden: insufficient permission" },
      { status: 403 }
    );
  }
  return null;
}

export function requireCanManageServers(request: NextRequest): NextResponse | null {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageServers(session.role)) {
    return NextResponse.json(
      { error: "Forbidden: only admin or super_admin can manage servers" },
      { status: 403 }
    );
  }
  return null;
}

export function requireCanManageServerUsers(
  request: NextRequest
): NextResponse | null {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageServerUsers(session.role)) {
    return NextResponse.json(
      { error: "Forbidden: moderator or above required to manage server users" },
      { status: 403 }
    );
  }
  return null;
}

export function requireCanManageAdmins(request: NextRequest): NextResponse | null {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageAdmins(session.role)) {
    return NextResponse.json(
      { error: "Forbidden: only super_admin can manage admins" },
      { status: 403 }
    );
  }
  return null;
}
