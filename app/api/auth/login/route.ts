import { NextRequest, NextResponse } from "next/server";
import { createSessionCookie, checkAdminPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(request: NextRequest) {
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!checkAdminPassword(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  await audit("admin", "login", {});
  const cookie = createSessionCookie();
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", cookie);
  return res;
}
