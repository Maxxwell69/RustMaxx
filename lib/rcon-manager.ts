/**
 * Server-side RCON connection manager.
 * Maintains one connection per server id; reconnect with backoff on failure.
 * Never expose RCON password to the browser.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Rcon = require("rcon");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const net = require("net");

type LogEvent = { type: "console" | "chat"; message: string; createdAt: string };

/** Quick TCP check: can we reach host:port? Returns error message or null if OK. */
function tcpReachable(host: string, port: number, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.destroy();
      resolve(null);
    });
    socket.on("error", (err: Error) => {
      const msg = (err as NodeJS.ErrnoException).code ?? err.message;
      resolve(`TCP connection failed: ${msg}`);
    });
    const t = setTimeout(() => {
      socket.destroy();
      resolve("TCP connection timeout (no response from server)");
    }, timeoutMs);
    socket.on("connect", () => clearTimeout(t));
  });
}

type Listener = (event: LogEvent) => void;

interface RconClient {
  connect: () => void;
  send: (data: string) => void;
  disconnect: () => void;
  on: (ev: string, fn: (...args: unknown[]) => void) => void;
  once: (ev: string, fn: (...args: unknown[]) => void) => void;
  _tcpSocket?: { writable?: boolean };
}

const streamsByServerId = new Map<string, Set<Listener>>();
const connectionByServerId = new Map<
  string,
  { client: RconClient; config: { host: string; port: number; password: string } }
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
    const s = existing.client._tcpSocket;
    if (s?.writable) return { ok: true };
    connectionByServerId.delete(serverId);
    try {
      existing.client.disconnect();
    } catch {
      //
    }
  }

  const tcpError = await tcpReachable(host, port, 8000);
  if (tcpError) {
    return { ok: false, error: tcpError };
  }

  return new Promise((resolve) => {
    const config = { host, port, password };
    const client: RconClient = new Rcon(host, port, password, {
      tcp: true,
      challenge: false,
    });

    let resolved = false;
    let tcpConnected = false;
    const done = (ok: boolean, error?: string) => {
      if (resolved) return;
      resolved = true;
      if (ok) connectionByServerId.set(serverId, { client, config });
      resolve({ ok, error });
    };

    client.on("auth", () => {
      done(true);
    });

    client.on("connect", () => {
      tcpConnected = true;
    });

    client.on("response", (...args: unknown[]) => {
      const msg = String((args[0] as string) ?? "").trim();
      if (!msg) return;
      const event: LogEvent = { type: "console", message: msg, createdAt: new Date().toISOString() };
      emit(serverId, event);
      onLog(serverId, "console", msg).catch(() => {});
    });

    client.on("server", (...args: unknown[]) => {
      const msg = String((args[0] as string) ?? "").trim();
      if (!msg) return;
      const event: LogEvent = { type: "chat", message: msg, createdAt: new Date().toISOString() };
      emit(serverId, event);
      onLog(serverId, "chat", msg).catch(() => {});
    });

    client.on("error", (...args: unknown[]) => {
      const err = args[0] as Error | undefined;
      const msg = (err?.message ?? String(err)).trim();
      if (msg) {
        const event: LogEvent = { type: "console", message: `[RCON error] ${msg}`, createdAt: new Date().toISOString() };
        emit(serverId, event);
        onLog(serverId, "console", event.message).catch(() => {});
      }
      if (!resolved) done(false, msg);
    });

    client.on("end", () => {
      connectionByServerId.delete(serverId);
    });

    const timeoutMs = 15000;
    client.connect();
    const t = setTimeout(() => {
      if (!resolved) {
        try {
          client.disconnect();
        } catch {
          //
        }
        const isLocal = process.env.NODE_ENV !== "production";
        const detail = tcpConnected
          ? "TCP connected but RCON auth had no response. Wrong password, or host may use WebRCON (browser-only) on this port."
          : isLocal
            ? "RCON timeout. Check host, port (e.g. 21717), and password; ensure the server is running."
            : "Host likely allows your PC's IP but not Railway's. Run RustMaxx locally (npm run dev).";
        done(false, `Connection timeout (15s). ${detail}`);
      }
    }, timeoutMs);
    client.once("auth", () => clearTimeout(t));
    client.once("error", () => clearTimeout(t));
  });
}

export function sendCommand(serverId: string, command: string): { ok: boolean; error?: string } {
  const conn = connectionByServerId.get(serverId);
  if (!conn) return { ok: false, error: "Not connected" };
  try {
    conn.client.send(command);
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
