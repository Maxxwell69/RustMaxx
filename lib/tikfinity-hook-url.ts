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
  return new NextRequest(u, request);
}
