import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerWithRole, canManageServerAccess } from "@/lib/server-access";
import { findUserByEmail } from "@/lib/users";
import { audit } from "@/lib/audit";

/** List users with access to this server (owner + server_users). Only for owner or server admin. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;
  const result = await getServerWithRole(serverId, session.userId, session.role);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canManageServerAccess(result.serverRole)) return NextResponse.json({ error: "Only owner or server admin can list users" }, { status: 403 });

  const ownerId = result.server.owner_id;
  const { rows: ownerRows } = await query<{ id: string; email: string }>(
    "SELECT id, email FROM users WHERE id = $1",
    [ownerId]
  );
  const owner = ownerRows[0];
  const list: { user_id: string; email: string; role: "owner" | "admin" | "moderator" }[] = [];
  if (owner) list.push({ user_id: owner.id, email: owner.email, role: "owner" });

  const { rows: suRows } = await query<{ user_id: string; role: string }>(
    "SELECT user_id, role FROM server_users WHERE server_id = $1",
    [serverId]
  );
  for (const su of suRows) {
    if (su.role !== "admin" && su.role !== "moderator") continue;
    const { rows: u } = await query<{ email: string }>("SELECT email FROM users WHERE id = $1", [su.user_id]);
    list.push({ user_id: su.user_id, email: u[0]?.email ?? "?", role: su.role as "admin" | "moderator" });
  }
  return NextResponse.json(list);
}

/** Add a user to this server as admin or moderator. Only owner or server admin. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;
  const result = await getServerWithRole(serverId, session.userId, session.role);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canManageServerAccess(result.serverRole)) return NextResponse.json({ error: "Only owner or server admin can add users" }, { status: 403 });

  let body: { email?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const role = body.role === "moderator" ? "moderator" : "admin";
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  const user = await findUserByEmail(email);
  if (!user) return NextResponse.json({ error: "No user found with that email" }, { status: 404 });
  if (user.id === result.server.owner_id) return NextResponse.json({ error: "Owner is already on the server" }, { status: 400 });

  try {
    await query(
      "INSERT INTO server_users (server_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (server_id, user_id) DO UPDATE SET role = $3",
      [serverId, user.id, role]
    );
    await audit(session.userId, "server.add_user", { serverId, userId: user.id, role });
    return NextResponse.json({ ok: true, user_id: user.id, email: user.email, role });
  } catch (e) {
    return NextResponse.json({ error: "Failed to add user" }, { status: 500 });
  }
}

/** Remove a user from this server. Only owner or server admin. Cannot remove owner. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;
  const result = await getServerWithRole(serverId, session.userId, session.role);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canManageServerAccess(result.serverRole)) return NextResponse.json({ error: "Only owner or server admin can remove users" }, { status: 403 });

  const userId = request.nextUrl.searchParams.get("user_id");
  if (!userId) return NextResponse.json({ error: "user_id query is required" }, { status: 400 });
  if (userId === result.server.owner_id) return NextResponse.json({ error: "Cannot remove owner" }, { status: 400 });

  await query("DELETE FROM server_users WHERE server_id = $1 AND user_id = $2", [serverId, userId]);
  await audit(session.userId, "server.remove_user", { serverId, userId });
  return NextResponse.json({ ok: true });
}
