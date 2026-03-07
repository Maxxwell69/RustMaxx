/**
 * Process Twitch chat messages for the !rust command: send message to linked game server.
 * Only the broadcaster can use the command; rate limited per channel.
 * Accepts "!rust " or "irust " (common typo when ! is typed as I).
 */

import { getTwitchAccountByTwitchUserId } from "@/lib/twitch-db";
import { findUserById } from "@/lib/users";
import { getStreamerLinkedServerIds } from "@/lib/twitch-db";
import { dispatchBroadcast } from "@/lib/action-dispatch";
import type { UserRole } from "@/lib/permissions";

const CHAT_PREFIXES = ["!rust ", "irust "];
const RATE_LIMIT_MS = 10_000; // 10 seconds between broadcasts per broadcaster
const lastBroadcastByBroadcaster = new Map<string, number>();

function getMessageText(event: Record<string, unknown>): string {
  if (typeof event.text === "string") return event.text;
  const msg = event.message;
  if (typeof msg === "string") return msg;
  if (!msg || typeof msg !== "object") return "";
  const m = msg as Record<string, unknown>;
  if (typeof m.text === "string") return m.text;
  const fragments = (m.fragments ?? event.fragments) as Array<{ type?: string; text?: string; content?: string }> | undefined;
  if (Array.isArray(fragments)) {
    return fragments
      .map((f) => (typeof f.text === "string" ? f.text : typeof f.content === "string" ? f.content : ""))
      .join("");
  }
  return "";
}

/**
 * Handle channel.chat.message EventSub event. If the message is from the broadcaster
 * and starts with "!rust ", send the rest to the linked server's in-game chat.
 */
export async function processChatMessage(
  event: Record<string, unknown>
): Promise<{ handled: boolean; broadcast: boolean; error?: string }> {
  const broadcasterUserId = typeof event.broadcaster_user_id === "string" ? event.broadcaster_user_id : "";
  const chatterUserId = typeof event.chatter_user_id === "string" ? event.chatter_user_id : "";
  const rawText = getMessageText(event).trim();

  console.log("[twitch chat] received", {
    broadcaster_user_id: broadcasterUserId || "(missing)",
    chatter_user_id: chatterUserId || "(missing)",
    message_preview: rawText.slice(0, 80) || "(empty)",
  });

  if (!broadcasterUserId || !chatterUserId) {
    return { handled: false, broadcast: false };
  }

  // Only broadcaster can use the command (streamer sends to their own game)
  if (chatterUserId !== broadcasterUserId) {
    return { handled: false, broadcast: false };
  }

  const lower = rawText.toLowerCase();
  const matchedPrefix = CHAT_PREFIXES.find((p) => lower.startsWith(p));
  if (!matchedPrefix) {
    return { handled: false, broadcast: false };
  }

  const messageText = rawText.slice(matchedPrefix.length).trim();
  if (!messageText) {
    return { handled: true, broadcast: false, error: "Message is empty after command." };
  }

  const now = Date.now();
  const last = lastBroadcastByBroadcaster.get(broadcasterUserId) ?? 0;
  if (now - last < RATE_LIMIT_MS) {
    return { handled: true, broadcast: false, error: "Rate limited. Wait a few seconds." };
  }

  const account = await getTwitchAccountByTwitchUserId(broadcasterUserId);
  const rustmaxxUserId = account?.user_id ?? null;
  if (!rustmaxxUserId) {
    return { handled: true, broadcast: false, error: "Twitch not linked to RustMaxx." };
  }

  const linkedServerIds = await getStreamerLinkedServerIds(rustmaxxUserId);
  if (linkedServerIds.length === 0) {
    return { handled: true, broadcast: false, error: "No server linked. Link one on Profile." };
  }

  const user = await findUserById(rustmaxxUserId);
  const role = (user?.role ?? "guest") as UserRole;
  const serverId = linkedServerIds[0];

  const result = await dispatchBroadcast(serverId, rustmaxxUserId, role, messageText);
  if (!result.ok) {
    return { handled: true, broadcast: false, error: result.error ?? "Broadcast failed." };
  }

  lastBroadcastByBroadcaster.set(broadcasterUserId, now);
  return { handled: true, broadcast: true };
}
