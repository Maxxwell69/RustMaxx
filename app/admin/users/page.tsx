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

const ROLES = ["guest", "player", "streamer", "support", "moderator", "admin", "super_admin"];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/users")
      .then((r) => {
        if (!r.ok) {
          if (r.status === 403) setError("Only super_admin can manage users.");
          else setError("Failed to load users.");
          return [];
        }
        return r.json();
      })
      .then((data) => setUsers(Array.isArray(data) ? data : []))
      .catch(() => setError("Failed to load users."))
      .finally(() => setLoading(false));
  }, []);

  function updateRole(userId: string, newRole: string) {
    setUpdating(userId);
    fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, ...d })))
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setError("");
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
        );
      })
      .catch(() => setError("Update failed"))
      .finally(() => setUpdating(null));
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/servers" className="text-rust-cyan hover:underline">
          ← Dashboard
        </Link>
        <h1 className="text-xl font-semibold text-zinc-100">Manage users & roles</h1>
      </div>
      <p className="mb-4 text-sm text-zinc-500">
        Only super_admin can access this page. Change a user&apos;s role or remove admin by setting them to guest.
      </p>
      {error && (
        <p className="mb-4 text-sm text-red-400">{error}</p>
      )}
      {loading ? (
        <p className="text-zinc-500">Loading…</p>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-800/50">
                <th className="px-4 py-3 font-medium text-zinc-300">Email</th>
                <th className="px-4 py-3 font-medium text-zinc-300">Role</th>
                <th className="px-4 py-3 font-medium text-zinc-300">Change role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-zinc-800/50">
                  <td className="px-4 py-3 text-zinc-200">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-zinc-700 px-2 py-0.5 text-zinc-300">
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={(e) => updateRole(u.id, e.target.value)}
                      disabled={updating === u.id}
                      className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-zinc-200 disabled:opacity-50"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    {u.role !== "guest" && (
                      <button
                        type="button"
                        onClick={() => updateRole(u.id, "guest")}
                        disabled={updating === u.id}
                        className="ml-2 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50"
                      >
                        Remove admin
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
