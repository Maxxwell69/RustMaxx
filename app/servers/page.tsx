"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AuthMePayload } from "@/lib/auth-me-payload";
import { dashboardPersonaPanels } from "@/components/layout/nav-persona";
import { LogoUpload } from "./logo-upload";

type Server = {
  id: string;
  name: string;
  rcon_host: string;
  rcon_port: number;
  created_at: string;
  myRole?: "owner" | "admin" | "moderator";
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
  /** `undefined` until first auth fetch completes */
  const [me, setMe] = useState<AuthMePayload | null | undefined>(undefined);
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

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AuthMePayload | null) => {
        if (data && typeof data === "object" && "email" in data) setMe(data);
        else setMe(null);
      })
      .catch(() => setMe(null));
  }, []);

  const panels = useMemo(() => {
    if (me === undefined) return null;
    return dashboardPersonaPanels(me, {
      authenticated: me !== null,
      serverCount: servers.length,
    });
  }, [me, servers.length]);

  const pageTitle = useMemo(() => {
    if (!panels) return "Dashboard";
    const n =
      Number(panels.serverAdmin) + Number(panels.streamer) + Number(panels.fan);
    if (n > 1) return "Dashboard";
    if (panels.serverAdmin) return "Servers";
    if (panels.streamer) return "Streamer tools";
    if (panels.fan) return "Fan tools";
    return "Dashboard";
  }, [panels]);

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

  if (me === undefined || panels === null) {
    return (
      <div className="mx-auto max-w-4xl space-y-8">
        <h1 className="text-2xl font-semibold text-zinc-100">Dashboard</h1>
        <p className="text-zinc-500">Loading…</p>
      </div>
    );
  }

  if (me === null) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-2xl font-semibold text-zinc-100">Dashboard</h1>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <p className="text-zinc-300">
            Sign in to open your dashboard. What you see depends on how you signed up — server admin,
            streamer, and fan tools stay in separate sections.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-block rounded-lg bg-rust-cyan px-4 py-2 font-medium text-rust-panel shadow-rust-glow hover:shadow-rust-glow-lg"
          >
            Log in
          </Link>
        </div>
      </div>
    );
  }

  const showAnyPanel = panels.serverAdmin || panels.streamer || panels.fan;

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">{pageTitle}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Sections match your signup choices. Multiple choices means you see each matching block below.
        </p>
      </div>

      {!showAnyPanel && (
        <div className="rounded-xl border border-amber-900/50 bg-amber-950/30 p-4 text-sm text-amber-100/90">
          No dashboard sections matched your profile. Update what you&apos;re interested in on{" "}
          <Link href="/profile" className="font-medium text-rust-cyan hover:underline">
            Profile
          </Link>
          .
        </div>
      )}

      {panels.serverAdmin && (
        <section
          className="space-y-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5"
          aria-labelledby="dash-server-admin"
        >
          <div>
            <h2 id="dash-server-admin" className="text-lg font-medium text-zinc-200">
              Server admin
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              RCON, listing, and server control — for owners and people with access.
            </p>
          </div>

          {panels.showAddServerForm && (
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-4">
              <h3 className="mb-3 text-base font-medium text-zinc-300">Add server</h3>
              <p className="mb-4 text-sm text-zinc-500">
                Use the server <strong>IP only</strong> in Host (e.g. 51.79.46.205). Port: use your
                host&apos;s <strong>WebRCON/RCON</strong> port (e.g. Shockbyte RCON ={" "}
                <strong>21717</strong>). Not the game port (21715), Query (21716), or RUSTPLUS (21782).
                To change host, port, or password later, open the server →{" "}
                <strong>RCON host, port &amp; password</strong> (owner/admin).
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
                <div className="flex items-center gap-2 sm:col-span-2">
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
                      <label className="mb-1 block text-sm text-zinc-400">
                        Listing name (optional)
                      </label>
                      <input
                        type="text"
                        value={form.listing_name}
                        onChange={(e) => setForm((f) => ({ ...f, listing_name: e.target.value }))}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                        placeholder="Display name on server list (defaults to server name)"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-sm text-zinc-400">
                        Listing description (optional)
                      </label>
                      <input
                        type="text"
                        value={form.listing_description}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, listing_description: e.target.value }))
                        }
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                        placeholder="Short description for the list"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-zinc-400">
                        Game host (for &quot;Connect&quot;)
                      </label>
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
            </div>
          )}

          <div>
            <h3 className="mb-4 text-base font-medium text-zinc-300">Your servers</h3>
            {loading ? (
              <p className="text-zinc-500">Loading…</p>
            ) : servers.length === 0 ? (
              <p className="text-zinc-500">
                {panels.showAddServerForm
                  ? "No servers yet. Add one above."
                  : "No servers linked to your account yet."}
              </p>
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
                      {(s.myRole === "owner" || s.myRole === "admin") && (
                        <span className="ml-2 text-xs text-zinc-500">(you can manage access)</span>
                      )}
                      <span className="ml-2 text-sm text-zinc-500">
                        {s.rcon_host}:{s.rcon_port}
                      </span>
                    </Link>
                    {(s.myRole === "owner" || s.myRole === "admin") && (
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
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {panels.streamer && (
        <section
          className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5"
          aria-labelledby="dash-streamer"
        >
          <h2 id="dash-streamer" className="text-lg font-medium text-zinc-200">
            Streamer tools
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            TikFinity hooks, interaction builder, directory — tune details on your profile.
          </p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            <li>
              <Link
                href="/streamers"
                className="block rounded-lg border border-zinc-700 bg-zinc-950/50 px-4 py-3 transition-colors hover:border-rust-cyan/40 hover:text-rust-cyan"
              >
                <span className="font-medium text-zinc-200">Streamer directory</span>
                <span className="mt-0.5 block text-xs text-zinc-500">Public listings &amp; discovery</span>
              </Link>
            </li>
            <li>
              <Link
                href="/streamer-interaction"
                className="block rounded-lg border border-zinc-700 bg-zinc-950/50 px-4 py-3 transition-colors hover:border-rust-cyan/40 hover:text-rust-cyan"
              >
                <span className="font-medium text-zinc-200">Streamer interaction</span>
                <span className="mt-0.5 block text-xs text-zinc-500">Hooks &amp; live commands</span>
              </Link>
            </li>
            <li className="sm:col-span-2">
              <Link
                href="/profile"
                className="block rounded-lg border border-zinc-700 bg-zinc-950/50 px-4 py-3 transition-colors hover:border-rust-cyan/40 hover:text-rust-cyan"
              >
                <span className="font-medium text-zinc-200">Profile &amp; Twitch</span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  Directory bio, Twitch link, webhook tier
                </span>
              </Link>
            </li>
          </ul>
        </section>
      )}

      {panels.fan && (
        <section
          className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5"
          aria-labelledby="dash-fan"
        >
          <h2 id="dash-fan" className="text-lg font-medium text-zinc-200">
            Fans
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Follow streamers and use viewer-facing tools you get from them.
          </p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            <li>
              <Link
                href="/viewer/superfan"
                className="block rounded-lg border border-zinc-700 bg-zinc-950/50 px-4 py-3 transition-colors hover:border-rust-cyan/40 hover:text-rust-cyan"
              >
                <span className="font-medium text-zinc-200">Superfan hub</span>
                <span className="mt-0.5 block text-xs text-zinc-500">Viewer perks &amp; access</span>
              </Link>
            </li>
            <li>
              <Link
                href="/streamers"
                className="block rounded-lg border border-zinc-700 bg-zinc-950/50 px-4 py-3 transition-colors hover:border-rust-cyan/40 hover:text-rust-cyan"
              >
                <span className="font-medium text-zinc-200">Discover streamers</span>
                <span className="mt-0.5 block text-xs text-zinc-500">Browse the public directory</span>
              </Link>
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}
