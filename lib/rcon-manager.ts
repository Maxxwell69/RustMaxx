/**
 * Server-side RCON connection manager.
 * Maintains one connection per server id; reconnect with backoff on failure.
 * Never expose RCON password to the browser.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Rcon = require("rcon");

type LogEvent = { type: "console" | "chat"; message: string; createdAt: string };

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

  return new Promise((resolve) => {
    const config = { host, port, password };
    const client: RconClient = new Rcon(host, port, password, {
      tcp: true,
      challenge: false,
    });

    let resolved = false;
    const done = (ok: boolean, error?: string) => {
      if (resolved) return;
      resolved = true;
      if (ok) connectionByServerId.set(serverId, { client, config });
      resolve({ ok, error });
    };

    client.on("auth", () => {
      done(true);
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

    const timeoutMs = 20000; // 20s for slow or distant servers
    client.connect();
    const t = setTimeout(() => {
      if (!resolved) {
        try {
          client.disconnect();
        } catch {
          //
        }
        done(
          false,
          "Connection timeout (20s). Ensure the Rust server has a public IP, RCON port is open, and firewall allows inbound TCP."
        );
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
