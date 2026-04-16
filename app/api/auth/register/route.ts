import { NextRequest, NextResponse } from "next/server";
import { createSessionCookieForUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import {
  createUser,
  findUserByEmail,
  userCount,
  toProfile,
} from "@/lib/users";
import type { UserRole } from "@/lib/permissions";
import { ghlSyncSignupContact, isGhlConfigured } from "@/lib/ghl";
import { ensureApprovedSiteApplicationForFanSignup } from "@/lib/superfan";

// Simple email regex for validation
function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

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
  let body: {
    email?: string;
    password?: string;
    display_name?: string;
    interested_server_owner?: unknown;
    interested_streamer?: unknown;
    interested_fan?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName =
    typeof body.display_name === "string" ? body.display_name.trim() || null : null;
  const interestedServerOwner = body.interested_server_owner === true;
  const interestedStreamer = body.interested_streamer === true;
  const interestedFan = body.interested_fan === true;
  if (!interestedServerOwner && !interestedStreamer && !interestedFan) {
    return NextResponse.json(
      { error: "Choose at least one: Server admin, Streamer, or Fan." },
      { status: 400 }
    );
  }
  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "Invalid email format" },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }
  const existing = await findUserByEmail(email);
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 409 }
    );
  }
  const count = await userCount();
  const initialRole: UserRole = count === 0 ? "super_admin" : "guest";
  const user = await createUser(email, password, initialRole, displayName, {
    serverOwner: interestedServerOwner,
    streamer: interestedStreamer,
    fan: interestedFan,
  });
  if (interestedFan) {
    await ensureApprovedSiteApplicationForFanSignup(user.id).catch((e) =>
      console.error("[auth/register] fan site auto-approve failed:", e)
    );
  }
  await audit(user.id, "register", { email: user.email }).catch(() => {});

  if (isGhlConfigured()) {
    void ghlSyncSignupContact({
      email: user.email,
      displayName: displayName,
      interestedServerOwner: interestedServerOwner,
      interestedStreamer: interestedStreamer,
      interestedFan: interestedFan,
    })
      .then((ghl) => {
        if (!ghl.ok) {
          console.error("[auth/register] GHL signup sync failed:", ghl.error, ghl.status ?? "");
        } else {
          console.info("[auth/register] GHL contact ok", ghl.contactId ?? "");
        }
      })
      .catch((e) => console.error("[auth/register] GHL signup sync threw:", e));
  }

  const cookie = createSessionCookieForUser(user.id, user.email, user.role);
  const res = NextResponse.json({
    ok: true,
    user: toProfile(user),
  });
  res.headers.set("Set-Cookie", cookie);
  return res;
}
