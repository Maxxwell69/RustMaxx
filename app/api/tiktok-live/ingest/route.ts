import { NextRequest, NextResponse } from "next/server";
import {
  insertLiveEvent,
  processEventJob,
  tiktokDirectEnabled,
  verifyIngestSignature,
  type TikTokDirectEventInput,
} from "@/lib/tiktok-live";
import { audit } from "@/lib/audit";

type IngestBody = {
  event?: TikTokDirectEventInput;
  processImmediately?: boolean;
};

/**
 * Worker ingest endpoint (HMAC signed).
 * Header: x-rustmaxx-signature = HMAC_SHA256_HEX(rawBody, TIKTOK_INGEST_SECRET)
 */
export async function POST(request: NextRequest) {
  if (!tiktokDirectEnabled()) {
    return NextResponse.json({ error: "TikTok direct integration disabled" }, { status: 503 });
  }
  const raw = await request.text();
  const sig = request.headers.get("x-rustmaxx-signature");
  if (!verifyIngestSignature(raw, sig)) {
    return NextResponse.json({ error: "Invalid ingest signature" }, { status: 401 });
  }

  let body: IngestBody;
  try {
    body = JSON.parse(raw) as IngestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const event = body.event;
  if (!event) {
    return NextResponse.json({ error: "event is required" }, { status: 400 });
  }
  if (!event.userId || !event.serverId || !event.eventType) {
    return NextResponse.json(
      { error: "event.userId, event.serverId, event.eventType are required" },
      { status: 400 }
    );
  }
  const inserted = await insertLiveEvent(event);
  let processResult: { status: "done" | "failed"; error?: string } | null = null;
  if (body.processImmediately !== false) {
    processResult = await processEventJob(inserted.jobId);
  }
  audit("tiktok_live", "ingest", {
    eventId: inserted.eventId,
    jobId: inserted.jobId,
    eventType: event.eventType,
    serverId: event.serverId,
    userId: event.userId,
    status: processResult?.status ?? "queued",
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    eventId: inserted.eventId,
    jobId: inserted.jobId,
    processResult,
  });
}
