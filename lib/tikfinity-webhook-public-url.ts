import { canonicalizeRustmaxxOriginForTikfinity } from "@/lib/rustmaxx-public-url";
import { getPublicOriginOrNull } from "@/lib/twitch-public-url";

/** Full TikFinity webhook URL for admin/diagnostics; apex rustmaxx.com → www. */
export function getTikfinityWebhookUrlOrNull(): string | null {
  const raw = getPublicOriginOrNull();
  if (!raw) return null;
  const origin = canonicalizeRustmaxxOriginForTikfinity(raw);
  return `${origin}/api/tikfinity/webhook`;
}
