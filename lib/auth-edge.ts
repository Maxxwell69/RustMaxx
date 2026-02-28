/**
 * Edge-compatible session verification (Web Crypto only).
 * Used by middleware; do not import Node "crypto" here.
 */

const COOKIE_NAME = "rustmaxx_session";

function getSecret(): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) return null;
  return secret;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a[i]! ^ b[i]!;
  return out === 0;
}

function hexToBytes(hex: string): Uint8Array {
  const len = hex.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  return atob(padded);
}

export async function verifySessionCookieEdge(cookieHeader: string | null): Promise<boolean> {
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
    const binary = base64UrlDecode(b64);
    payload = decodeURIComponent(escape(binary));
  } catch {
    return false;
  }
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuf = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(payload)
    );
    const expectedHex = bytesToHex(new Uint8Array(sigBuf));
    if (expectedHex.length !== sig.length) return false;
    const expectedBytes = hexToBytes(expectedHex);
    const sigBytes = hexToBytes(sig);
    if (expectedBytes.length !== sigBytes.length) return false;
    if (!timingSafeEqual(expectedBytes, sigBytes)) return false;
  } catch {
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
