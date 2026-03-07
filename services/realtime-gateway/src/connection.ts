import type { WebSocket } from "ws";
import { verifyAuth } from "./auth";
import { handleHeartbeat } from "./heartbeat";
import { handleCommandDispatch } from "./commands";
import {
  isPluginAuthMessage,
  isPluginHeartbeatMessage,
  isCommandAckMessage,
} from "@rustmaxx/shared";

type ConnectionState = "anonymous" | "authenticated";

type ConnectionContext = {
  state: ConnectionState;
  serverId?: string;
  authenticatedAt?: number;
};

export function handleConnection(ws: WebSocket): void {
  const ctx: ConnectionContext = { state: "anonymous" };

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString()) as unknown;

      if (isPluginAuthMessage(data)) {
        const ok = verifyAuth(data);
        if (ok) {
          ctx.state = "authenticated";
          ctx.serverId = data.serverId;
          ctx.authenticatedAt = Date.now();
          ws.send(
            JSON.stringify({ type: "auth_ok", serverId: data.serverId, at: Date.now() })
          );
        } else {
          ws.send(
            JSON.stringify({
              type: "auth_fail",
              message: "Invalid token",
              at: Date.now(),
            })
          );
        }
        return;
      }

      if (ctx.state !== "authenticated") {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Not authenticated",
            at: Date.now(),
          })
        );
        return;
      }

      if (isPluginHeartbeatMessage(data)) {
        handleHeartbeat(ctx.serverId!, data);
        return;
      }

      if (isCommandAckMessage(data)) {
        handleCommandDispatch.ack(data);
        return;
      }

      ws.send(
        JSON.stringify({
          type: "error",
          message: "Unknown message type",
          at: Date.now(),
        })
      );
    } catch {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Invalid JSON",
          at: Date.now(),
        })
      );
    }
  });
}
