import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, requireSession } from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { submitStreamerSuperfanRequest } from "@/lib/superfan";

export async function POST(request: NextRequest) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;

  let body: { streamer_id?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const streamerId = typeof body.streamer_id === "string" ? body.streamer_id.trim() : "";
  if (!streamerId) {
    return NextResponse.json({ error: "streamer_id is required" }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message : "";

  const result = await submitStreamerSuperfanRequest(session.userId, streamerId, message);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await audit(session.userId, "viewer.superfan.streamer_request", { streamerId }).catch(() => {});
  return NextResponse.json({ ok: true, membership_id: result.membership_id });
}
