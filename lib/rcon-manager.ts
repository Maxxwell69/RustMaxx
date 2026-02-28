/**
 * Server-side RCON connection manager.
 * Uses WebRCON (WebSocket) only for Rust servers.
 * Never expose RCON password to the browser.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebRcon = require("webrconjs");

type LogEvent = { type: "console" | "chat"; message: string; createdAt: string };

type Listener = (event: LogEvent) => void;

interface WebRconInstance {
  connect: (password: string) => void;
  run: (command: string, id?: number) => void;
  disconnect: () => boolean;
  on: (ev: string, fn: (...args: unknown[]) => void) => void;
  once: (ev: string, fn: (...args: unknown[]) => void) => void;
  socket?: { readyState?: number };
}

const streamsByServerId = new Map<string, Set<Listener>>();
const connectionByServerId = new Map<
  string,
  { client: WebRconInstance; config: { host: string; port: number; password: string } }
>();

function emit(serverId: string, event: LogEvent) {
  const set = streamsByServerId.get(serverId);
  if (set) Array.from(set).forEach((fn) => fn(event));
}

export function subscribe(serverId: string, listener: Listener): () => void {
  let set = streamsByServerId.get(serverId);
  if (!set) {
    set = new Set();
    streamsByServerId.set(serverId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) streamsByServerId.delete(serverId);
  };
}

export async function ensureConnection(
  serverId: string,
  host: string,
  port: number,
  password: string,
  onLog: (serverId: string, type: "console" | "chat", message: string) => Promise<void>
): Promise<{ ok: boolean; error?: string }> {
  const existing = connectionByServerId.get(serverId);
  if (existing) {
    if (existing.client.socket?.readyState === 1) return { ok: true };
    connectionByServerId.delete(serverId);
    try {
      existing.client.disconnect();
    } catch {
      //
    }
  }

  return new Promise((resolve) => {
    const config = { host, port, password };
    const client: WebRconInstance = new WebRcon(host, port);

    let resolved = false;
    const done = (ok: boolean, error?: string) => {
      if (resolved) return;
      resolved = true;
      if (ok) connectionByServerId.set(serverId, { client, config });
      resolve({ ok, error });
    };

    const timeout = setTimeout(() => {
      if (!resolved) {
        try {
          client.disconnect();
        } catch {
          //
        }
        done(false, "WebRCON connection timeout (15s). Check host, port, and password.");
      }
    }, 15000);

    client.once("connect", () => {
      clearTimeout(timeout);
      done(true);
    });
    client.on("message", (...args: unknown[]) => {
      const msg = args[0] as { message?: string } | undefined;
      const text = String(msg?.message ?? "").trim();
      if (!text) return;
      const event: LogEvent = { type: "console", message: text, createdAt: new Date().toISOString() };
      emit(serverId, event);
      onLog(serverId, "console", text).catch(() => {});
    });
    client.once("error", (...args: unknown[]) => {
      clearTimeout(timeout);
      const err = args[0] as Error | undefined;
      done(false, err?.message ?? String(err));
    });
    client.on("disconnect", () => {
      connectionByServerId.delete(serverId);
    });

    client.connect(password);
  });
}

export function sendCommand(serverId: string, command: string): { ok: boolean; error?: string } {
  const conn = connectionByServerId.get(serverId);
  if (!conn) return { ok: false, error: "Not connected" };
  try {
    conn.client.run(command, 0);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export function disconnect(serverId: string): void {
  const conn = connectionByServerId.get(serverId);
  if (conn) {
    try {
      conn.client.disconnect();
    } catch {
      //
    }
    connectionByServerId.delete(serverId);
  }
}
