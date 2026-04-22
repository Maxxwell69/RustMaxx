import { NextRequest } from "next/server";

/**
 * TikFinity often POSTs without forwarding `?query` strings. Putting the action in the path fixes chaosraid_* etc.
 * Path-derived action overrides any existing `action` query param when present (explicit URL wins).
 */
export function mergePathActionIntoRequest(
  request: NextRequest,
  actionFromPath: string
): NextRequest {
  const clean = actionFromPath.trim().replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
  if (!clean) return request;
  const u = request.nextUrl.clone();
  u.searchParams.set("action", clean);
  // Never pass `request` as the second arg to `new NextRequest` after the body may have been read
  // (e.g. POST `await request.text()` in the route) — that locks the stream and throws on Railway.
  // TikFinity handlers use the parsed `body` argument only, not `request.json()` / `request.text()`.
  return new NextRequest(u.toString(), {
    method: request.method,
    headers: new Headers(request.headers),
  });
}
