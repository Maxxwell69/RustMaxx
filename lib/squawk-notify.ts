/**
 * Optional outbound TTS bridge: after TikFinity webhooks succeed, POST JSON to a URL you control
 * (e.g. ngrok → tiny local server that appends to Squawk’s watched .txt, or Streamer.bot HTTP trigger).
 *
 * Env:
 *   SQUAWK_WEBHOOK_URL   — HTTPS URL to POST to (omit to disable)
 *   SQUAWK_WEBHOOK_SECRET — optional Bearer token for your receiver
 */

const SQUAWK_URL = process.env.SQUAWK_WEBHOOK_URL?.trim() ?? "";
const SQUAWK_SECRET = process.env.SQUAWK_WEBHOOK_SECRET?.trim() ?? "";

const MAX_TEXT = 500;

export type SquawkEventKind = "rustchaos" | "npcmaxx" | "maxxinvaders" | "crew_join";

export function isSquawkOutboundConfigured(): boolean {
  return SQUAWK_URL.length > 0;
}

export function buildSquawkTtsLine(params: {
  kind: SquawkEventKind;
  action: string;
  viewerName: string;
  giftName: string;
}): string {
  const v = params.viewerName.replace(/\s+/g, " ").trim() || "Someone";
  const g = params.giftName.replace(/\s+/g, " ").trim();
  switch (params.kind) {
    case "crew_join":
      return `${v} joined the crew.`;
    case "npcmaxx":
      return `${v} spawned a roaming viewer bot.`;
    case "maxxinvaders":
      return `${v} dropped in as a viewer bot.`;
    default: {
      const act = params.action.replace(/_/g, " ");
      if (g && g.toLowerCase() !== act.toLowerCase()) {
        return `${v} triggered ${act}, gift ${g}.`;
      }
      return `${v} triggered ${act}.`;
    }
  }
}

export type SquawkPayload = {
  source: "rustmaxx";
  event: "tikfinity";
  kind: SquawkEventKind;
  action: string;
  viewerName: string;
  giftName: string;
  /** Single line optimized for text-to-speech */
  text: string;
  sentAt: string;
};

async function postSquawk(body: SquawkPayload): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "RustMaxx-Squawk/1",
  };
  if (SQUAWK_SECRET) headers.Authorization = `Bearer ${SQUAWK_SECRET}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(SQUAWK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errTxt = await res.text().catch(() => "");
      console.warn("[squawk] outbound HTTP", res.status, errTxt.slice(0, 200));
    }
  } catch (e) {
    console.warn("[squawk] outbound failed:", e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fire-and-forget after a successful TikFinity → RCON path. Safe to call always; no-ops if URL unset.
 */
export function fireSquawkAfterTikfinityEvent(params: {
  kind: SquawkEventKind;
  action: string;
  viewerName: string;
  giftName: string;
  /** Override spoken line (e.g. admin connection custom copy later) */
  textOverride?: string;
}): void {
  if (!SQUAWK_URL) return;
  const text = (params.textOverride ?? buildSquawkTtsLine(params)).slice(0, MAX_TEXT);
  const body: SquawkPayload = {
    source: "rustmaxx",
    event: "tikfinity",
    kind: params.kind,
    action: params.action,
    viewerName: params.viewerName,
    giftName: params.giftName,
    text,
    sentAt: new Date().toISOString(),
  };
  void postSquawk(body);
}
