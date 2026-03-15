"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type User = {
  id: string;
  email: string;
  role: string;
  display_name: string | null;
  created_at: string;
};

type Server = {
  id: string;
  name: string;
  owner_id?: string | null;
  created_at: string;
};

type Stats = {
  totalUsers: number;
  totalServers: number;
  usersByRole: Record<string, number>;
};

type TwitchEventLog = {
  id: string;
  event_kind: string;
  twitch_message_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  user_id: string | null;
};

export default function SuperAdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [addAdminEmail, setAddAdminEmail] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState("");
  const [twitchEvents, setTwitchEvents] = useState<TwitchEventLog[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/stats").then((r) => {
        if (r.status === 403) {
          setAccessDenied(true);
          return null;
        }
        return r.ok ? r.json() : null;
      }),
      fetch("/api/users").then((r) => {
        if (r.status === 403) return [];
        return r.ok ? r.json() : [];
      }),
      fetch("/api/servers").then((r) => {
        if (r.status === 403) return [];
        return r.ok ? r.json() : [];
      }),
      fetch("/api/twitch/events?limit=20&all=true").then((r) => {
        if (r.status === 403 || !r.ok) return [];
        return r.json();
      }),
    ])
      .then(([s, u, srv, ev]) => {
        if (s) setStats(s);
        setUsers(Array.isArray(u) ? u : []);
        setServers(Array.isArray(srv) ? srv : []);
        setTwitchEvents(Array.isArray(ev) ? ev : []);
      })
      .catch(() => setAccessDenied(true))
      .finally(() => setLoading(false));
  }, []);

  function promoteToSuperAdmin() {
    const email = addAdminEmail.trim().toLowerCase();
    if (!email) {
      setPromoteError("Enter an email.");
      return;
    }
    const user = users.find((u) => u.email.toLowerCase() === email);
    if (!user) {
      setPromoteError("User not found. They must have an account first.");
      return;
    }
    if (user.role === "super_admin") {
      setPromoteError("Already a super admin.");
      return;
    }
    setPromoteError("");
    setPromoting(true);
    fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "super_admin" }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, ...d })))
      .then((data) => {
        if (data.error) {
          setPromoteError(data.error);
          return;
        }
        setAddAdminEmail("");
        setUsers((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, role: "super_admin" } : u))
        );
        setStats((prev) =>
          prev
            ? {
                ...prev,
                totalUsers: prev.totalUsers,
                usersByRole: {
                  ...prev.usersByRole,
                  super_admin: (prev.usersByRole.super_admin ?? 0) + 1,
                  [user.role]: Math.max(0, (prev.usersByRole[user.role] ?? 0) - 1),
                },
              }
            : null
        );
      })
      .catch(() => setPromoteError("Request failed"))
      .finally(() => setPromoting(false));
  }

  const ownerIdToEmail = new Map(
    users.map((u) => [u.id, u.email])
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <p className="text-zinc-500">Loading…</p>
      </div>
    );
  }

  if (accessDenied || !stats) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h1 className="text-xl font-semibold text-zinc-100">Super Admin Dashboard</h1>
          <p className="mt-2 text-zinc-400">
            Only super admins can view this page. If you need access, ask an existing super admin.
          </p>
          <Link href="/profile" className="mt-4 inline-block text-rust-cyan hover:underline">
            ← Back to profile
          </Link>
        </div>
      </div>
    );
  }

  const streamers = users.filter((u) => u.role === "streamer");
  const players = users.filter((u) => u.role === "player");
  const superAdmins = users.filter((u) => u.role === "super_admin");

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/profile" className="text-rust-cyan hover:underline">
          ← Profile
        </Link>
        <Link href="/servers" className="text-rust-cyan hover:underline">
          Dashboard
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-100">Super Admin Dashboard</h1>
      </div>

      {/* Stats */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-2xl font-bold text-zinc-100">{stats.totalUsers}</div>
          <div className="text-sm text-zinc-500">Total users</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-2xl font-bold text-zinc-100">{stats.totalServers}</div>
          <div className="text-sm text-zinc-500">Servers</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-2xl font-bold text-rust-cyan">
            {stats.usersByRole.super_admin ?? 0}
          </div>
          <div className="text-sm text-zinc-500">Super admins</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-2xl font-bold text-zinc-100">
            {stats.usersByRole.streamer ?? 0}
          </div>
          <div className="text-sm text-zinc-500">Streamers</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-2xl font-bold text-zinc-100">
            {stats.usersByRole.player ?? 0}
          </div>
          <div className="text-sm text-zinc-500">Players</div>
        </div>
      </section>

      {/* Users */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
          <h2 className="text-lg font-medium text-zinc-200">Users</h2>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/streamer-interactions"
              className="rounded bg-rust-cyan/20 px-3 py-1.5 text-sm font-medium text-rust-cyan hover:bg-rust-cyan/30"
            >
              TikFinity action maps →
            </Link>
            <Link
              href="/admin/users"
              className="rounded bg-rust-cyan/20 px-3 py-1.5 text-sm font-medium text-rust-cyan hover:bg-rust-cyan/30"
            >
              Manage users & roles →
            </Link>
          </div>
        </div>
        <div className="p-4">
          <p className="text-sm text-zinc-500">
            {stats.totalUsers} total. Use &quot;Manage users & roles&quot; to change roles and add super admins below.
          </p>
        </div>
      </section>

      {/* Servers */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h2 className="text-lg font-medium text-zinc-200">Servers</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-800/50">
                <th className="px-4 py-3 font-medium text-zinc-400">Name</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Owner</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Created</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {servers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                    No servers yet.
                  </td>
                </tr>
              ) : (
                servers.map((s) => (
                  <tr key={s.id} className="border-b border-zinc-800/50">
                    <td className="px-4 py-3 text-zinc-200">{s.name}</td>
                    <td className="px-4 py-3 text-zinc-400">
                      {s.owner_id ? ownerIdToEmail.get(s.owner_id) ?? s.owner_id : "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {s.created_at
                        ? new Date(s.created_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/servers/${s.id}`}
                        className="text-rust-cyan hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Streamers */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h2 className="text-lg font-medium text-zinc-200">Streamers</h2>
        </div>
        <div className="p-4">
          {streamers.length === 0 ? (
            <p className="text-sm text-zinc-500">No users with streamer role.</p>
          ) : (
            <ul className="space-y-2">
              {streamers.map((u) => (
                <li key={u.id} className="flex items-center gap-2 text-sm">
                  <span className="text-zinc-200">{u.email}</span>
                  {u.display_name && (
                    <span className="text-zinc-500">({u.display_name})</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Players */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h2 className="text-lg font-medium text-zinc-200">Players</h2>
        </div>
        <div className="max-h-48 overflow-y-auto p-4">
          {players.length === 0 ? (
            <p className="text-sm text-zinc-500">No users with player role.</p>
          ) : (
            <ul className="space-y-2">
              {players.map((u) => (
                <li key={u.id} className="flex items-center gap-2 text-sm">
                  <span className="text-zinc-200">{u.email}</span>
                  {u.display_name && (
                    <span className="text-zinc-500">({u.display_name})</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Recent Twitch events */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h2 className="text-lg font-medium text-zinc-200">Recent Twitch events</h2>
        </div>
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          {twitchEvents.length === 0 ? (
            <div className="p-4 text-sm text-zinc-500 space-y-2">
              <p>No Twitch events yet. Connect Twitch on Profile and trigger a follow.</p>
              <p className="text-xs text-zinc-600">
                If you expected events: ensure TWITCH_WEBHOOK_CALLBACK_URL is your public HTTPS URL (e.g. https://www.rustmaxx.com/api/twitch/webhook), TWITCH_EVENTSUB_SECRET is set, and you connected Twitch from Profile after those were set. If you linked Twitch before configuring the webhook, disconnect and reconnect Twitch so the follow subscription is created.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-zinc-900">
                <tr className="border-b border-zinc-800">
                  <th className="px-4 py-2 font-medium text-zinc-400">Time</th>
                  <th className="px-4 py-2 font-medium text-zinc-400">Event</th>
                  <th className="px-4 py-2 font-medium text-zinc-400">Details</th>
                </tr>
              </thead>
              <tbody>
                {twitchEvents.map((e) => (
                  <tr key={e.id} className="border-b border-zinc-800/50">
                    <td className="px-4 py-2 text-zinc-500 whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-zinc-300">{e.event_kind}</td>
                    <td className="px-4 py-2 text-zinc-400">
                      {e.event_kind === "channel.follow" && typeof e.payload?.user_name === "string"
                        ? `${e.payload.user_name} followed`
                        : JSON.stringify(e.payload).slice(0, 80)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Add super admin */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h2 className="text-lg font-medium text-zinc-200">Add super admin</h2>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-zinc-500">
            Promote an existing user to super_admin by email. They must already have an account.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={addAdminEmail}
              onChange={(e) => setAddAdminEmail(e.target.value)}
              placeholder="user@example.com"
              className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 w-64"
            />
            <button
              type="button"
              onClick={promoteToSuperAdmin}
              disabled={promoting}
              className="rounded bg-rust-cyan px-4 py-2 text-sm font-medium text-rust-panel hover:shadow-rust-glow disabled:opacity-50"
            >
              {promoting ? "Promoting…" : "Promote to super admin"}
            </button>
          </div>
          {promoteError && (
            <p className="text-sm text-red-400">{promoteError}</p>
          )}
          {superAdmins.length > 0 && (
            <p className="text-xs text-zinc-500">
              Current super admins: {superAdmins.map((u) => u.email).join(", ")}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
