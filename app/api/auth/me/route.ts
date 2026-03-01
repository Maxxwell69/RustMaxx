import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById, toProfile } from "@/lib/users";

export async function GET(request: NextRequest) {
  const cookie = request.headers.get("cookie");
  const session = getSession(cookie);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const user = await findUserById(session.userId);
  if (!user) {
    return NextResponse.json(
      { error: "User no longer exists" },
      { status: 401 }
    );
  }
  return NextResponse.json(toProfile(user));
}
