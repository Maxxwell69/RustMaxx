import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { buildAuthMePayload } from "@/lib/auth-me-payload";

export async function GET(request: NextRequest) {
  const cookie = request.headers.get("cookie");
  const session = getSession(cookie);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  try {
    const user = await findUserById(session.userId);
    if (!user) {
      return NextResponse.json(
        { error: "User no longer exists" },
        { status: 401 }
      );
    }
    return NextResponse.json(await buildAuthMePayload(user));
  } catch (e) {
    console.error("[auth/me] findUserById failed:", e);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
