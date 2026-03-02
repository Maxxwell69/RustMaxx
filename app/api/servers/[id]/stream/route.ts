import { NextRequest } from "next/server";
import { subscribe } from "@/lib/rcon-manager";
import { requireSession, getSessionFromRequest } from "@/lib/api-auth";
import { getServerIfAccessible } from "@/lib/server-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function formatSSE(event: string, data: string): string {
  return `event: ${event}\ndata: ${data.replace(/\n/g, "\ndata: ")}\n\n`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireSession(request);
  if (authErr) return authErr;
  const session = getSessionFromRequest(request)!;
  const { id: serverId } = await params;
  const server = await getServerIfAccessible(serverId, session.userId, session.role);
  if (!server) {
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
