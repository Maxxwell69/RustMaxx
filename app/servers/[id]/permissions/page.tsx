"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type Group = {
  id: string;
  server_id: string;
  name: string;
  description: string | null;
  created_at: string;
};

export default function ServerPermissionsPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [serverGroups, setServerGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [serverGroupsError, setServerGroupsError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  function load() {
    setLoading(true);
    setError("");
    fetch(`/api/servers/${id}/groups`)
      .then((r) => {
        if (!r.ok) {
          if (r.status === 404) {
            setError("Server not found or you do not have access.");
          } else if (r.status === 403) {
            setError("Only server owner or admins can view permissions.");
          } else {
            setError("Failed to load groups.");
          }
          return [];
        }
        return r.json();
      })
      .then((data) => {
        setGroups(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        setError("Failed to load groups.");
      })
      .finally(() => setLoading(false));
  }

  function loadServerGroups() {
    setServerGroupsError("");
    fetch(`/api/servers/${id}/server-groups`)
      .then((r) => {
        if (!r.ok) {
          return r.json().then((d) => {
            const msg = typeof d?.error === "string" ? d.error : "Failed to load server groups.";
            throw new Error(msg);
          });
        }
        return r.json();
      })
      .then((data) => {
        const list = Array.isArray(data?.groups) ? data.groups : [];
        setServerGroups(list);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setServerGroupsError(msg);
      });
  }

  useEffect(() => {
    if (id) {
      load();
      loadServerGroups();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Group name is required.");
      return;
    }
    setCreating(true);
    setError("");
    fetch(`/api/servers/${id}/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: trimmed,
        description: description.trim() || undefined,
      }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, ...d })))
      .then((data) => {
        if (!data.ok) {
          setError(data.error || "Failed to create group.");
          return;
        }
        setName("");
        setDescription("");
        load();
      })
      .catch(() => setError("Failed to create group."))
      .finally(() => setCreating(false));
  }

  async function openOrCreateFromServerGroup(groupName: string) {
    // If we already have a RustMaxx group with this name, just open it.
    const existing = groups.find((g) => g.name === groupName);
    if (existing) {
      router.push(`/servers/${id}/groups/${existing.id}`);
      return;
    }

    // Otherwise, create a RustMaxx group record for this existing server group,
    // then navigate to its edit page.
    try {
      setError("");
      const res = await fetch(`/api/servers/${id}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: groupName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof (data as { error?: string })?.error === "string"
            ? (data as { error: string }).error
            : "Failed to create group from server group.";
        setError(msg);
        return;
      }
      const created = data as Group;
      setGroups((prev) => [...prev, created]);
      router.push(`/servers/${id}/groups/${created.id}`);
    } catch {
      setError("Failed to create group from server group.");
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/servers/${id}`} className="text-rust-cyan hover:underline">
          ← Back to server
        </Link>
        <h1 className="text-xl font-semibold text-zinc-100">Server permissions</h1>
      </div>

      <p className="text-sm text-zinc-500">
        Create groups for this server (for example <strong>VIP</strong>, <strong>Staff</strong>, or{" "}
        <strong>Raid Team</strong>) and assign players by their Rust ID. You can then use these
        groups in your server tooling and configs. Below you can also see groups reported by the
        connected Rust server (via Oxide).
      </p>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-medium text-zinc-200">
            Groups on the Rust server (read-only)
          </h2>
          <button
            type="button"
            onClick={loadServerGroups}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-rust-cyan hover:bg-zinc-700"
          >
            Refresh
          </button>
        </div>
        {serverGroupsError && (
          <div className="px-4 py-2 text-xs text-red-400">{serverGroupsError}</div>
        )}
        {serverGroups.length === 0 && !serverGroupsError ? (
          <div className="px-4 py-3 text-sm text-zinc-500">
            No groups reported yet. Make sure the server is connected and Oxide is installed.
          </div>
        ) : (
          <ul className="px-4 py-3 text-sm text-zinc-200">
            {serverGroups.map((g) => (
              <li key={g} className="inline-block mr-2 mb-2">
                <button
                  type="button"
                  onClick={() => openOrCreateFromServerGroup(g)}
                  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-100 hover:border-rust-cyan hover:text-rust-cyan"
                >
                  {g}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-200">Create a new group</h2>
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name (e.g. admin2, vip_staff)"
              className="w-64 flex-1 min-w-[180px] rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500"
            />
            <button
              type="submit"
              disabled={creating}
              className="rounded bg-rust-cyan px-4 py-2 text-sm font-medium text-rust-panel hover:shadow-rust-glow disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create group"}
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            Group names must be a single word (no spaces), so they work with Oxide groups. Use
            letters, numbers, <code>-</code> or <code>_</code>.
          </p>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description (what this group is for)"
            rows={2}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
        </form>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-medium text-zinc-200">Groups on this server</h2>
        </div>
        {loading ? (
          <div className="p-4 text-sm text-zinc-500">Loading…</div>
        ) : groups.length === 0 ? (
          <div className="p-4 text-sm text-zinc-500">
            No groups yet. Create one above to start organizing players.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {groups.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium text-zinc-100">{g.name}</div>
                  {g.description && (
                    <div className="text-xs text-zinc-500">{g.description}</div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/servers/${id}/groups/${g.id}`}
                    className="rounded border border-rust-cyan/60 px-3 py-1.5 text-xs font-medium text-rust-cyan hover:border-rust-cyan hover:shadow-rust-glow-subtle"
                  >
                    Open group →
                  </Link>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = window.confirm(
                        `Delete group "${g.name}" and remove it from this server?`
                      );
                      if (!ok) return;
                      try {
                        const res = await fetch(
                          `/api/servers/${id}/groups/${g.id}`,
                          {
                            method: "DELETE",
                          }
                        );
                        if (!res.ok) {
                          const data = await res.json().catch(() => ({}));
                          const msg =
                            typeof data?.error === "string"
                              ? data.error
                              : "Failed to delete group.";
                          alert(msg);
                          return;
                        }
                        // Reload groups list
                        load();
                      } catch {
                        alert("Failed to delete group.");
                      }
                    }}
                    className="rounded border border-red-500/60 px-3 py-1.5 text-xs font-medium text-red-400 hover:border-red-500 hover:bg-red-900/20"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

