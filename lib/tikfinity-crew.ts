import type { NextRequest } from "next/server";
import { getRawActionNameFromPayload } from "@/lib/tikfinity";

/**
 * Stable TikTok viewer id for deduping crew registrations (not display name).
 * TikFinity payloads vary; we check common flat and nested keys.
 */
/** TikFinity sometimes sends literal 0 when no viewer id — must not reuse as stable id (shared cooldown / duplicate bots). */
function normalizeTikTokUniqueIdString(raw: string): string | null {
  const t = raw.trim();
  if (!t || t === "0") return null;
  return t;
}

export function extractTikTokUniqueIdFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const directKeys = [
    "uniqueId",
    "unique_id",
    "userId",
    "user_id",
    "openId",
    "open_id",
    "tiktokUserId",
    "tiktok_user_id",
  ];
  for (const k of directKeys) {
    const v = o[k];
    if (typeof v === "string") {
      const norm = normalizeTikTokUniqueIdString(v);
      if (norm) return norm;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      const n = Math.trunc(v);
      if (n !== 0) return String(n);
    }
  }
  const nestedKeys = ["user", "viewer", "sender", "author", "data", "event", "payload"];
  for (const nk of nestedKeys) {
    const inner = o[nk];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const found = extractTikTokUniqueIdFromBody(inner);
      if (found) return found;
    }
  }
  return null;
}

const JOIN_EVENT_NAMES = new Set([
  "join",
  "viewerjoin",
  "viewer_join",
  "enter",
  "streamjoin",
  "viewer_enter",
]);

/** True if this request is a “viewer joined the LIVE” style event (query or body). */
export function isStreamJoinEvent(request: NextRequest, body: unknown): boolean {
  const qEvent = request.nextUrl.searchParams.get("event")?.trim().toLowerCase();
  if (qEvent && JOIN_EVENT_NAMES.has(qEvent)) return true;

  const raw = getRawActionNameFromPayload(body).toLowerCase();
  if (raw && JOIN_EVENT_NAMES.has(raw)) return true;

  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  const typeStr =
    (typeof o.type === "string" && o.type.toLowerCase()) ||
    (typeof o.eventType === "string" && o.eventType.toLowerCase()) ||
    (typeof o.event === "string" && o.event.toLowerCase()) ||
    "";
  if (typeStr && JOIN_EVENT_NAMES.has(typeStr)) return true;
  return false;
}

function checkCrewFlags(obj: Record<string, unknown>): boolean {
  const flags: unknown[] = [
    obj.isSubscriber,
    obj.is_subscriber,
    obj.subscriber,
    obj.teamMember,
    obj.team_member,
    obj.isTeamMember,
    obj.is_team_member,
    obj.crew,
    obj.isCrew,
    obj.is_crew,
    obj.fanClubMember,
    obj.fan_club_member,
    obj.isFanClubMember,
  ];
  for (const f of flags) {
    if (f === true) return true;
    if (typeof f === "string" && ["true", "1", "yes"].includes(f.toLowerCase())) return true;
    if (typeof f === "number" && f === 1) return true;
  }
  return false;
}

/**
 * Best-effort: TikFinity / TikTok payloads differ. Treat as crew/subscriber when flags are present.
 * If no crew flags are found, returns false (strict — user must configure TikFinity to send them).
 */
export function isCrewSubscriberFromBody(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  if (checkCrewFlags(o)) return true;
  const nestedKeys = ["user", "viewer", "sender", "author", "data", "event", "payload"];
  for (const nk of nestedKeys) {
    const inner = o[nk];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      if (checkCrewFlags(inner as Record<string, unknown>)) return true;
    }
  }
  return false;
}
