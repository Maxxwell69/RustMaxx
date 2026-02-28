import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { subscribe } from "@/lib/rcon-manager";
import type { ServerRow } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function formatSSE(event: string, data: string): string {
  return `event: ${event}\ndata: ${data.replace(/\n/g, "\ndata: ")}\n\n`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: serverId } = await params;
  const { rows } = await query<ServerRow>("SELECT id FROM servers WHERE id = $1", [serverId]);
  if (!rows[0]) {
    return new Response("Not found", { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));

      send(formatSSE("open", JSON.stringify({ serverId })));

      const unsubscribe = subscribe(serverId, (ev) => {
        send(formatSSE("log", JSON.stringify(ev)));
      });

      request.signal.addEventListener("abort", () => {
        unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-cache",
      Connection: "keep-alive",
    },
  });
}
