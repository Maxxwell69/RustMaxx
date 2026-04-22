/** Rust / Steam64 profile id (17 digits). Used to anchor MaxxInvaders spawns near that player. */
const STEAM64_RE = /^\d{17}$/;
/** Typical Steam account id64 starts with 7656119… (parse messy URLs / pasted profiles). */
const STEAM64_EMBEDDED_RE = /7656119\d{10}/;

export function parseSteam64Anchor(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const t = raw.trim();
  if (!STEAM64_RE.test(t)) return null;
  return t;
}

/**
 * Strict 17-digit check, then extract Steam64 from strings like profile URLs or `76561198… (copy)`.
 */
export function coerceSteam64Anchor(raw: string | null | undefined): string | null {
  const strict = parseSteam64Anchor(raw);
  if (strict) return strict;
  if (!raw || typeof raw !== "string") return null;
  const m = raw.match(STEAM64_EMBEDDED_RE);
  return m ? m[0] : null;
}

const BODY_ANCHOR_KEYS = [
  "anchorSteam",
  "streamerSteamId",
  "anchorSteamId",
  "steamId",
  "steam_id",
  "patrolAnchor",
] as const;

const BODY_NEST_KEYS = ["data", "payload", "event", "meta", "body", "params", "customData"] as const;

function tryAnchorFromFlatObject(o: Record<string, unknown>): string | null {
  for (const k of BODY_ANCHOR_KEYS) {
    const v = o[k];
    if (typeof v === "string") {
      const p = coerceSteam64Anchor(v);
      if (p) return p;
    }
    // Do not parse JSON numbers — Steam64 exceeds Number.MAX_SAFE_INTEGER.
  }
  return null;
}

function extractAnchorFromWebhookBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const fromRoot = tryAnchorFromFlatObject(root);
  if (fromRoot) return fromRoot;
  for (const wrap of BODY_NEST_KEYS) {
    const inner = root[wrap];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const fromInner = tryAnchorFromFlatObject(inner as Record<string, unknown>);
      if (fromInner) return fromInner;
    }
  }
  return null;
}

export type MaxxInvadersAnchorOptions = {
  /** Per-server default from dashboard (Servers → TikFinity patrol anchor). */
  serverDefault?: string | null;
  /** Streamer's RustMaxx Profile Steam64 when patrol anchor is unset (per-hook webhooks only). */
  streamerProfileSteam64?: string | null;
  envFallback?: string | undefined;
};

/**
 * Resolve anchor Steam64 for maxxinvaders webhook:
 * body → ?anchorSteam= → server patrol anchor → streamer Profile Steam64 → env.
 */
export function resolveMaxxInvadersAnchorSteam(
  request: { nextUrl: URL },
  body: unknown,
  options: MaxxInvadersAnchorOptions | string | undefined
): string | null {
  const opts: MaxxInvadersAnchorOptions =
    typeof options === "string" || options === undefined
      ? { envFallback: typeof options === "string" ? options : undefined }
      : options;

  const fromBody = extractAnchorFromWebhookBody(body);
  if (fromBody) return fromBody;

  const q = request.nextUrl.searchParams.get("anchorSteam")?.trim();
  const fromQuery = coerceSteam64Anchor(q ?? null);
  if (fromQuery) return fromQuery;
  const fromServer = coerceSteam64Anchor(opts.serverDefault ?? null);
  if (fromServer) return fromServer;
  const fromProfile = coerceSteam64Anchor(opts.streamerProfileSteam64 ?? null);
  if (fromProfile) return fromProfile;
  return coerceSteam64Anchor(opts.envFallback ?? null);
}
