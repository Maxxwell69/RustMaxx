import { NextRequest, NextResponse } from "next/server";
import { createSessionCookie, checkAdminPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(request: NextRequest) {
  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { error: "Server misconfiguration: set ADMIN_PASSWORD in .env" },
      { status: 500 }
    );
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json(
      { error: "Server misconfiguration: set SESSION_SECRET in .env (at least 16 characters)" },
      { status: 500 }
    );
  }
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
  audit("admin", "login", {}).catch(() => {});
  let cookie: string;
  try {
    cookie = createSessionCookie();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create session" },
      { status: 500 }
    );
  }
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", cookie);
  return res;
}
