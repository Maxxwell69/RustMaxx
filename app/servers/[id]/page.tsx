"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LogoUpload } from "../logo-upload";

type LogEntry = { id: string; type: string; message: string; created_at: string };
type Player = { id: string; name: string };

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
  const [server, setServer] = useState<{
    name: string;
    listed?: boolean;
    listing_name?: string | null;
    listing_description?: string | null;
    game_host?: string | null;
    game_port?: number | null;
    location?: string | null;
    logo_url?: string | null;
  } | null>(null);
  const [listingForm, setListingForm] = useState({
    listed: false,
    listing_name: "",
    listing_description: "",
    game_host: "",
    game_port: "",
    location: "",
    logo_url: "",
  });
  const [listingSaving, setListingSaving] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [sending, setSending] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
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
      .then((s) => {
        setServer(s);
        if (s) {
          setListingForm({
            listed: Boolean(s.listed),
            listing_name: s.listing_name ?? "",
            listing_description: s.listing_description ?? "",
            game_host: s.game_host ?? "",
            game_port: s.game_port != null ? String(s.game_port) : "",
            location: s.location ?? "",
            logo_url: s.logo_url ?? "",
          });
        }
      })
      .catch(() => setServer(null));
  }, [id]);
  useEffect(() => {
    fetch(`/api/servers/${id}/logs?limit=200`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setLogs(Array.isArray(data) ? data : []))
      .catch(() => setLogs([]));
  }, [id]);

  // Restore "connected" for this server from session and verify with a ping
  useEffect(() => {
    const key = `rcon_${id}`;
    const wasConnected = typeof window !== "undefined" && sessionStorage.getItem(key) === "1";
    if (!wasConnected) return;

    fetch(`/api/servers/${id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "status" }),
    })
      .then((r) => {
        if (r.ok) {
          setConnected(true);
          setConnectError(null);
        } else {
          sessionStorage.removeItem(key);
        }
      })
      .catch(() => sessionStorage.removeItem(key));
  }, [id]);

  // When connected (from Connect or restore), open SSE for live logs if not already
  useEffect(() => {
    if (!connected || !id || eventSourceRef.current) return;
    const es = new EventSource(`/api/servers/${id}/stream`);
    eventSourceRef.current = es;
    es.addEventListener("log", (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data) as { type: string; message: string; createdAt: string };
        setLogs((prev) => [...prev, { id: "", type: ev.type, message: ev.message, created_at: ev.createdAt }]);
      } catch {
        //
      }
    });
    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      setConnected(false);
      try {
        sessionStorage.removeItem(`rcon_${id}`);
      } catch {
        //
      }
    };
    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [connected, id]);

  // Keepalive: while connected, ping every 45s so connection stays up
  useEffect(() => {
    if (!connected || !id) return;
    const key = `rcon_${id}`;
    sessionStorage.setItem(key, "1");

    const t = setInterval(() => {
      fetch(`/api/servers/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "status" }),
      }).then((r) => {
        if (!r.ok) {
          setConnected(false);
          setConnectError("Connection lost");
          sessionStorage.removeItem(key);
          eventSourceRef.current?.close();
          eventSourceRef.current = null;
        }
      });
    }, 45000);
    return () => clearInterval(t);
  }, [connected, id]);

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
        if (data.ok) {
          refreshPlayers(true);
        }
        // SSE is opened by the useEffect when connected becomes true
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

  async function refreshPlayers(force: boolean = false) {
    if (!connected && !force) return;
    setPlayersLoading(true);
    try {
      const r = await fetch(`/api/servers/${id}/playerlist`);
      const data = await r.json().catch(() => ({}));
      setPlayers(Array.isArray(data.players) ? data.players : []);
    } catch {
      setPlayers([]);
    } finally {
      setPlayersLoading(false);
    }
  }

  async function saveListing() {
    setListingSaving(true);
    try {
      const res = await fetch(`/api/servers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listed: listingForm.listed,
          listing_name: listingForm.listing_name.trim() || null,
          listing_description: listingForm.listing_description.trim() || null,
          game_host: listingForm.game_host.trim() || null,
          game_port: listingForm.game_port ? parseInt(listingForm.game_port, 10) || null : null,
          location: listingForm.location.trim() || null,
          logo_url: listingForm.logo_url.trim() || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setServer((prev) => (prev ? { ...prev, ...data } : null));
      }
    } finally {
      setListingSaving(false);
    }
  }

  async function sendCommand(cmd: string) {
    const c = (cmd || command).trim();
    if (!c) return;
    setSending(true);
    try {
      const res = await fetch(`/api/servers/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: c }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.response) {
          setLogs((prev) => [...prev, { id: "", type: "console", message: String(data.response).trim(), created_at: new Date().toISOString() }]);
        }
      } else {
        setLogs((prev) => [...prev, { id: "", type: "console", message: `[Error] ${data.error ?? "Failed"}`, created_at: new Date().toISOString() }]);
        setConnected(false);
        try {
          sessionStorage.removeItem(`rcon_${id}`);
        } catch {
          //
        }
      }
      if (c === command) setCommand("");
    } finally {
      setSending(false);
    }
  }

  if (!server) {
    return (
      <div className="space-y-4">
        <Link href="/servers" className="text-rust-cyan hover:underline">← Servers</Link>
        <p className="text-zinc-500">Server not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/servers" className="text-rust-cyan hover:underline">← Servers</Link>
        <h1 className="text-xl font-semibold text-zinc-100">{server.name}</h1>
        <nav className="flex gap-2">
          <Link href={`/servers/${id}/environment`} className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-rust-cyan hover:bg-zinc-600 hover:shadow-rust-glow-subtle">Environment</Link>
          <Link href={`/servers/${id}/events`} className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-rust-cyan hover:bg-zinc-600 hover:shadow-rust-glow-subtle">Events</Link>
        </nav>
        <button
          type="button"
          onClick={connect}
          disabled={connecting || connected}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${connected ? "bg-emerald-600/80 text-white shadow-rust-glow-subtle" : "bg-zinc-700 text-rust-cyan hover:bg-zinc-600 hover:shadow-rust-glow-subtle"} disabled:opacity-70`}
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
        Uses <strong>WebRCON</strong> (WebSocket). If you get timeout on Railway, run RustMaxx locally (<code>npm run dev</code>) so the connection comes from your PC.
      </p>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="border-b border-zinc-800 px-3 py-2 text-sm font-medium text-zinc-300 flex items-center justify-between">
          <span>Players</span>
          <button
            type="button"
            onClick={() => refreshPlayers()}
            disabled={!connected || playersLoading}
            className="rounded px-2 py-1 text-xs bg-zinc-700 text-rust-cyan hover:bg-zinc-600 hover:shadow-rust-glow-subtle disabled:opacity-50"
          >
            {playersLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
        <div className="max-h-32 overflow-y-auto p-2">
          {players.length === 0 && !playersLoading ? (
            <p className="text-sm text-zinc-500">Connect and click Refresh to load players.</p>
          ) : (
            <ul className="space-y-1">
              {players.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/servers/${id}/players/${encodeURIComponent(p.id)}?name=${encodeURIComponent(p.name)}`}
                    className="text-sm text-rust-cyan hover:underline"
                  >
                    {p.name}
                  </Link>
                  <span className="text-zinc-500 text-xs ml-2">{p.id}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="border-b border-zinc-800 px-3 py-2 text-sm font-medium text-zinc-300 flex items-center justify-between">
          <span>Public server list</span>
        </div>
        <div className="p-4 space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={listingForm.listed}
              onChange={(e) => setListingForm((f) => ({ ...f, listed: e.target.checked }))}
              className="rounded border-zinc-600 bg-zinc-800 text-rust-cyan focus:ring-rust-cyan"
            />
            <span className="text-sm text-zinc-300">Show on public server list</span>
          </label>
          <p className="text-xs text-zinc-500">
            When enabled, this server appears on the public <a href="/server-list" target="_blank" rel="noopener noreferrer" className="text-rust-cyan hover:underline">/server-list</a> page so players can find and connect to it.
          </p>
          {listingForm.listed && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Listing name (optional)</label>
                <input
                  type="text"
                  value={listingForm.listing_name}
                  onChange={(e) => setListingForm((f) => ({ ...f, listing_name: e.target.value }))}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
                  placeholder={server?.name ?? "Display name"}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Listing description (optional)</label>
                <input
                  type="text"
                  value={listingForm.listing_description}
                  onChange={(e) => setListingForm((f) => ({ ...f, listing_description: e.target.value }))}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
                  placeholder="Short description"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Game host (for Connect)</label>
                <input
                  type="text"
                  value={listingForm.game_host}
                  onChange={(e) => setListingForm((f) => ({ ...f, game_host: e.target.value }))}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
                  placeholder="IP or hostname"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Game port (join port)</label>
                <input
                  type="number"
                  value={listingForm.game_port}
                  onChange={(e) => setListingForm((f) => ({ ...f, game_port: e.target.value }))}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
                  placeholder="28015"
                  min={1}
                  max={65535}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Location</label>
                <input
                  type="text"
                  value={listingForm.location}
                  onChange={(e) => setListingForm((f) => ({ ...f, location: e.target.value }))}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
                  placeholder="e.g. Quebec"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Logo</label>
                <LogoUpload
                  value={listingForm.logo_url}
                  onChange={(url) => setListingForm((f) => ({ ...f, logo_url: url }))}
                  disabled={listingSaving}
                  className="mt-1"
                />
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={saveListing}
            disabled={listingSaving}
            className="rounded bg-rust-cyan px-3 py-1.5 text-sm font-medium text-rust-panel shadow-rust-glow hover:shadow-rust-glow-lg disabled:opacity-50"
          >
            {listingSaving ? "Saving…" : "Save listing"}
          </button>
        </div>
      </div>

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
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-rust-cyan hover:bg-zinc-700 hover:shadow-rust-glow-subtle disabled:opacity-50"
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
          className="rounded-lg bg-rust-cyan px-4 py-2 text-sm font-medium text-rust-panel shadow-rust-glow hover:shadow-rust-glow-lg disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
