import { NextRequest, NextResponse } from "next/server";
import {
  verifyEventSubSignature,
  parseEventSubPayload,
} from "@/lib/twitch-eventsub";
import { normalizeEventSubEvent } from "@/lib/twitch-events-normalize";
import { processNormalizedEvent } from "@/lib/event-rules-processor";
import { processChatMessage } from "@/lib/chat-command-processor";

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
  console.log("[twitch webhook] message type:", type, "subscription:", p.subscription?.type);

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
    const ev = p.event as Record<string, unknown>;

    if (subscriptionType === "channel.chat.message") {
      try {
        const result = await processChatMessage(ev);
        console.log("[twitch webhook] chat command", result.handled ? (result.broadcast ? "broadcast sent" : result.error) : "ignored");
        return NextResponse.json({ ok: true, chat: { handled: result.handled, broadcast: result.broadcast } });
      } catch (err) {
        console.error("[twitch webhook] processChatMessage failed", err);
        return NextResponse.json({ ok: false, error: "Chat processing failed" }, { status: 200 });
      }
    }

    const normalized = normalizeEventSubEvent(subscriptionType, ev);
    if (normalized) {
      try {
        const result = await processNormalizedEvent(normalized, messageId || null);
        console.log("[twitch webhook] notification", subscriptionType, "logged:", result.logged, "duplicate:", result.duplicate, "dispatched:", result.dispatched);
        return NextResponse.json({
          ok: true,
          logged: result.logged,
          duplicate: result.duplicate,
          dispatched: result.dispatched,
        });
      } catch (err) {
        console.error("[twitch webhook] processNormalizedEvent failed", err);
        return NextResponse.json({ ok: false, error: "Processing failed" }, { status: 200 });
      }
    }
    console.warn("[twitch webhook] notification type not handled:", subscriptionType);
  }

  return NextResponse.json({ ok: true });
}
