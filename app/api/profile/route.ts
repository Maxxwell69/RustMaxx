import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { buildAuthMePayload } from "@/lib/auth-me-payload";
import { findUserById, updateUserDisplayName } from "@/lib/users";

/** Update basic profile fields for the current user (display name only for now). */
export async function PATCH(request: NextRequest) {
  const err = requireSession(request);
  if (err) return err;
  const session = getSessionFromRequest(request)!;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!("display_name" in body)) {
    return NextResponse.json(
      { error: "Send display_name (string to set, empty string or null to clear)." },
      { status: 400 }
    );
  }

  const result = await updateUserDisplayName(session.userId, body.display_name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const user = await findUserById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(await buildAuthMePayload(user));
}
