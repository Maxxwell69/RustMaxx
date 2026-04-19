/** Rust / Steam64 profile id (17 digits). Used to anchor MaxxInvaders spawns near that player. */
const STEAM64_RE = /^\d{17}$/;

export function parseSteam64Anchor(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const t = raw.trim();
  if (!STEAM64_RE.test(t)) return null;
  return t;
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

  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    for (const k of ["anchorSteam", "streamerSteamId", "anchorSteamId"] as const) {
      const v = o[k];
      if (typeof v === "string") {
        const p = parseSteam64Anchor(v);
        if (p) return p;
      }
      if (typeof v === "number" && Number.isFinite(v)) {
        const p = parseSteam64Anchor(String(Math.trunc(v)));
        if (p) return p;
      }
    }
  }
  const q = request.nextUrl.searchParams.get("anchorSteam")?.trim();
  const fromQuery = parseSteam64Anchor(q ?? null);
  if (fromQuery) return fromQuery;
  const fromServer = parseSteam64Anchor(opts.serverDefault ?? null);
  if (fromServer) return fromServer;
  const fromProfile = parseSteam64Anchor(opts.streamerProfileSteam64 ?? null);
  if (fromProfile) return fromProfile;
  return parseSteam64Anchor(opts.envFallback ?? null);
}
