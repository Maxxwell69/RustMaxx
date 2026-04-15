"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ConnectionRow = {
  id: string;
  server_id: string;
  server_name: string;
  platform_username: string;
  status: string;
  last_seen_at: string | null;
  last_error: string | null;
};

type AvailableServer = {
  id: string;
  name: string;
  listing_name: string | null;
  streamer_interactions_enabled: boolean;
};

type EventRow = {
  id: string;
  server_id: string;
  server_name: string;
  event_type: string;
  event_name: string | null;
  viewer_name: string | null;
  gift_name: string | null;
  value: number;
  action_status: string;
  action_error: string | null;
  received_at: string;
};

type Totals = { events: number; value: number; processed: number; failed: number };

export default function StreamerTikTokLivePage() {
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [availableServers, setAvailableServers] = useState<AvailableServer[]>([]);
  const [totals, setTotals] = useState<Totals>({ events: 0, value: 0, processed: 0, failed: 0 });
  const [serverId, setServerId] = useState("");
  const [platformUsername, setPlatformUsername] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const [c, e, a, s] = await Promise.all([
      fetch("/api/tiktok-live/connections", { credentials: "same-origin" }),
      fetch("/api/tiktok-live/events?limit=100", { credentials: "same-origin" }),
      fetch("/api/tiktok-live/analytics?days=30", { credentials: "same-origin" }),
      fetch("/api/streamer/servers", { credentials: "same-origin" }),
    ]);
    if (c.ok) {
      const j = await c.json().catch(() => ({}));
      setConnections(Array.isArray(j.connections) ? j.connections : []);
    }
    if (e.ok) {
      const j = await e.json().catch(() => ({}));
      setEvents(Array.isArray(j.events) ? j.events : []);
    }
    if (a.ok) {
      const j = await a.json().catch(() => ({}));
      if (j.totals) setTotals(j.totals as Totals);
    }
    if (s.ok) {
      const j = await s.json().catch(() => ({}));
      const rows = Array.isArray(j.servers) ? (j.servers as AvailableServer[]) : [];
      const enabled = rows.filter((x) => x.streamer_interactions_enabled);
      enabled.sort((x, y) => (x.listing_name || x.name).localeCompare(y.listing_name || y.name));
      setAvailableServers(enabled);
      if (!serverId && enabled[0]?.id) setServerId(enabled[0].id);
    }
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const byStatus = useMemo(() => {
    const out: Record<string, number> = {};
    for (const ev of events) out[ev.action_status] = (out[ev.action_status] ?? 0) + 1;
    return out;
  }, [events]);

  async function createConnection(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch("/api/tiktok-live/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ serverId, platformUsername }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(typeof data.error === "string" ? data.error : "Could not add connection");
      return;
    }
    setMsg("Connection saved. Start the worker to stream events.");
    setServerId("");
    setPlatformUsername("");
    await load();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/streamer" className="text-rust-cyan hover:underline">
          ← Streamer
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-100">TikTok Live (Direct)</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Events (30d)" value={String(totals.events)} />
        <Stat label="Value (30d)" value={String(totals.value)} />
        <Stat label="Processed" value={String(totals.processed)} />
        <Stat label="Failed" value={String(totals.failed)} />
      </div>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="text-lg text-zinc-100">Connect a TikTok channel</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Choose a server that has streamer interactions enabled and approved for your account, then add your TikTok username.
        </p>
        <form onSubmit={createConnection} className="mt-3 grid gap-3 sm:grid-cols-3">
          <select
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
            required
          >
            {availableServers.length === 0 ? (
              <option value="">No approved servers available</option>
            ) : null}
            {availableServers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.listing_name || s.name}
              </option>
            ))}
          </select>
          <input
            value={platformUsername}
            onChange={(e) => setPlatformUsername(e.target.value)}
            placeholder="TikTok username (without @)"
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
            required
          />
          <button className="rounded bg-rust-cyan px-3 py-1.5 text-sm font-medium text-zinc-950">
            Save connection
          </button>
        </form>
        {availableServers.length === 0 ? (
          <p className="mt-2 text-xs text-amber-200/90">
            No servers are available yet. Ask the server owner to enable Streamer interactions and approve your access.
          </p>
        ) : null}
        {msg ? <p className="mt-2 text-sm text-amber-200">{msg}</p> : null}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="text-lg text-zinc-100">Connections</h2>
        <ul className="mt-2 space-y-2">
          {connections.length === 0 ? (
            <li className="text-sm text-zinc-500">No direct connections yet.</li>
          ) : (
            connections.map((c) => (
              <li key={c.id} className="rounded border border-zinc-800 bg-zinc-950/60 p-2 text-sm text-zinc-300">
                {c.platform_username} → {c.server_name} · {c.status}
                {c.last_seen_at ? ` · seen ${new Date(c.last_seen_at).toLocaleString()}` : ""}
                {c.last_error ? ` · error: ${c.last_error}` : ""}
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="text-lg text-zinc-100">Recent events</h2>
        <p className="text-xs text-zinc-500">
          Status counts: queued {byStatus.queued ?? 0}, processed {byStatus.processed ?? 0}, failed{" "}
          {byStatus.failed ?? 0}, skipped {byStatus.skipped ?? 0}.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400">
                <th className="py-2">Time</th>
                <th>Server</th>
                <th>Type</th>
                <th>Viewer</th>
                <th>Gift/Event</th>
                <th>Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id} className="border-b border-zinc-900 text-zinc-300">
                  <td className="py-2">{new Date(ev.received_at).toLocaleString()}</td>
                  <td>{ev.server_name}</td>
                  <td>{ev.event_type}</td>
                  <td>{ev.viewer_name ?? "Viewer"}</td>
                  <td>{ev.gift_name ?? ev.event_name ?? "(none)"}</td>
                  <td>{ev.value}</td>
                  <td className={ev.action_status === "failed" ? "text-red-300" : "text-zinc-300"}>
                    {ev.action_status}
                    {ev.action_error ? `: ${ev.action_error}` : ""}
                  </td>
                </tr>
              ))}
              {events.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-3 text-zinc-500">
                    No events yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="text-xl font-semibold text-zinc-100">{value}</div>
      <div className="text-sm text-zinc-500">{label}</div>
    </div>
  );
}
