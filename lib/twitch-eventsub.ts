/**
 * Twitch EventSub: verify webhook signature, handle verification challenge, parse notification.
 * Backend only; no Twitch secrets in UI.
 */

import { createHmac, timingSafeEqual } from "crypto";

const TWITCH_EVENTSUB_API = "https://api.twitch.tv/helix/eventsub/subscriptions";

export type EventSubMessageType = "webhook_callback_verification" | "notification" | "revocation";

export type EventSubPayload = {
  subscription: {
    id: string;
    type: string;
    version: string;
    status: string;
    condition: Record<string, string>;
    created_at: string;
    transport: { method: string; callback?: string; secret?: string };
  };
  challenge?: string;
  event?: Record<string, unknown>;
};

/**
 * Verify Twitch-Eventsub-Message-Signature using the secret we gave when creating the subscription.
 * Body must be the raw request body (string or Buffer).
 */
export function verifyEventSubSignature(
  messageId: string,
  messageTimestamp: string,
  rawBody: string | Buffer,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = signatureHeader.slice(7);
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const hmacMessage = messageId + messageTimestamp + body;
  const hmac = createHmac("sha256", secret);
  hmac.update(hmacMessage);
  const computed = hmac.digest("hex");
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(computed, "utf8"), Buffer.from(expected, "utf8"));
}

/**
 * Parse and return message type + payload. Does not verify signature (call verifyEventSubSignature first).
 */
export function parseEventSubPayload(body: unknown): { type: EventSubMessageType; payload: EventSubPayload } | null {
  if (typeof body !== "object" || body === null) return null;
  const p = body as Record<string, unknown>;
  const subscription = p.subscription as EventSubPayload["subscription"] | undefined;
  if (!subscription?.type) return null;

  let type: EventSubMessageType = "notification";
  if (typeof p.challenge === "string") type = "webhook_callback_verification";
  else if (p.subscription && (subscription as { status?: string }).status === "revocation") type = "revocation";

  return { type, payload: body as EventSubPayload };
}

/**
 * Create EventSub subscription for channel.follow (version 2).
 * Requires app access token or user access token with channel:read:subscriptions.
 */
export async function createChannelFollowSubscription(
  broadcasterUserId: string,
  callbackUrl: string,
  secret: string,
  accessToken: string
): Promise<{ id: string }> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) throw new Error("TWITCH_CLIENT_ID is not set");

  const res = await fetch(TWITCH_EVENTSUB_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": clientId,
    },
    body: JSON.stringify({
      type: "channel.follow",
      version: "2",
      condition: { broadcaster_user_id: broadcasterUserId },
      transport: { method: "webhook", callback: callbackUrl, secret },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`EventSub create failed: ${res.status} ${t}`);
  }

  const data = (await res.json()) as { data: Array<{ id: string }> };
  const sub = data.data?.[0];
  if (!sub) throw new Error("EventSub create returned no subscription");
  return { id: sub.id };
}

/**
 * Create EventSub subscription for channel.chat.message (version 1).
 * Sends every chat message to the webhook; filter for commands in the handler.
 */
export async function createChannelChatMessageSubscription(
  broadcasterUserId: string,
  callbackUrl: string,
  secret: string,
  accessToken: string
): Promise<{ id: string }> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) throw new Error("TWITCH_CLIENT_ID is not set");

  const res = await fetch(TWITCH_EVENTSUB_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": clientId,
    },
    body: JSON.stringify({
      type: "channel.chat.message",
      version: "1",
      condition: { broadcaster_user_id: broadcasterUserId },
      transport: { method: "webhook", callback: callbackUrl, secret },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`EventSub chat subscribe failed: ${res.status} ${t}`);
  }

  const data = (await res.json()) as { data: Array<{ id: string }> };
  const sub = data.data?.[0];
  if (!sub) throw new Error("EventSub chat create returned no subscription");
  return { id: sub.id };
}
