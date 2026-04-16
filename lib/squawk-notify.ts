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

/** RustChaos spawns a creature or humanoid NPC near the streamer */
const ANIMAL_AND_SPAWN_ACTIONS: Record<string, string> = {
  wolf: "a wolf",
  bear: "a bear",
  tiger: "a tiger",
  panther: "a panther",
  crocodile: "a crocodile",
  shark: "a shark",
  pig: "a boar",
  scientist: "a scientist",
};

export type SquawkEventKind =
  | "rustchaos"
  | "npcmaxx"
  | "maxxinvaders"
  | "crew_join"
  | "social";

export function isSquawkOutboundConfigured(): boolean {
  return SQUAWK_URL.length > 0;
}

function safeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim() || "Someone";
}

/** Viewer-bot profile lines — invite using nickname (TikFinity %nickname%). */
function lineForViewerBotProfile(action: string, v: string): string {
  const a = action.toLowerCase();
  switch (a) {
    case "bunny1npc":
      return `${v}, your bunny bot is live. Jump in and raid with us!`;
    case "gingynpc":
      return `${v}, gingerbread bot deployed. Get in here and say hi!`;
    case "eggnpc":
      return `${v}, egg suit bot is rolling. Come play!`;
    case "vampnpc":
      return `${v}, vampire style on the field. Join the squad!`;
    case "maxxinvaders":
      return `${v}, you're spawning as a viewer bot. Squad up in game!`;
    default:
      return `${v}, your viewer bot is dropping in. Join the fight!`;
  }
}

function lineForRustchaosAnimalOrEffect(action: string, v: string, giftName: string): string {
  const a = action.toLowerCase();
  const spawnLabel = ANIMAL_AND_SPAWN_ACTIONS[a];
  if (spawnLabel) {
    return `${v} sent ${spawnLabel} into the stream!`;
  }
  if (a === "bunny1") {
    return `${v} suited the streamer up in bunny gear!`;
  }
  if (a === "likes" || a === "supply") {
    return `${v} called in an airdrop!`;
  }
  if (a.startsWith("chaoswave")) {
    return `${v} started a chaos wave! Hold on!`;
  }
  if (a === "chaos" || a === "chaosheli") {
    return `${v} unleashed chaos on stream!`;
  }
  if (a === "scientistboat") {
    return `${v} sent a scientist boat!`;
  }
  if (a === "healinghands" || a === "fullheal" || a === "revivechaos") {
    return `${v} helped the streamer recover!`;
  }
  const g = giftName.replace(/\s+/g, " ").trim();
  const act = a.replace(/_/g, " ");
  if (g && g.toLowerCase() !== act.toLowerCase()) {
    return `${v} triggered ${act} with ${g}!`;
  }
  return `${v} triggered ${act}!`;
}

function lineForSocial(action: string, v: string): string {
  const a = action.toLowerCase();
  switch (a) {
    case "follow":
      return `${v} just followed. Welcome to the stream!`;
    case "share":
      return `${v} shared the live. Thanks for spreading the word!`;
    case "subscribe":
      return `${v} subscribed. Let's go!`;
    case "sociallike":
      return `${v} liked the stream. Love to see it!`;
    default:
      return `${v} showed love on stream!`;
  }
}

export function buildSquawkTtsLine(params: {
  kind: SquawkEventKind;
  action: string;
  viewerName: string;
  giftName: string;
}): string {
  const v = safeName(params.viewerName);
  const g = params.giftName.replace(/\s+/g, " ").trim();
  switch (params.kind) {
    case "social":
      return lineForSocial(params.action, v);
    case "crew_join":
      return `${v} joined the crew. Welcome aboard!`;
    case "npcmaxx":
      return `${v}, your roaming bot is live. Get in here and squad up!`;
    case "maxxinvaders":
      return lineForViewerBotProfile(params.action, v);
    case "rustchaos":
      return lineForRustchaosAnimalOrEffect(params.action, v, g);
    default:
      return lineForRustchaosAnimalOrEffect(params.action, v, g);
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
 * Fire-and-forget after a successful TikFinity path. Safe to call always; no-ops if URL unset.
 */
export function fireSquawkAfterTikfinityEvent(params: {
  kind: SquawkEventKind;
  action: string;
  viewerName: string;
  giftName: string;
  /** Override spoken line */
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
