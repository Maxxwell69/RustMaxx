"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LogoUpload } from "../logo-upload";
import ServerAccessSection from "./server-access-section";

type LogEntry = { id: string; type: string; message: string; created_at: string };
type Player = { id: string; name: string };

const QUICK_COMMANDS = [
  { label: "status", command: "status" },
  { label: "groups", command: "oxide.show groups" },
  { label: "oxide.plugins", command: "oxide.plugins" },
];

type ProfiledPlayer = {
  player_id: string;
  player_name: string | null;
  active: boolean;
};

export default function ServerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [server, setServer] = useState<{
    name: string;
    myRole?: "owner" | "admin" | "moderator";
    rcon_host?: string;
    rcon_port?: number;
    listed?: boolean;
    listing_name?: string | null;
    listing_description?: string | null;
    game_host?: string | null;
    game_port?: number | null;
    location?: string | null;
    logo_url?: string | null;
    tikfinity_anchor_steam_id?: string | null;
    streamer_interactions_enabled?: boolean;
    streamer_allowed_actions?: string[];
    streamer_allowed_item_shortnames?: string[];
  } | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
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
  const [userRole, setUserRole] = useState<string | null>(null);
  const [rconForm, setRconForm] = useState({ host: "", port: "", password: "" });
  const [rconSaving, setRconSaving] = useState(false);
  const [rconFeedback, setRconFeedback] = useState<string | null>(null);
  const [tikfinityAnchorSteam, setTikfinityAnchorSteam] = useState("");
  const [tikfinityAnchorSaving, setTikfinityAnchorSaving] = useState(false);
  const [tikfinityAnchorFeedback, setTikfinityAnchorFeedback] = useState<string | null>(null);
  const [streamerEnabled, setStreamerEnabled] = useState(false);
  const [streamerActions, setStreamerActions] = useState<string[]>([]);
  const [streamerSelectable, setStreamerSelectable] = useState<
    { action_key: string; label: string | null }[]
  >([]);
  const [streamerSaving, setStreamerSaving] = useState(false);
  const [streamerFeedback, setStreamerFeedback] = useState<string | null>(null);
  const [streamerItemShortnames, setStreamerItemShortnames] = useState<string[]>([]);
  const [streamerSelectableItems, setStreamerSelectableItems] = useState<
    {
      shortname: string;
      label: string;
      category: string;
      default_amount: number;
      max_amount: number;
      give_mode: "single" | "quantity";
      stack_cap: number;
    }[]
  >([]);
  const [profiledPlayers, setProfiledPlayers] = useState<ProfiledPlayer[]>([]);
  const [inactiveLoading, setInactiveLoading] = useState(true);
  const [setupTab, setSetupTab] = useState<"server" | "streamer">("server");
  const logEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const streamerSingleItems = useMemo(
    () => streamerSelectableItems.filter((i) => i.give_mode === "single"),
    [streamerSelectableItems]
  );
  const streamerQtyItems = useMemo(
    () => streamerSelectableItems.filter((i) => i.give_mode === "quantity"),
    [streamerSelectableItems]
  );

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
          setRconForm({
            host: typeof s.rcon_host === "string" ? s.rcon_host : "",
            port: s.rcon_port != null ? String(s.rcon_port) : "",
            password: "",
          });
          setTikfinityAnchorSteam(
            typeof s.tikfinity_anchor_steam_id === "string" ? s.tikfinity_anchor_steam_id : ""
          );
          setStreamerEnabled(Boolean(s.streamer_interactions_enabled));
          setStreamerActions(
            Array.isArray(s.streamer_allowed_actions) ? s.streamer_allowed_actions : []
          );
          setStreamerItemShortnames(
            Array.isArray(s.streamer_allowed_item_shortnames) ? s.streamer_allowed_item_shortnames : []
          );
        }
      })
      .catch(() => setServer(null));
  }, [id]);

  useEffect(() => {
    fetch(`/api/servers/${id}/streamer-policy`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        if (Array.isArray(d.selectable)) setStreamerSelectable(d.selectable);
        if (Array.isArray(d.selectableItems)) setStreamerSelectableItems(d.selectableItems);
        if (typeof d.streamer_interactions_enabled === "boolean") {
          setStreamerEnabled(d.streamer_interactions_enabled);
        }
        if (Array.isArray(d.streamer_allowed_actions)) {
          setStreamerActions(d.streamer_allowed_actions);
        }
        if (Array.isArray(d.streamer_allowed_item_shortnames)) {
          setStreamerItemShortnames(d.streamer_allowed_item_shortnames);
        }
      })
      .catch(() => {});
  }, [id]);

  // Load RustMaxx profiled players (inactive/active) for this server
  useEffect(() => {
    setInactiveLoading(true);
    fetch(`/api/servers/${id}/inactive-players`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        setProfiledPlayers(Array.isArray(data) ? data : []);
      })
      .catch(() => setProfiledPlayers([]))
      .finally(() => setInactiveLoading(false));
  }, [id]);
  useEffect(() => {
    fetch(`/api/servers/${id}/logs?limit=200`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setLogs(Array.isArray(data) ? data : []))
      .catch(() => setLogs([]));
  }, [id]);
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (p) {
          setUserRole(p.role ?? null);
          setCurrentUserId(p.id ?? null);
        }
      })
      .catch(() => setUserRole(null));
  }, []);

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

  async function saveRcon() {
    setRconFeedback(null);
    const host = rconForm.host.trim();
    const port = parseInt(rconForm.port, 10);
    if (!host || !Number.isFinite(port) || port < 1 || port > 65535) {
      setRconFeedback("Enter a valid host and RCON port (1–65535).");
      return;
    }
    setRconSaving(true);
    try {
      const payload: Record<string, unknown> = { rcon_host: host, rcon_port: port };
      if (rconForm.password.trim()) payload.rcon_password = rconForm.password.trim();
      const res = await fetch(`/api/servers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRconFeedback(typeof data.error === "string" ? data.error : "Save failed");
        return;
      }
      setServer((prev) => (prev ? { ...prev, ...data } : null));
      setRconForm((f) => ({ ...f, password: "" }));
      setRconFeedback("Saved. Click Connect again (previous session was cleared).");
      setConnected(false);
      setConnectError(null);
      try {
        sessionStorage.removeItem(`rcon_${id}`);
      } catch {
        //
      }
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    } finally {
      setRconSaving(false);
    }
  }

  async function saveStreamerPolicy() {
    setStreamerFeedback(null);
    setStreamerSaving(true);
    try {
      const res = await fetch(`/api/servers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          streamer_interactions_enabled: streamerEnabled,
          streamer_allowed_actions: streamerActions,
          streamer_allowed_item_shortnames: streamerItemShortnames,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStreamerFeedback(typeof data.error === "string" ? data.error : "Save failed");
        return;
      }
      setServer((prev) => (prev ? { ...prev, ...data } : null));
      setStreamerFeedback(
        "Saved. Streamers can only use checked actions and items you allow; MaxxInvaders / NPC roaming are not included."
      );
    } finally {
      setStreamerSaving(false);
    }
  }

  async function saveTikfinityAnchor() {
    setTikfinityAnchorFeedback(null);
    const t = tikfinityAnchorSteam.trim();
    if (t && !/^\d{17}$/.test(t)) {
      setTikfinityAnchorFeedback("Steam64 must be exactly 17 digits, or leave empty to clear.");
      return;
    }
    setTikfinityAnchorSaving(true);
    try {
      const res = await fetch(`/api/servers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ tikfinity_anchor_steam_id: t ? t : null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTikfinityAnchorFeedback(typeof data.error === "string" ? data.error : "Save failed");
        return;
      }
      setServer((prev) => (prev ? { ...prev, ...data } : null));
      setTikfinityAnchorFeedback("Saved. TikFinity webhooks for this server will use this anchor when the URL omits anchorSteam.");
    } finally {
      setTikfinityAnchorSaving(false);
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
          <Link
            href={`/servers/${id}/environment`}
            className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-rust-cyan hover:bg-zinc-600 hover:shadow-rust-glow-subtle"
          >
            Environment
          </Link>
          <Link
            href={`/servers/${id}/events`}
            className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-rust-cyan hover:bg-zinc-600 hover:shadow-rust-glow-subtle"
          >
            Events
          </Link>
          <Link
            href={`/servers/${id}/permissions`}
            className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-rust-cyan hover:bg-zinc-600 hover:shadow-rust-glow-subtle"
          >
            Permissions
          </Link>
          <Link
            href={`/servers/${id}/items`}
            className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-rust-cyan hover:bg-zinc-600 hover:shadow-rust-glow-subtle"
          >
            Items
          </Link>
          <Link
            href={`/servers/${id}/plugins`}
            className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-rust-cyan hover:bg-zinc-600 hover:shadow-rust-glow-subtle"
          >
            Plugins
          </Link>
          <Link
            href={`/servers/${id}/map`}
            className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-rust-cyan hover:bg-zinc-600 hover:shadow-rust-glow-subtle"
          >
            Map
          </Link>
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
        <div className="border-b border-zinc-800 px-3 py-2 text-sm text-zinc-400">
          RCON console (last 200 + live)
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
          className="rounded-lg bg-rust-cyan px-4 py-2 text-sm font-medium text-rust-panel disabled:opacity-50"
        >
          Run
        </button>
      </form>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="border-b border-zinc-800 px-3 py-2 text-sm font-medium text-zinc-300 flex items-center justify-between">
          <span>Online players</span>
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

      {(server.myRole === "owner" || server.myRole === "admin") && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <h2 className="text-sm font-medium text-zinc-300">RCON host, port &amp; password</h2>
          <p className="mt-1 text-xs text-zinc-500">
            The password is stored in RustMaxx but never shown again after save. Use your host&apos;s{" "}
            <strong className="text-zinc-400">WebRCON</strong> port (e.g. Shockbyte &quot;RCON&quot; in Ports — not game or query).
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Host (IP only)</label>
              <input
                type="text"
                value={rconForm.host}
                onChange={(e) => setRconForm((f) => ({ ...f, host: e.target.value }))}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
                placeholder="e.g. 51.79.46.205"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">RCON port</label>
              <input
                type="number"
                value={rconForm.port}
                onChange={(e) => setRconForm((f) => ({ ...f, port: e.target.value }))}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
                placeholder="e.g. 28016"
                min={1}
                max={65535}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-zinc-400">New RCON password (optional)</label>
              <input
                type="password"
                value={rconForm.password}
                onChange={(e) => setRconForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
                placeholder="Leave blank to keep current password"
                autoComplete="new-password"
              />
            </div>
          </div>
          {rconFeedback && (
            <p className={`mt-2 text-xs ${rconFeedback.startsWith("Saved") ? "text-emerald-400/90" : "text-red-400"}`}>
              {rconFeedback}
            </p>
          )}
          <button
            type="button"
            onClick={() => void saveRcon()}
            disabled={rconSaving}
            className="mt-3 rounded bg-zinc-700 px-3 py-1.5 text-sm font-medium text-rust-cyan hover:bg-zinc-600 disabled:opacity-50"
          >
            {rconSaving ? "Saving…" : "Save RCON settings"}
          </button>
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="border-b border-zinc-800 px-3 py-2 text-sm font-medium text-zinc-300 flex items-center justify-between">
          <span>RustMaxx player profiles on this server</span>
        </div>
        {inactiveLoading ? (
          <div className="p-3 text-sm text-zinc-500">Loading profiles…</div>
        ) : profiledPlayers.length === 0 ? (
          <div className="p-3 text-sm text-zinc-500">
            No saved player profiles yet. Players will appear here when you add them to groups.
          </div>
        ) : (
          <div className="p-3 text-sm">
            <p className="mb-2 text-xs text-zinc-500">
              Inactive players are ones that have a RustMaxx profile here but are not currently
              reported in any Oxide group on this server.
            </p>
            <ul className="space-y-1">
              {profiledPlayers.map((p) => (
                <li key={p.player_id} className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/servers/${id}/players/${encodeURIComponent(
                      p.player_id
                    )}?name=${encodeURIComponent(p.player_name || p.player_id)}`}
                    className="text-rust-cyan hover:underline"
                  >
                    {p.player_name || p.player_id}
                  </Link>
                  <span className="text-xs text-zinc-500">{p.player_id}</span>
                  <span
                    className={`ml-2 rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                      p.active
                        ? "bg-emerald-900/40 text-emerald-300 border border-emerald-700/60"
                        : "bg-zinc-800 text-zinc-300 border border-zinc-600"
                    }`}
                  >
                    {p.active ? "Active" : "Inactive"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {(server.myRole === "owner" || server.myRole === "admin") && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <div className="flex border-b border-zinc-800">
            <button
              type="button"
              onClick={() => setSetupTab("server")}
              className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                setupTab === "server"
                  ? "bg-zinc-800/80 text-zinc-100 border-b-2 border-rust-cyan -mb-px"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Server setup
            </button>
            <button
              type="button"
              onClick={() => setSetupTab("streamer")}
              className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                setupTab === "streamer"
                  ? "bg-zinc-800/80 text-zinc-100 border-b-2 border-rust-cyan -mb-px"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Streamer interactions
            </button>
          </div>
          <div className="space-y-4 p-4">
            {setupTab === "server" && (
              <>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                  <h2 className="text-sm font-medium text-zinc-300">TikFinity patrol anchor (optional)</h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    Set your <strong className="text-zinc-400">Steam64</strong> (17 digits) once.{" "}
                    <code className="rounded bg-zinc-800 px-1">maxxinvaders</code> webhooks for this server then spawn / leash viewer bots{" "}
                    <strong className="text-zinc-400">near you</strong> when you are online or sleeping — no{" "}
                    <code className="rounded bg-zinc-800 px-1">?anchorSteam=</code> in the TikFinity URL. Tune leash radius in{" "}
                    <code className="rounded bg-zinc-800 px-1">MaxxInvaders.json</code> on the game server (
                    <code className="rounded bg-zinc-800 px-1">MaxDistanceFromAnchor</code>).
                  </p>
                  <div className="mt-3">
                    <label className="mb-1 block text-xs text-zinc-400">Streamer / base owner Steam64</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={tikfinityAnchorSteam}
                      onChange={(e) => setTikfinityAnchorSteam(e.target.value.replace(/\D/g, "").slice(0, 17))}
                      className="w-full max-w-md rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 font-mono text-sm text-zinc-100"
                      placeholder="76561198963850965"
                      autoComplete="off"
                    />
                  </div>
                  {tikfinityAnchorFeedback && (
                    <p
                      className={`mt-2 text-xs ${tikfinityAnchorFeedback.startsWith("Saved") ? "text-emerald-400/90" : "text-red-400"}`}
                    >
                      {tikfinityAnchorFeedback}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void saveTikfinityAnchor()}
                    disabled={tikfinityAnchorSaving}
                    className="mt-3 rounded bg-zinc-700 px-3 py-1.5 text-sm font-medium text-rust-cyan hover:bg-zinc-600 disabled:opacity-50"
                  >
                    {tikfinityAnchorSaving ? "Saving…" : "Save patrol anchor"}
                  </button>
                </div>
                <ServerAccessSection serverId={id} currentUserId={currentUserId ?? ""} />
                {userRole !== null && (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 overflow-hidden">
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
                        When enabled, this server appears on the public{" "}
                        <a
                          href="/server-list"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-rust-cyan hover:underline"
                        >
                          /server-list
                        </a>{" "}
                        page so players can find and connect to it.
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
                )}
              </>
            )}
            {setupTab === "streamer" && (
              <div className="space-y-4">
                <h2 className="text-sm font-medium text-zinc-300">Streamer interactions</h2>
                <p className="text-xs text-zinc-500">
                  Allow TikFinity streamers to target this server from{" "}
                  <strong className="text-zinc-400">Streamer interactions</strong>. Only RustChaos-style commands and TikTok
                  social announcements (no MaxxInvaders, Roaming NPC, or chaos-wave bundles).
                </p>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                  <input
                    type="checkbox"
                    checked={streamerEnabled}
                    onChange={(e) => setStreamerEnabled(e.target.checked)}
                    className="rounded border-zinc-600"
                  />
                  Allow streamers to use this server for TikFinity webhooks
                </label>
                {streamerEnabled && streamerActions.length === 0 ? (
                  <p className="text-xs text-amber-200/90">
                    Turn on at least one action below, or streamers&apos; webhooks will be rejected until you add some.
                  </p>
                ) : null}
                <div>
                  <p className="mb-2 text-xs font-medium text-zinc-400">Allowed actions</p>
                  {streamerSelectable.length === 0 ? (
                    <p className="text-xs text-zinc-600">Loading actions…</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {streamerSelectable.map((opt) => (
                        <label
                          key={opt.action_key}
                          className="flex cursor-pointer items-start gap-2 rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 text-xs text-zinc-300 hover:border-zinc-700"
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 rounded border-zinc-600"
                            checked={streamerActions.includes(opt.action_key)}
                            onChange={(e) => {
                              const on = e.target.checked;
                              setStreamerActions((prev) =>
                                on
                                  ? [...new Set([...prev, opt.action_key])]
                                  : prev.filter((a) => a !== opt.action_key)
                              );
                            }}
                          />
                          <span>
                            <span className="font-medium text-zinc-200">{opt.label ?? opt.action_key}</span>
                            <code className="ml-1 text-[10px] text-emerald-600/90">{opt.action_key}</code>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div className="border-t border-zinc-800 pt-4">
                  <p className="mb-1 text-xs font-medium text-zinc-400">Rust items (optional)</p>
                  <p className="mb-3 text-xs text-zinc-500">
                    Super admins tag each platform item as <strong className="text-zinc-400">single</strong> (one-off spawn
                    or one inventory unit) or <strong className="text-zinc-400">quantity</strong> (stacked gives with
                    default and max within the Rust stack). Check items below to allow them for streamer interactions on
                    this server.
                  </p>
                  {streamerSelectableItems.length === 0 ? (
                    <p className="text-xs text-zinc-600">No platform items yet — ask a super admin to add some under Admin → Streamer items.</p>
                  ) : (
                    <div className="max-h-72 space-y-4 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/40 p-3">
                      {streamerSingleItems.length > 0 ? (
                        <div>
                          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                            Single (one unit / spawn)
                          </p>
                          <ul className="space-y-1">
                            {streamerSingleItems.map((it) => {
                              const on = streamerItemShortnames.includes(it.shortname);
                              return (
                                <li key={it.shortname}>
                                  <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-xs text-zinc-300 hover:bg-zinc-900/60">
                                    <input
                                      type="checkbox"
                                      className="mt-0.5 rounded border-zinc-600"
                                      checked={on}
                                      onChange={(e) => {
                                        const next = e.target.checked;
                                        setStreamerItemShortnames((prev) =>
                                          next
                                            ? [...new Set([...prev, it.shortname])]
                                            : prev.filter((s) => s !== it.shortname)
                                        );
                                      }}
                                    />
                                    <span>
                                      <span className={on ? "text-emerald-400" : "text-zinc-600"}>{on ? "✓ " : ""}</span>
                                      <span className="text-zinc-200">{it.label}</span>
                                      <code className="ml-1 text-[10px] text-zinc-500">{it.shortname}</code>
                                      <span className="ml-1 text-[10px] text-zinc-600">· ×1 · {it.category}</span>
                                    </span>
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                      {streamerQtyItems.length > 0 ? (
                        <div>
                          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                            Quantity (stacked gives)
                          </p>
                          <ul className="space-y-1">
                            {streamerQtyItems.map((it) => {
                              const on = streamerItemShortnames.includes(it.shortname);
                              return (
                                <li key={it.shortname}>
                                  <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-xs text-zinc-300 hover:bg-zinc-900/60">
                                    <input
                                      type="checkbox"
                                      className="mt-0.5 rounded border-zinc-600"
                                      checked={on}
                                      onChange={(e) => {
                                        const next = e.target.checked;
                                        setStreamerItemShortnames((prev) =>
                                          next
                                            ? [...new Set([...prev, it.shortname])]
                                            : prev.filter((s) => s !== it.shortname)
                                        );
                                      }}
                                    />
                                    <span>
                                      <span className={on ? "text-emerald-400" : "text-zinc-600"}>{on ? "✓ " : ""}</span>
                                      <span className="text-zinc-200">{it.label}</span>
                                      <code className="ml-1 text-[10px] text-zinc-500">{it.shortname}</code>
                                      <span className="ml-1 text-[10px] text-zinc-600">
                                        · default {it.default_amount} · max {it.max_amount} (stack cap {it.stack_cap}) ·{" "}
                                        {it.category}
                                      </span>
                                    </span>
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
                {streamerFeedback && (
                  <p
                    className={`text-xs ${streamerFeedback.startsWith("Saved") ? "text-emerald-400/90" : "text-red-400"}`}
                  >
                    {streamerFeedback}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void saveStreamerPolicy()}
                  disabled={streamerSaving}
                  className="rounded bg-zinc-700 px-3 py-1.5 text-sm font-medium text-rust-cyan hover:bg-zinc-600 disabled:opacity-50"
                >
                  {streamerSaving ? "Saving…" : "Save streamer settings"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
