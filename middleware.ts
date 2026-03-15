import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionCookieEdge } from "@/lib/auth-edge";

// Routes and APIs that do not require login (public marketing, server list, early-access)
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/me",
  "/",
  "/features",
  "/pricing",
  "/docs",
  "/about",
  "/contact",
  "/server-list",       // public list of opted-in Rust servers
  "/api/server-list",
  "/streamer-interaction",
  "/early-access",
  "/api/early-access",
  "/api/twitch/webhook",   // Twitch EventSub verification and notifications (no session)
  "/api/tikfinity/webhook", // TikFinity Trigger WebHook (no session)
  "/sitemap.xml",
  "/robots.txt",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// Static assets in public/ must load for everyone (e.g. logo for logged-out visitors)
const STATIC_EXT = /\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?|css|js)$/i;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (STATIC_EXT.test(pathname)) {
    return NextResponse.next();
  }
  if (isPublic(pathname)) {
    return NextResponse.next();
  }
  const cookie = request.headers.get("cookie");
  const valid = await verifySessionCookieEdge(cookie);
  if (!valid) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("from", pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
