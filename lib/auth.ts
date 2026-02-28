import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "rustmaxx_session";
const SESSION_MAX_AGE = 12 * 60 * 60; // 12 hours in seconds

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

export function createSessionCookie(): string {
  const payload = JSON.stringify({
    auth: "admin",
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  });
  const signature = sign(payload);
  const value = Buffer.from(payload, "utf-8").toString("base64url") + "." + signature;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function verifySessionCookie(cookieHeader: string | null): boolean {
  const secret = getSecret();
  if (!secret) return false;
  if (!cookieHeader) return false;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  const raw = match?.[1];
  if (!raw) return false;
  const [b64, sig] = raw.split(".");
  if (!b64 || !sig) return false;
  let payload: string;
  try {
    payload = Buffer.from(b64, "base64url").toString("utf-8");
  } catch {
    return false;
  }
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  const expectedSig = hmac.digest("hex");
  if (expectedSig.length !== sig.length || !timingSafeEqual(Buffer.from(expectedSig, "utf-8"), Buffer.from(sig, "utf-8"))) {
    return false;
  }
  let data: { exp?: number; auth?: string };
  try {
    data = JSON.parse(payload);
  } catch {
    return false;
  }
  if (data.exp == null || Math.floor(Date.now() / 1000) > data.exp) return false;
  return data.auth === "admin";
}

export function getLogoutCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function checkAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return password.length === expected.length && timingSafeEqual(Buffer.from(password, "utf-8"), Buffer.from(expected, "utf-8"));
}
