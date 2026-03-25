/** Rust / Steam64 profile id (17 digits). Used to anchor MaxxInvaders spawns near that player. */
const STEAM64_RE = /^\d{17}$/;

export function parseSteam64Anchor(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const t = raw.trim();
  if (!STEAM64_RE.test(t)) return null;
  return t;
}

/**
 * Resolve anchor Steam64 for maxxinvaders webhook: JSON body fields first, then ?anchorSteam=, then env.
 */
export function resolveMaxxInvadersAnchorSteam(
  request: { nextUrl: URL },
  body: unknown,
  envFallback: string | undefined
): string | null {
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
  return parseSteam64Anchor(envFallback ?? null);
}
