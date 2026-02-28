"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Server = {
  id: string;
  name: string;
  rcon_host: string;
  rcon_port: number;
  created_at: string;
};

export default function ServersPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", host: "", port: "28016", password: "" });
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
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to add server");
        return;
      }
      setForm({ name: "", host: "", port: "28016", password: "" });
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
          Use the server <strong>IP only</strong> in Host (e.g. 51.79.46.205). Use the <strong>RCON port</strong> from your host—not the game/join port (e.g. 21715 is usually the game port). Shockbyte: check Config, Console, or RCON in the panel for RCON port and password.
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
              placeholder="28016"
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
          <div className="sm:col-span-2">
            {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-amber-600 px-4 py-2 font-medium text-white hover:bg-amber-500 disabled:opacity-50"
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
              <li key={s.id}>
                <Link
                  href={`/servers/${s.id}`}
                  className="block rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-zinc-100 hover:border-zinc-700 hover:bg-zinc-800/50"
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="ml-2 text-sm text-zinc-500">
                    {s.rcon_host}:{s.rcon_port}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
