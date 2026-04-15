"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  MEMBERSHIP_LEVEL_LABELS,
  type MembershipLevel,
} from "@/lib/membership-level";

type User = {
  id: string;
  email: string;
  role: string;
  display_name: string | null;
  membership_level: MembershipLevel;
  membership_packages?: string[];
  created_at: string;
};

type PackageOption = {
  key: string;
  label: string;
};

const ROLES = ["guest", "player", "streamer", "support", "moderator", "admin", "super_admin"];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [packageOptions, setPackageOptions] = useState<PackageOption[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me: { id?: string } | null) => setCurrentUserId(me?.id ?? null))
      .catch(() => setCurrentUserId(null));
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/users").then((r) => {
        if (!r.ok) {
          if (r.status === 403) setError("Only super_admin can manage users.");
          else setError("Failed to load users.");
          return [];
        }
        return r.json();
      }),
      fetch("/api/admin/pricing-packages", { credentials: "same-origin" }).then((r) =>
        r.ok ? r.json() : { packages: [] }
      ),
    ])
      .then(([userData, pkgData]) => {
        setUsers(
          Array.isArray(userData)
            ? userData.map((u: User) => ({
                ...u,
                membership_level: u.membership_level ?? "standard",
                membership_packages: Array.isArray(u.membership_packages) ? u.membership_packages : [],
              }))
            : []
        );
        const list = Array.isArray((pkgData as { packages?: unknown[] }).packages)
          ? ((pkgData as { packages?: Array<{ package_kind: string; tier_key: string; name: string }> }).packages ?? [])
          : [];
        setPackageOptions(
          list.map((p) => ({
            key: `${p.package_kind}:${p.tier_key}`,
            label: `${p.package_kind} - ${p.name} (${p.tier_key})`,
          }))
        );
      })
      .catch(() => setError("Failed to load users/pricing."))
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
          prev.map((u) =>
            u.id === userId
              ? {
                  ...u,
                  role: data.role ?? newRole,
                  membership_level: data.membership_level ?? u.membership_level,
                }
              : u
          )
        );
      })
      .catch(() => setError("Update failed"))
      .finally(() => setUpdating(null));
  }

  function updateMembershipPackages(userId: string, packages: string[]) {
    setUpdating(userId);
    fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membershipPackages: packages }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, ...d })))
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setError("");
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId
              ? {
                  ...u,
                  membership_packages: Array.isArray(data.membership_packages)
                    ? data.membership_packages
                    : packages,
                }
              : u
          )
        );
      })
      .catch(() => setError("Update failed"))
      .finally(() => setUpdating(null));
  }

  function deleteUser(u: User) {
    if (u.id === currentUserId) {
      setError("You cannot delete your own account.");
      return;
    }
    if (
      !window.confirm(
        `Permanently delete ${u.email}?\n\nThis cannot be undone. Database rules may also remove servers they own and other linked data (CASCADE).`
      )
    ) {
      return;
    }
    setUpdating(u.id);
    fetch(`/api/users/${u.id}`, { method: "DELETE" })
      .then((r) => r.json().then((d) => ({ ok: r.ok, ...d })))
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setError("");
        setUsers((prev) => prev.filter((x) => x.id !== u.id));
      })
      .catch(() => setError("Delete failed"))
      .finally(() => setUpdating(null));
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/servers" className="text-rust-cyan hover:underline">
          ← Dashboard
        </Link>
        <h1 className="text-xl font-semibold text-zinc-100">Manage users, roles & levels</h1>
      </div>
      <p className="mb-4 text-sm text-zinc-500">
        Only super_admin can access this page. Change a user&apos;s <strong className="text-zinc-400">role</strong>{" "}
        (permissions) and assign one or more <strong className="text-zinc-400">pricing packages</strong> based on current
        server/streamer/combo tiers. Remove admin by setting role to guest. Use{" "}
        <strong className="text-zinc-400">Delete</strong>{" "}
        to remove an account entirely (you cannot delete yourself or the last super_admin).
      </p>
      {error && (
        <p className="mb-4 text-sm text-red-400">{error}</p>
      )}
      {loading ? (
        <p className="text-zinc-500">Loading…</p>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-800/50">
                <th className="px-4 py-3 font-medium text-zinc-300">Email</th>
                <th className="px-4 py-3 font-medium text-zinc-300">Role</th>
                <th className="px-4 py-3 font-medium text-zinc-300">Level</th>
                <th className="px-4 py-3 font-medium text-zinc-300">Change role</th>
                <th className="px-4 py-3 font-medium text-zinc-300">Assigned packages</th>
                <th className="px-4 py-3 font-medium text-zinc-300">Actions</th>
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
                    <span className="rounded bg-emerald-950/80 px-2 py-0.5 text-emerald-300">
                      {MEMBERSHIP_LEVEL_LABELS[u.membership_level] ?? u.membership_level}
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
                  <td className="px-4 py-3">
                    <div className="space-y-2">
                      <select
                        multiple
                        value={u.membership_packages ?? []}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions).map((opt) => opt.value);
                          updateMembershipPackages(u.id, selected);
                        }}
                        disabled={updating === u.id}
                        className="min-w-[240px] rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-zinc-200 disabled:opacity-50"
                      >
                        {packageOptions.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-zinc-500">Hold Ctrl/Cmd to select multiple packages.</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => deleteUser(u)}
                      disabled={updating === u.id || u.id === currentUserId}
                      className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-40"
                      title={
                        u.id === currentUserId
                          ? "You cannot delete your own account"
                          : "Permanently delete this user"
                      }
                    >
                      Delete
                    </button>
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
