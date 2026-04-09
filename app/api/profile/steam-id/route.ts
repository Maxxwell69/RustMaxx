import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById, setUserSteamId } from "@/lib/users";
import { buildAuthMePayload } from "@/lib/auth-me-payload";

/** Save or clear Steam64 on the signed-in user (manual entry; no Steam OAuth). */
export async function POST(request: NextRequest) {
  const session = getSession(request.headers.get("cookie"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { steamId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw =
    typeof body.steamId === "string"
      ? body.steamId
      : body.steamId != null
        ? String(body.steamId)
        : "";

  const result = await setUserSteamId(session.userId, raw);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const user = await findUserById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(await buildAuthMePayload(user));
}
