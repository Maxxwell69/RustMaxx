"use client";

import { useEffect, useState } from "react";

type AccessEntry = {
  user_id: string;
  email: string;
  role: "owner" | "admin" | "moderator";
};

export default function ServerAccessSection({
  serverId,
  currentUserId,
}: {
  serverId: string;
  currentUserId: string;
}) {
  const [list, setList] = useState<AccessEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "moderator">("moderator");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    fetch(`/api/servers/${serverId}/users`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setList(Array.isArray(data) ? data : []))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [serverId]);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setAdding(true);
    fetch(`/api/servers/${serverId}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), role }),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setEmail("");
        load();
      })
      .finally(() => setAdding(false));
  }

  function handleRemove(userId: string) {
    if (!confirm("Remove this user from the server?")) return;
    fetch(`/api/servers/${serverId}/users?user_id=${encodeURIComponent(userId)}`, {
      method: "DELETE",
    })
      .then((r) => r.ok && load())
      .catch(() => {});
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <div className="border-b border-zinc-800 px-3 py-2 text-sm font-medium text-zinc-300">
        Server access
      </div>
      <div className="p-4 space-y-4">
        <p className="text-xs text-zinc-500">
          Add people by email. <strong>Admin</strong> can do everything (connect, edit, delete, add/remove users).{" "}
          <strong>Moderator</strong> can connect and give items to players but cannot delete the server or manage access.
        </p>
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[180px]">
            <label className="mb-1 block text-xs text-zinc-400">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "moderator")}
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
            >
              <option value="moderator">Moderator</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={adding || !email.trim()}
            className="rounded bg-rust-cyan px-3 py-1.5 text-sm font-medium text-rust-panel disabled:opacity-50"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </form>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : (
          <ul className="space-y-2">
            {list.map((entry) => (
              <li
                key={entry.user_id}
                className="flex items-center justify-between rounded border border-zinc-700/50 bg-zinc-800/50 px-3 py-2 text-sm"
              >
                <span className="text-zinc-200">{entry.email}</span>
                <span className="flex items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      entry.role === "owner"
                        ? "bg-amber-500/20 text-amber-400"
                        : entry.role === "admin"
                        ? "bg-rust-cyan/20 text-rust-cyan"
                        : "bg-zinc-600 text-zinc-300"
                    }`}
                  >
                    {entry.role}
                  </span>
                  {entry.role !== "owner" && entry.user_id !== currentUserId && (
                    <button
                      type="button"
                      onClick={() => handleRemove(entry.user_id)}
                      className="rounded px-2 py-0.5 text-xs text-zinc-400 hover:bg-red-900/40 hover:text-red-400"
                    >
                      Remove
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
