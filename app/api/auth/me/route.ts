import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById, toProfile } from "@/lib/users";
import { fetchSteamPlayerSummary } from "@/lib/steam-web-api";

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
    const base = toProfile(user);

    let steam: {
      steamId: string;
      personaName: string | null;
      profileUrl: string;
      avatarUrl: string | null;
      linkedAt: string | null;
    } | null = null;
    if (user.steam_id) {
      const summary = await fetchSteamPlayerSummary(user.steam_id);
      const fallbackProfile = `https://steamcommunity.com/profiles/${user.steam_id}`;
      steam = {
        steamId: user.steam_id,
        personaName: summary?.personaName ?? null,
        profileUrl: summary?.profileUrl ?? fallbackProfile,
        avatarUrl: summary?.avatarUrl ? summary.avatarUrl : null,
        linkedAt: user.steam_linked_at?.toISOString() ?? null,
      };
    }

    return NextResponse.json({ ...base, steam });
  } catch (e) {
    console.error("[auth/me] findUserById failed:", e);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
