import { NextResponse } from "next/server";
import { getLogoutCookie } from "@/lib/auth";

export async function POST() {
  const cookie = getLogoutCookie();
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", cookie);
  return res;
}
