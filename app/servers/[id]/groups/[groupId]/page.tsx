"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Group = {
  id: string;
  server_id: string;
  name: string;
  description: string | null;
  created_at: string;
};

type Member = {
  id: string;
  group_id: string;
  player_id: string;
  player_name: string | null;
  created_at: string;
};

type ServerPlayer = {
  player_id: string;
  player_name: string | null;
};

export default function ServerGroupPage() {
  const params = useParams();
  const serverId = params.id as string;
  const groupId = params.groupId as string;

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [serverPlayers, setServerPlayers] = useState<ServerPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    setError("");
    fetch(`/api/servers/${serverId}/groups/${groupId}`)
      .then((r) => {
        if (!r.ok) {
          if (r.status === 404) {
            setError("Group not found or you do not have access.");
          } else if (r.status === 403) {
            setError("Only server owner or admins can view this group.");
          } else {
            setError("Failed to load group.");
          }
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        setGroup(data.group);
        setMembers(Array.isArray(data.members) ? data.members : []);
        setPermissions(Array.isArray(data.permissions) ? data.permissions : []);
        setServerPlayers(
          Array.isArray(data.serverPlayers) ? data.serverPlayers : []
        );
      })
      .catch(() => setError("Failed to load group."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (serverId && groupId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, groupId]);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const id = playerId.trim();
    if (!id) {
      setError("Player ID is required.");
      return;
    }
    setSaving(true);
    setError("");
    fetch(`/api/servers/${serverId}/groups/${groupId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        player_id: id,
        player_name: playerName.trim() || undefined,
      }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, ...d })))
      .then((data) => {
        if (!data.ok) {
          setError(data.error || "Failed to add player.");
          return;
        }
        setPlayerId("");
        setPlayerName("");
        load();
      })
      .catch(() => setError("Failed to add player."))
      .finally(() => setSaving(false));
  }

  function handleRemove(member: Member) {
    if (!member.player_id) return;
    setSaving(true);
    setError("");
    fetch(
      `/api/servers/${serverId}/groups/${groupId}/members?player_id=${encodeURIComponent(
        member.player_id
      )}`,
      {
        method: "DELETE",
      }
    )
      .then((r) => {
        if (!r.ok) {
          return r.json().then((d) => {
            throw new Error(d.error || "Failed to remove player.");
          });
        }
      })
      .then(() => {
        setMembers((prev) => prev.filter((m) => m.player_id !== member.player_id));
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg || "Failed to remove player.");
      })
      .finally(() => setSaving(false));
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/servers/${serverId}/permissions`} className="text-rust-cyan hover:underline">
          ← Back to permissions
        </Link>
        <h1 className="text-xl font-semibold text-zinc-100">
          {group ? group.name : "Group"}
        </h1>
      </div>

      {group && group.description && (
        <p className="text-sm text-zinc-500">{group.description}</p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <h2 className="mb-3 text-sm font-medium text-zinc-200">
              Permissions on Rust server for this group
            </h2>
            {permissions.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No permissions detected for this group, or Oxide did not return any. Use your
                server console to grant permissions if needed.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2 text-xs text-zinc-100">
                {permissions.map((p) => (
                  <li
                    key={p}
                    className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1"
                  >
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h2 className="text-sm font-medium text-zinc-200">
                Players on Rust server in this group (read-only)
              </h2>
            </div>
            {serverPlayers.length === 0 ? (
              <div className="p-4 text-sm text-zinc-500">
                No players reported for this group, or Oxide did not return any.
              </div>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {serverPlayers.map((p) => (
                  <li
                    key={p.player_id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <Link href={`/servers/${serverId}/players/${p.player_id}?name=${encodeURIComponent(p.player_name || p.player_id)}`}>
                      <div>
                        <div className="text-sm font-medium text-rust-cyan hover:underline">
                          {p.player_name || p.player_id}
                        </div>
                        <div className="text-xs text-zinc-500">{p.player_id}</div>
                      </div>
                    </Link>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={async () => {
                        const ok = window.confirm(
                          `Remove ${p.player_name || p.player_id} from group?`
                        );
                        if (!ok) return;
                        setSaving(true);
                        setError("");
                        try {
                          const res = await fetch(
                            `/api/servers/${serverId}/groups/${groupId}/members?player_id=${encodeURIComponent(
                              p.player_id
                            )}`,
                            { method: "DELETE" }
                          );
                          const data = await res.json().catch(() => ({}));
                          if (!res.ok) {
                            const msg =
                              typeof (data as { error?: string })?.error === "string"
                                ? (data as { error: string }).error
                                : "Failed to remove player from group.";
                            setError(msg);
                            return;
                          }
                          setServerPlayers((prev) =>
                            prev.filter((sp) => sp.player_id !== p.player_id)
                          );
                        } catch {
                          setError("Failed to remove player from group.");
                        } finally {
                          setSaving(false);
                        }
                      }}
                      className="rounded border border-red-500/60 px-3 py-1.5 text-xs font-medium text-red-400 hover:border-red-500 hover:bg-red-900/20 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <h2 className="mb-3 text-sm font-medium text-zinc-200">Add player to this group</h2>
            <form onSubmit={handleAdd} className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={playerId}
                  onChange={(e) => setPlayerId(e.target.value)}
                  placeholder="Rust player ID"
                  className="w-56 flex-1 min-w-[160px] rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500"
                />
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Player name (optional, for your reference)"
                  className="w-56 flex-1 min-w-[160px] rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded bg-rust-cyan px-4 py-2 text-sm font-medium text-rust-panel hover:shadow-rust-glow disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Add to group"}
                </button>
              </div>
              <p className="text-xs text-zinc-500">
                This will add the player to the Oxide group on the Rust server using their SteamID /
                Rust ID.
              </p>
            </form>
          </section>
        </>
      )}
    </div>
  );
}

