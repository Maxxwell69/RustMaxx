"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogoUpload } from "./logo-upload";

type Server = {
  id: string;
  name: string;
  rcon_host: string;
  rcon_port: number;
  created_at: string;
  listed?: boolean;
  listing_name?: string | null;
  listing_description?: string | null;
  game_host?: string | null;
  game_port?: number | null;
  location?: string | null;
  logo_url?: string | null;
};

export default function ServersPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    name: "",
    host: "",
    port: "28016",
    password: "",
    listed: false,
    listing_name: "",
    listing_description: "",
    game_host: "",
    game_port: "",
    location: "",
    logo_url: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/servers")
      .then((r) => r.json())
      .then((data) => setServers(Array.isArray(data) ? data : []))
      .catch(() => setServers([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          host: form.host.trim(),
          port: parseInt(form.port, 10) || 28016,
          password: form.password,
          listed: form.listed,
          listing_name: form.listing_name.trim() || undefined,
          listing_description: form.listing_description.trim() || undefined,
          game_host: form.game_host.trim() || undefined,
          game_port: form.game_port ? parseInt(form.game_port, 10) || undefined : undefined,
          location: form.location.trim() || undefined,
          logo_url: form.logo_url.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to add server");
        return;
      }
      setForm({
        name: "",
        host: "",
        port: "28016",
        password: "",
        listed: false,
        listing_name: "",
        listing_description: "",
        game_host: "",
        game_port: "",
        location: "",
        logo_url: "",
      });
      load();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <h1 className="text-2xl font-semibold text-zinc-100">Servers</h1>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-4 text-lg font-medium text-zinc-300">Add server</h2>
        <p className="mb-4 text-sm text-zinc-500">
          Use the server <strong>IP only</strong> in Host (e.g. 51.79.46.205). Port: use your host’s <strong>WebRCON/RCON</strong> port (e.g. Shockbyte RCON = <strong>21717</strong>). Not the game port (21715), Query (21716), or RUSTPLUS (21782).
        </p>
        <form onSubmit={handleAdd} className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
              placeholder="My Rust Server"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Host</label>
            <input
              type="text"
              value={form.host}
              onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
              placeholder="e.g. 51.79.46.205"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-400">RCON port</label>
            <input
              type="number"
              value={form.port}
              onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
              placeholder="e.g. 21717 or 28016"
              min={1}
              max={65535}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-400">RCON password</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
              placeholder="••••••••"
              required
            />
          </div>
          <div className="sm:col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              id="listed"
              checked={form.listed}
              onChange={(e) => setForm((f) => ({ ...f, listed: e.target.checked }))}
              className="rounded border-zinc-600 bg-zinc-800 text-amber-600 focus:ring-amber-500"
            />
            <label htmlFor="listed" className="text-sm text-zinc-400">
              List on public server list (players can find this server on /server-list)
            </label>
          </div>
          {form.listed && (
            <>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm text-zinc-400">Listing name (optional)</label>
                <input
                  type="text"
                  value={form.listing_name}
                  onChange={(e) => setForm((f) => ({ ...f, listing_name: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  placeholder="Display name on server list (defaults to server name)"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm text-zinc-400">Listing description (optional)</label>
                <input
                  type="text"
                  value={form.listing_description}
                  onChange={(e) => setForm((f) => ({ ...f, listing_description: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  placeholder="Short description for the list"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-zinc-400">Game host (for &quot;Connect&quot;)</label>
                <input
                  type="text"
                  value={form.game_host}
                  onChange={(e) => setForm((f) => ({ ...f, game_host: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  placeholder="IP or hostname players use to join"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-zinc-400">Game port (join port)</label>
                <input
                  type="number"
                  value={form.game_port}
                  onChange={(e) => setForm((f) => ({ ...f, game_port: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  placeholder="e.g. 28015"
                  min={1}
                  max={65535}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-zinc-400">Location (optional)</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                  placeholder="e.g. Quebec, US East"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm text-zinc-400">Logo (optional)</label>
                <LogoUpload
                  value={form.logo_url}
                  onChange={(url) => setForm((f) => ({ ...f, logo_url: url }))}
                  disabled={submitting}
                  className="mt-1"
                />
              </div>
            </>
          )}
          <div className="sm:col-span-2">
            {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-rust-cyan px-4 py-2 font-medium text-rust-panel shadow-rust-glow hover:shadow-rust-glow-lg disabled:opacity-50"
            >
              {submitting ? "Adding…" : "Add server"}
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-medium text-zinc-300">Your servers</h2>
        {loading ? (
          <p className="text-zinc-500">Loading…</p>
        ) : servers.length === 0 ? (
          <p className="text-zinc-500">No servers yet. Add one above.</p>
        ) : (
          <ul className="space-y-2">
            {servers.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3"
              >
                <Link
                  href={`/servers/${s.id}`}
                  className="min-w-0 flex-1 text-zinc-100 hover:text-rust-cyan"
                >
                  <span className="font-medium">{s.name}</span>
                  {s.listed && (
                    <span className="ml-2 rounded bg-rust-green/20 px-1.5 py-0.5 text-xs text-rust-green">
                      On list
                    </span>
                  )}
                  <span className="ml-2 text-sm text-zinc-500">
                    {s.rcon_host}:{s.rcon_port}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    if (!confirm(`Delete "${s.name}"? This cannot be undone.`)) return;
                    fetch(`/api/servers/${s.id}`, { method: "DELETE" })
                      .then((r) => r.ok && load())
                      .catch(() => {});
                  }}
                  className="shrink-0 rounded px-2 py-1 text-sm text-zinc-400 hover:bg-red-900/40 hover:text-red-400"
                  title="Delete server"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
