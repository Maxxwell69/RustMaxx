import { NextRequest } from "next/server";
import { parseTikfinityWebhookBody } from "@/lib/tikfinity";
import { withCors } from "@/lib/tikfinity-webhook-run";
import { handleTikfinityHookRequest } from "@/lib/tikfinity-hooks-handle";
import { mergePathActionIntoRequest } from "@/lib/tikfinity-hook-url";
import { NextResponse } from "next/server";

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

/**
 * Path-style action (recommended for TikFinity): no query string needed.
 * Example: POST /api/tikfinity/hooks/{opaqueKey}/chaosraid_easy
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ segment: string; wiredAction: string }> }
) {
  const { segment, wiredAction } = await context.params;
  const merged = mergePathActionIntoRequest(request, wiredAction);
  return handleTikfinityHookRequest(merged, segment, {});
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ segment: string; wiredAction: string }> }
) {
  const { segment, wiredAction } = await context.params;
  let body: unknown;
  try {
    const text = await request.text();
    const ct = request.headers.get("content-type");
    body = parseTikfinityWebhookBody(text, ct);
  } catch {
    body = {};
  }
  const merged = mergePathActionIntoRequest(request, wiredAction);
  return handleTikfinityHookRequest(merged, segment, body);
}
