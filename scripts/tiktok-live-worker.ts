import "dotenv/config";
import crypto from "crypto";
import { Pool } from "pg";

type ConnectionRow = {
  id: string;
  user_id: string;
  server_id: string;
  platform_username: string;
  platform_user_id: string | null;
};

const INGEST_URL = process.env.TIKTOK_INGEST_URL?.trim() || "http://localhost:3000/api/tiktok-live/ingest";
const INGEST_SECRET = process.env.TIKTOK_INGEST_SECRET?.trim() || "";
const POLL_MS = Number(process.env.TIKTOK_WORKER_POLL_MS ?? "30000");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for tiktok-live-worker.");
  process.exit(1);
}
if (!INGEST_SECRET) {
  console.error("TIKTOK_INGEST_SECRET is required for tiktok-live-worker.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const activeClients = new Map<string, unknown>();
let processRef: { stop?: () => Promise<void>; destroy?: () => Promise<void> } | null = null;

function signPayload(raw: string): string {
  return crypto.createHmac("sha256", INGEST_SECRET).update(raw, "utf8").digest("hex");
}

async function postEvent(connection: ConnectionRow, eventType: string, payload: Record<string, unknown>) {
  const dedupeSource = `${connection.id}:${eventType}:${JSON.stringify(payload)}`;
  const dedupeKey = crypto.createHash("sha1").update(dedupeSource).digest("hex");
  const body = {
    event: {
      dedupeKey,
      connectionId: connection.id,
      userId: connection.user_id,
      serverId: connection.server_id,
      eventType,
      eventName:
        typeof payload.event === "string"
          ? payload.event
          : typeof payload.eventName === "string"
            ? payload.eventName
            : null,
      viewerName:
        typeof payload.nickname === "string"
          ? payload.nickname
          : typeof payload.uniqueId === "string"
            ? payload.uniqueId
            : null,
      viewerUniqueId: typeof payload.uniqueId === "string" ? payload.uniqueId : null,
      giftName: typeof payload.giftName === "string" ? payload.giftName : null,
      value:
        typeof payload.diamondCount === "number"
          ? payload.diamondCount
          : typeof payload.likeCount === "number"
            ? payload.likeCount
            : 0,
      payload,
      receivedAt: new Date().toISOString(),
    },
    processImmediately: true,
  };
  const raw = JSON.stringify(body);
  const sig = signPayload(raw);
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-rustmaxx-signature": sig,
    },
    body: raw,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`ingest HTTP ${res.status}: ${txt}`);
  }
}

function normalizePayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  return raw as Record<string, unknown>;
}

async function loadActiveConnections(): Promise<ConnectionRow[]> {
  const { rows } = await pool.query<ConnectionRow>(
    `SELECT id::text, user_id::text, server_id::text, platform_username, platform_user_id
     FROM tiktok_live_connections
     WHERE status = 'active'
     ORDER BY created_at ASC`
  );
  return rows;
}

async function attachClient(connection: ConnectionRow) {
  if (activeClients.has(connection.id)) return;
  if (!processRef) {
    const mod = await import("tiktok-live-connector").catch(() => null);
    if (!mod) {
      throw new Error(
        "Package 'tiktok-live-connector' not installed. Run: npm install tiktok-live-connector"
      );
    }
    const TikTokLiveConnection = (mod as Record<string, unknown>).WebcastPushConnection as
      | (new (username: string, opts?: Record<string, unknown>) => any)
      | undefined;
    if (!TikTokLiveConnection) {
      throw new Error("Could not load WebcastPushConnection from tiktok-live-connector");
    }
    processRef = {
      async stop() {
        const arr = [...activeClients.values()] as Array<{ disconnect?: () => Promise<void> }>;
        for (const c of arr) {
          await c.disconnect?.().catch(() => {});
        }
      },
    };
    // stash constructor on processRef object to avoid re-import with ts strict/no-any noise
    (processRef as unknown as { ctor: typeof TikTokLiveConnection }).ctor = TikTokLiveConnection;
  }

  const Ctor = (processRef as unknown as { ctor: new (...args: any[]) => any }).ctor;
  const client = new Ctor(connection.platform_username, {
    enableExtendedGiftInfo: true,
    processInitialData: true,
  });

  client.on("gift", (data: unknown) => {
    postEvent(connection, "gift", normalizePayload(data)).catch((e) =>
      console.error("[tiktok-worker] gift ingest failed:", e)
    );
  });
  client.on("like", (data: unknown) => {
    postEvent(connection, "like", normalizePayload(data)).catch((e) =>
      console.error("[tiktok-worker] like ingest failed:", e)
    );
  });
  client.on("follow", (data: unknown) => {
    postEvent(connection, "follow", normalizePayload(data)).catch((e) =>
      console.error("[tiktok-worker] follow ingest failed:", e)
    );
  });
  client.on("share", (data: unknown) => {
    postEvent(connection, "share", normalizePayload(data)).catch((e) =>
      console.error("[tiktok-worker] share ingest failed:", e)
    );
  });
  client.on("subscribe", (data: unknown) => {
    postEvent(connection, "subscribe", normalizePayload(data)).catch((e) =>
      console.error("[tiktok-worker] subscribe ingest failed:", e)
    );
  });
  client.on("chat", (data: unknown) => {
    postEvent(connection, "chat", normalizePayload(data)).catch((e) =>
      console.error("[tiktok-worker] chat ingest failed:", e)
    );
  });
  client.on("member", (data: unknown) => {
    postEvent(connection, "join", normalizePayload(data)).catch((e) =>
      console.error("[tiktok-worker] join ingest failed:", e)
    );
  });

  await client.connect();
  activeClients.set(connection.id, client);
  console.log(`[tiktok-worker] connected @${connection.platform_username}`);
}

async function detachMissingConnections(activeRows: ConnectionRow[]) {
  const keep = new Set(activeRows.map((r) => r.id));
  for (const [id, client] of activeClients.entries()) {
    if (keep.has(id)) continue;
    const c = client as { disconnect?: () => Promise<void> };
    await c.disconnect?.().catch(() => {});
    activeClients.delete(id);
  }
}

async function tick() {
  const rows = await loadActiveConnections();
  await detachMissingConnections(rows);
  for (const r of rows) {
    try {
      await attachClient(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[tiktok-worker] failed for @${r.platform_username}:`, msg);
      await pool.query(
        `UPDATE tiktok_live_connections
         SET status = 'error', last_error = $2, updated_at = now()
         WHERE id = $1::uuid`,
        [r.id, msg]
      );
    }
  }
}

async function main() {
  console.log("[tiktok-worker] starting...");
  await tick();
  const timer = setInterval(() => {
    tick().catch((e) => console.error("[tiktok-worker] poll tick failed:", e));
  }, Math.max(5000, POLL_MS));
  const shutdown = async () => {
    clearInterval(timer);
    try {
      await processRef?.stop?.();
    } catch {
      //
    }
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(async (e) => {
  console.error("[tiktok-worker] fatal:", e);
  await pool.end().catch(() => {});
  process.exit(1);
});
