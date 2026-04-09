import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { steamOpenIdRedirectUrl } from "@/lib/steam-openid";

function baseUrl(req: NextRequest): string {
  const env = process.env.APP_URL?.trim() ?? process.env.SITE_URL?.trim();
  if (env) {
    try {
      return new URL(env).origin;
    } catch {
      /* fall through */
    }
  }
  return req.nextUrl.origin;
}

/** Start Steam OpenID — user must be logged in first. */
export async function GET(request: NextRequest) {
  const session = getSession(request.headers.get("cookie"));
  if (!session) {
    return NextResponse.redirect(new URL("/login", baseUrl(request)));
  }
  const url = steamOpenIdRedirectUrl();
  if (!url) {
    return NextResponse.json(
      { error: "APP_URL (or SITE_URL) must be set for Steam login" },
      { status: 500 }
    );
  }
  return NextResponse.redirect(url);
}
