import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { handleConnection } from "./connection";

export async function createServer(port: number): Promise<{ close: () => void }> {
  const wss = new WebSocketServer({ port });

  wss.on("connection", (ws: WebSocket) => {
    handleConnection(ws);
  });

  return {
    close: () => wss.close(),
  };
}
