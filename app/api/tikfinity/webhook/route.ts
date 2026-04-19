import { NextRequest, NextResponse } from "next/server";
import { getConnectionByEventName } from "@/lib/tikfinity-connections";
import { parseTikfinityWebhookBody } from "@/lib/tikfinity";
import { runTikfinityWebhook, withCors } from "@/lib/tikfinity-webhook-run";

const TIKFINITY_SERVER_ID = process.env.TIKFINITY_SERVER_ID?.trim() ?? null;

function jsonUnhandledError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[tikfinity webhook] Unhandled:", message);
  return withCors(
    NextResponse.json(
      {
        ok: false,
        error: message,
        debug:
          "Unexpected server error while handling the webhook. Check deployment logs (DB, env, code). RCON/game failures usually return step rcon_connect / rcon_reply / rcon_wait instead.",
        step: "unhandled",
      },
      { status: 500 }
    )
  );
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

/** GET: same as POST but with empty body (action from ?action= e.g. ?action=scientist). */
export async function GET(request: NextRequest) {
  if (!TIKFINITY_SERVER_ID) {
    return withCors(
      NextResponse.json(
        {
          ok: false,
          error: "TikFinity integration not configured",
          debug: "Set TIKFINITY_SERVER_ID in .env to your Rust server's UUID (from the dashboard).",
          step: "TIKFINITY_SERVER_ID",
        },
        { status: 503 }
      )
    );
  }
  try {
    return await runTikfinityWebhook(request, {}, {
      serverId: TIKFINITY_SERVER_ID,
      resolveConnectionByEventName: getConnectionByEventName,
    });
  } catch (err) {
    return jsonUnhandledError(err);
  }
}

export async function POST(request: NextRequest) {
  if (!TIKFINITY_SERVER_ID) {
    return withCors(
      NextResponse.json(
        {
          ok: false,
          error: "TikFinity integration not configured",
          debug: "Set TIKFINITY_SERVER_ID in .env to your Rust server's UUID (from the dashboard).",
          step: "TIKFINITY_SERVER_ID",
        },
        { status: 503 }
      )
    );
  }
  let body: unknown;
  try {
    const text = await request.text();
    const ct = request.headers.get("content-type");
    body = parseTikfinityWebhookBody(text, ct);
  } catch {
    body = {};
  }
  try {
    return await runTikfinityWebhook(request, body, {
      serverId: TIKFINITY_SERVER_ID,
      resolveConnectionByEventName: getConnectionByEventName,
    });
  } catch (err) {
    return jsonUnhandledError(err);
  }
}
