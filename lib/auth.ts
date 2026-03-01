import { createHmac, timingSafeEqual } from "crypto";
import type { UserRole } from "./permissions";

const COOKIE_NAME = "rustmaxx_session";
const SESSION_MAX_AGE = 12 * 60 * 60; // 12 hours in seconds

export type SessionPayload = {
  userId: string;
  email: string;
  role: UserRole;
  exp: number;
};

function getSecret(): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) return null;
  return secret;
}

function sign(value: string): string {
  const secret = getSecret();
  if (!secret) throw new Error("SESSION_SECRET must be at least 16 characters");
  const hmac = createHmac("sha256", secret);
  hmac.update(value);
  return hmac.digest("hex");
}

export function createSessionCookieForUser(
  userId: string,
  email: string,
  role: UserRole
): string {
  const payload = JSON.stringify({
    userId,
    email,
    role,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  });
  const signature = sign(payload);
  const value =
    Buffer.from(payload, "utf-8").toString("base64url") + "." + signature;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

function parsePayload(cookieHeader: string | null): SessionPayload | null {
  const secret = getSecret();
  if (!secret || !cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  const raw = match?.[1];
  if (!raw) return null;
  const [b64, sig] = raw.split(".");
  if (!b64 || !sig) return null;
  let payload: string;
  try {
    payload = Buffer.from(b64, "base64url").toString("utf-8");
  } catch {
    return null;
  }
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  const expectedSig = hmac.digest("hex");
  if (
    expectedSig.length !== sig.length ||
    !timingSafeEqual(Buffer.from(expectedSig, "utf-8"), Buffer.from(sig, "utf-8"))
  ) {
    return null;
  }
  let data: { userId?: string; email?: string; role?: string; exp?: number };
  try {
    data = JSON.parse(payload);
  } catch {
    return null;
  }
  if (
    data.exp == null ||
    Math.floor(Date.now() / 1000) > data.exp ||
    typeof data.userId !== "string" ||
    typeof data.email !== "string" ||
    typeof data.role !== "string"
  ) {
    return null;
  }
  const role = data.role as UserRole;
  const validRoles = [
    "super_admin",
    "admin",
    "moderator",
    "support",
    "streamer",
    "player",
    "guest",
  ];
  if (!validRoles.includes(role)) return null;
  return {
    userId: data.userId,
    email: data.email,
    role,
    exp: data.exp,
  };
}

export function verifySessionCookie(cookieHeader: string | null): boolean {
  return parsePayload(cookieHeader) !== null;
}

export function getSession(cookieHeader: string | null): SessionPayload | null {
  return parsePayload(cookieHeader);
}

export function getLogoutCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
