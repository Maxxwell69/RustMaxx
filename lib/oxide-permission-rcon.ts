/**
 * Validates inputs for Oxide/uMod permission RCON commands (oxide.grant / oxide.revoke).
 * Keeps command tokens single-token safe (no spaces / injection).
 */

const PERM_MAX = 200;

export function normalizeOxidePermission(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > PERM_MAX) return null;
  if (!/^[a-zA-Z0-9_.]+$/.test(s)) return null;
  return s;
}

export function normalizeSteamIdForOxide(raw: string): string | null {
  const s = raw.trim().replace(/\s/g, "");
  if (!/^\d{5,20}$/.test(s)) return null;
  return s;
}

export function normalizeOxideGroupName(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 80 || /\s/.test(s)) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) return null;
  return s;
}

export type OxidePermSubject = "user" | "group";

export function buildOxidePermissionCommand(
  action: "grant" | "revoke",
  subject: OxidePermSubject,
  subjectId: string,
  permission: string
): string {
  const verb = action === "grant" ? "grant" : "revoke";
  return `oxide.${verb} ${subject} ${subjectId} ${permission}`;
}
