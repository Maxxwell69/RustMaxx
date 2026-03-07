/**
 * Encryption helpers for sensitive data (e.g. Twitch tokens).
 * Uses AES-256-GCM; key from ENCRYPTION_KEY (32 bytes hex or base64, or we derive from env).
 * Do not hardcode secrets.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 16;
const TAG_LEN = 16;
const SALT_LEN = 16;
const KEY_LEN = 32;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new Error("ENCRYPTION_KEY must be set and at least 32 characters (or 32-byte hex/base64)");
  }
  if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  if (raw.length >= 32) {
    return Buffer.from(raw.slice(0, 32), "utf8");
  }
  throw new Error("ENCRYPTION_KEY must be at least 32 bytes (hex or string)");
}

/**
 * Encrypt plaintext; returns "iv:tag:salt:encrypted" as base64 (salt unused for now; kept for future KDF).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const salt = randomBytes(SALT_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, tag, salt, enc]);
  return combined.toString("base64url");
}

/**
 * Decrypt payload from encrypt().
 */
export function decrypt(payload: string): string {
  const key = getKey();
  const combined = Buffer.from(payload, "base64url");
  if (combined.length < IV_LEN + TAG_LEN + SALT_LEN) {
    throw new Error("Invalid encrypted payload");
  }
  let o = 0;
  const iv = combined.subarray(o, (o += IV_LEN));
  const tag = combined.subarray(o, (o += TAG_LEN));
  const salt = combined.subarray(o, (o += SALT_LEN));
  const enc = combined.subarray(o);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString("utf8") + decipher.final("utf8");
}

/**
 * Safe wrapper: returns null if decryption fails (e.g. wrong key or corrupted).
 */
export function decryptSafe(payload: string | null | undefined): string | null {
  if (payload == null || payload === "") return null;
  try {
    return decrypt(payload);
  } catch {
    return null;
  }
}
