import { NextResponse } from "next/server";
import { isGhlConfigured } from "@/lib/ghl";
import {
  ghlSyncSupportIntake,
  type GhlSupportIntakePayload,
  type SupportAudience,
  type SupportPriority,
} from "@/lib/ghl-support";

export const runtime = "nodejs";

const AUDIENCES: SupportAudience[] = ["server-admin", "streamer", "viewer"];
const PRIORITIES: SupportPriority[] = ["low", "normal", "high"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseSupportPayload(body: unknown): { ok: true; payload: GhlSupportIntakePayload } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "Invalid JSON body" };

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Valid email is required" };
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 200) {
    return { ok: false, error: "Name is required (max 200 characters)" };
  }

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  if (!subject || subject.length > 300) {
    return { ok: false, error: "Subject is required (max 300 characters)" };
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 20_000) {
    return { ok: false, error: "Message is required (max 20000 characters)" };
  }

  const audience = body.audience as string | undefined;
  if (!audience || !AUDIENCES.includes(audience as SupportAudience)) {
    return { ok: false, error: "audience must be server-admin, streamer, or viewer" };
  }

  let priority: SupportPriority = "normal";
  if (body.priority !== undefined && body.priority !== null) {
    const p = String(body.priority);
    if (!PRIORITIES.includes(p as SupportPriority)) {
      return { ok: false, error: "priority must be low, normal, or high" };
    }
    priority = p as SupportPriority;
  }

  const serverId =
    typeof body.serverId === "string" && body.serverId.trim()
      ? body.serverId.trim().slice(0, 120)
      : null;
  const streamerId =
    typeof body.streamerId === "string" && body.streamerId.trim()
      ? body.streamerId.trim().slice(0, 120)
      : null;

  const payload: GhlSupportIntakePayload = {
    audience: audience as SupportAudience,
    channel: "web",
    email,
    name,
    subject,
    message,
    serverId,
    streamerId,
    priority,
    source: "contact-form",
  };

  return { ok: true, payload };
}

function classifyGhlFailure(error: string, status?: number): { code: string; status: number } {
  if (status === 401 || status === 403) return { code: "ghl_auth", status: 502 };
  if (status === 429) return { code: "ghl_rate_limit", status: 503 };
  if (status === 400 || status === 422) return { code: "ghl_validation", status: 502 };
  const lower = error.toLowerCase();
  if (lower.includes("abort") || lower.includes("timeout")) return { code: "ghl_timeout", status: 504 };
  return { code: "ghl_error", status: 502 };
}

/**
 * Public support form intake. Syncs to GoHighLevel when configured; otherwise returns success with a warning for UX.
 */
export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseSupportPayload(json);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const { payload } = parsed;

  if (!isGhlConfigured()) {
    console.warn("[contact] GHL not configured — support intake accepted but not synced to CRM");
    return NextResponse.json({
      ok: true,
      synced: false,
      warning: "CRM sync is not configured; your message was not sent to our ticketing system. Please email us using the addresses on this page.",
    });
  }

  const result = await ghlSyncSupportIntake(payload);

  if (result.ok) {
    console.log("[contact] GHL support intake ok", { audience: payload.audience, contactId: result.contactId });
    return NextResponse.json({ ok: true, synced: true, contactId: result.contactId });
  }

  const { code, status } = classifyGhlFailure(result.error, result.status);
  console.warn("[contact] GHL support intake failed", {
    code,
    ghlStatus: result.status,
    message: result.error.slice(0, 500),
    audience: payload.audience,
  });

  return NextResponse.json(
    {
      ok: false,
      error: "We could not submit your message to support right now. Please try again or use the email addresses below.",
      code,
    },
    { status }
  );
}
