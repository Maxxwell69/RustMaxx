import { NextRequest, NextResponse } from "next/server";
import {
  verifyEventSubSignature,
  parseEventSubPayload,
} from "@/lib/twitch-eventsub";
import { normalizeEventSubEvent } from "@/lib/twitch-events-normalize";
import { processNormalizedEvent } from "@/lib/event-rules-processor";

const EVENTSUB_SECRET = process.env.TWITCH_EVENTSUB_SECRET;

export async function POST(request: NextRequest) {
  if (!EVENTSUB_SECRET) {
    return NextResponse.json(
      { error: "TWITCH_EVENTSUB_SECRET not configured" },
      { status: 500 }
    );
  }

  const messageId = request.headers.get("Twitch-Eventsub-Message-Id") ?? "";
  const messageTimestamp = request.headers.get("Twitch-Eventsub-Message-Timestamp") ?? "";
  const signature = request.headers.get("Twitch-Eventsub-Message-Signature");

  const rawBody = await request.text();
  const verified = verifyEventSubSignature(
    messageId,
    messageTimestamp,
    rawBody,
    signature,
    EVENTSUB_SECRET
  );

  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseEventSubPayload(payload);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { type, payload: p } = parsed;

  if (type === "webhook_callback_verification") {
    const challenge = p.challenge;
    if (typeof challenge !== "string") {
      return NextResponse.json({ error: "Missing challenge" }, { status: 400 });
    }
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (type === "revocation") {
    return NextResponse.json({ ok: true });
  }

  if (type === "notification" && p.event) {
    const subscriptionType = p.subscription?.type ?? "";
    const normalized = normalizeEventSubEvent(subscriptionType, p.event as Record<string, unknown>);
    if (normalized) {
      const result = await processNormalizedEvent(normalized, messageId || null);
      return NextResponse.json({
        ok: true,
        logged: result.logged,
        duplicate: result.duplicate,
        dispatched: result.dispatched,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
