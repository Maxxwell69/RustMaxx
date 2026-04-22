import { NextRequest, NextResponse } from "next/server";
import { parseTikfinityWebhookBody } from "@/lib/tikfinity";
import { withCors } from "@/lib/tikfinity-webhook-run";
import { handleTikfinityHookRequest } from "@/lib/tikfinity-hooks-handle";

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ segment: string }> }
) {
  const { segment } = await context.params;
  return handleTikfinityHookRequest(request, segment, {});
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ segment: string }> }
) {
  const { segment } = await context.params;
  let body: unknown;
  try {
    const text = await request.text();
    const ct = request.headers.get("content-type");
    body = parseTikfinityWebhookBody(text, ct);
  } catch {
    body = {};
  }
  return handleTikfinityHookRequest(request, segment, body);
}
