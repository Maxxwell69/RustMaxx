import { NextRequest, NextResponse } from "next/server";
import { createSessionCookieForUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { verifyCredentials } from "@/lib/users";

export async function POST(request: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json(
      {
        error:
          "Server misconfiguration: set SESSION_SECRET in .env (at least 16 characters)",
      },
      { status: 500 }
    );
  }
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }
  const user = await verifyCredentials(email, password);
  if (!user) {
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  }
  await audit(user.id, "login", { email: user.email }).catch(() => {});
  let cookie: string;
  try {
    cookie = createSessionCookieForUser(user.id, user.email, user.role);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to create session",
      },
      { status: 500 }
    );
  }
  const res = NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      display_name: user.display_name,
    },
  });
  res.headers.set("Set-Cookie", cookie);
  return res;
}
