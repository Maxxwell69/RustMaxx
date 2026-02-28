"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type LogEntry = { id: string; type: string; message: string; created_at: string };

const QUICK_COMMANDS = [
  { label: "status", command: "status" },
  { label: "players", command: "players" },
  { label: "say test", command: "say test" },
  { label: "oxide.plugins", command: "oxide.plugins" },
];

export default function ServerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [server, setServer] = useState<{ name: string } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [sending, setSending] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const scrollToBottom = useCallback(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);
  useEffect(() => {
    fetch(`/api/servers/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setServer)
      .catch(() => setServer(null));
  }, [id]);
  useEffect(() => {
    fetch(`/api/servers/${id}/logs?limit=200`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setLogs(Array.isArray(data) ? data : []))
      .catch(() => setLogs([]));
  }, [id]);

  const connect = useCallback(() => {
    if (connecting || connected) return;
    setConnectError(null);
    setConnecting(true);
    fetch(`/api/servers/${id}/connect`, { method: "POST" })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setConnectError(data.error ?? `Error ${r.status}`);
          setConnected(false);
          return;
        }
        setConnected(!!data.ok);
        setConnectError(data.ok ? null : (data.error ?? "Connection failed"));
        if (data.ok && !eventSourceRef.current) {
          const es = new EventSource(`/api/servers/${id}/stream`);
          eventSourceRef.current = es;
          es.addEventListener("open", () => {});
          es.addEventListener("log", (e) => {
            try {
              const ev = JSON.parse((e as MessageEvent).data) as { type: string; message: string; createdAt: string };
              setLogs((prev) => [...prev, { id: "", type: ev.type, message: ev.message, created_at: ev.createdAt }]);
            } catch {
              //
            }
          });
          es.onerror = () => {
            es.close();
            eventSourceRef.current = null;
            setConnected(false);
          };
        }
      })
      .catch((e) => {
        setConnected(false);
        setConnectError(e?.message ?? "Network error");
      })
      .finally(() => setConnecting(false));
  }, [id, connecting, connected]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, []);

  async function sendCommand(cmd: string) {
    const c = (cmd || command).trim();
    if (!c) return;
    setSending(true);
    try {
      const res = await fetch(`/api/servers/${id}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: c }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLogs((prev) => [...prev, { id: "", type: "console", message: `[Error] ${data.error ?? "Failed"}`, created_at: new Date().toISOString() }]);
      }
      if (c === command) setCommand("");
    } finally {
      setSending(false);
    }
  }

  if (!server) {
    return (
      <div className="space-y-4">
        <Link href="/servers" className="text-amber-500 hover:underline">← Servers</Link>
        <p className="text-zinc-500">Server not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/servers" className="text-amber-500 hover:underline">← Servers</Link>
        <h1 className="text-xl font-semibold text-zinc-100">{server.name}</h1>
        <button
          type="button"
          onClick={connect}
          disabled={connecting || connected}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${connected ? "bg-emerald-600/80 text-white" : "bg-zinc-700 text-zinc-200 hover:bg-zinc-600"} disabled:opacity-70`}
        >
          {connecting ? "Connecting…" : connected ? "Connected" : "Connect"}
        </button>
        {connectError && (
          <p className="text-sm text-red-400" title={connectError}>
            {connectError}
          </p>
        )}
      </div>

      <p className="text-sm text-zinc-500">
        RCON runs from Railway (cloud). If you get <strong>Connection timeout</strong>: many hosts (e.g. Shockbyte) only allow RCON from their own panel, not from external apps. Ask your host if &quot;external RCON&quot; is supported, or run RustMaxx locally (<code>npm run dev</code>) and use the same IP/port to test.
      </p>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="border-b border-zinc-800 px-3 py-2 text-sm text-zinc-400">
          Console & chat (last 200 + live)
        </div>
        <div className="h-[400px] overflow-y-auto p-3 font-mono text-sm">
          {logs.map((log, i) => (
            <div
              key={log.id || `live-${i}`}
              className={`mb-1 ${log.type === "chat" ? "text-amber-200" : "text-zinc-300"}`}
            >
              <span className="text-zinc-500 select-none">
                {new Date(log.created_at).toLocaleTimeString()}
              </span>{" "}
              {log.message}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {QUICK_COMMANDS.map(({ label, command: cmd }) => (
          <button
            key={cmd}
            type="button"
            onClick={() => sendCommand(cmd)}
            disabled={!connected || sending}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendCommand(command);
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Enter RCON command…"
          disabled={!connected || sending}
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-100 placeholder-zinc-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!connected || sending}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
