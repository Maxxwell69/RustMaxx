"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";

type GiveItem = { shortname: string; label: string; amount: number; category: string };
type GroupSummaryItem = { id: string; name: string; permissions: string[] };

function PlayerContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const serverId = params.id as string;
  const playerId = params.playerId as string;
  const name = searchParams.get("name") || playerId;
  const [server, setServer] = useState<{ name: string; myRole?: string } | null>(null);
  const [groupSummary, setGroupSummary] = useState<GroupSummaryItem[]>([] as GroupSummaryItem[]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [giveItems, setGiveItems] = useState<GiveItem[]>([]);
  const [giving, setGiving] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [oxidePerm, setOxidePerm] = useState("");
  const [oxideBusy, setOxideBusy] = useState<string | null>(null);
  const [oxideMessage, setOxideMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/servers/${serverId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setServer)
      .catch(() => setServer(null));
  }, [serverId]);

  // Load enabled give-items configuration for this server.
  useEffect(() => {
    fetch(`/api/servers/${serverId}/items?enabled=1`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        setGiveItems(Array.isArray(data) ? data : []);
      })
      .catch(() => setGiveItems([]));
  }, [serverId]);

  // Load groups/permissions this player is part of on this server.
  useEffect(() => {
    let cancelled = false;
    async function loadGroups() {
      setGroupsLoading(true);
      try {
        const res = await fetch(`/api/servers/${serverId}/groups`);
        const data = await res.json().catch(() => []);
        if (!Array.isArray(data)) {
          setGroupSummary([]);
          return;
        }
        const groups: { id: string; name: string }[] = data;
        const results: { id: string; name: string; permissions: string[] }[] = [];
        for (const g of groups) {
          const r = await fetch(`/api/servers/${serverId}/groups/${g.id}`);
          const body = await r.json().catch(() => null);
          if (!body || !Array.isArray(body.serverPlayers)) continue;
          const inGroup = body.serverPlayers.some(
            (sp: { player_id: string }) => sp.player_id === playerId
          );
          if (!inGroup) continue;
          const perms: string[] = Array.isArray(body.permissions)
            ? body.permissions
            : [];
          results.push({ id: g.id, name: g.name, permissions: perms });
        }
        if (!cancelled) {
          setGroupSummary(results);
        }
      } catch {
        if (!cancelled) setGroupSummary([]);
      } finally {
        if (!cancelled) setGroupsLoading(false);
      }
    }
    loadGroups();
    return () => {
      cancelled = true;
    };
  }, [serverId, playerId]);

  async function giveItem(shortname: string, amount: number) {
    setMessage(null);
    setGiving(shortname);
    try {
      const cmd = `inventory.giveto ${playerId} \"${shortname}\" ${amount}`;
      const res = await fetch(`/api/servers/${serverId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage({ type: "ok", text: data.response ? String(data.response) : `Sent: ${shortname} x${amount}` });
      } else {
        setMessage({ type: "error", text: data.error ?? "Failed" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setGiving(null);
    }
  }

  const canManageOxide = server?.myRole === "owner" || server?.myRole === "admin";

  async function runOxidePermission(action: "grant" | "revoke") {
    setOxideMessage(null);
    const permission = oxidePerm.trim();
    if (!permission) {
      setOxideMessage({ type: "error", text: "Enter an Oxide permission (e.g. maxxinvaders.use)." });
      return;
    }
    setOxideBusy(action);
    try {
      const res = await fetch(`/api/servers/${serverId}/oxide-permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          subject: "user",
          subjectId: playerId,
          permission,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOxideMessage({
          type: "error",
          text: typeof data.error === "string" ? data.error : "Failed.",
        });
        return;
      }
      const resp =
        typeof (data as { response?: string }).response === "string"
          ? (data as { response: string }).response.trim()
          : "";
      setOxideMessage({
        type: "ok",
        text: resp || (action === "grant" ? "Granted." : "Revoked."),
      });
    } catch {
      setOxideMessage({ type: "error", text: "Network error." });
    } finally {
      setOxideBusy(null);
    }
  }

  async function runPlayerAction(command: string, actionLabel: string) {
    setMessage(null);
    setActionLoading(actionLabel);
    try {
      const res = await fetch(`/api/servers/${serverId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage({
          type: "ok",
          text: data.response ? String(data.response).trim() || "Done." : "Done.",
        });
      } else {
        setMessage({
          type: "error",
          text: data.error ?? "Failed.",
        });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/servers/${serverId}`} className="text-rust-cyan hover:underline">
          ← {server?.name ?? "Server"}
        </Link>
        <span className="text-zinc-500">/</span>
        <h1 className="text-xl font-semibold text-zinc-100">{name}</h1>
        <span className="text-sm text-zinc-500">({playerId})</span>
      </div>

      <p className="text-sm text-zinc-500">
        Give items to this player. Uses <code className="rounded bg-zinc-800 px-1">inventory.giveto</code> (Rust). Server must be connected.
      </p>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-2 text-lg font-medium text-zinc-300">Access overview</h2>
        {groupsLoading ? (
          <p className="text-sm text-zinc-500">Loading groups…</p>
        ) : groupSummary.length === 0 ? (
          <p className="text-sm text-zinc-500">
            This player is not currently reported in any Oxide groups on this server.
          </p>
        ) : (
          <ul className="space-y-3 text-sm">
            {groupSummary.map((g) => (
              <li key={g.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-zinc-800 px-2 py-1 font-medium text-rust-cyan">
                    {g.name}
                  </span>
                  <Link
                    href={`/servers/${serverId}/groups/${g.id}`}
                    className="text-xs text-zinc-400 hover:text-rust-cyan hover:underline"
                  >
                    Open group →
                  </Link>
                </div>
                {g.permissions.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1 text-xs text-zinc-300">
                    {g.permissions.map((p) => (
                      <span
                        key={p}
                        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canManageOxide && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <h2 className="mb-2 text-lg font-medium text-zinc-300">Plugin permission (Oxide)</h2>
          <p className="mb-3 text-xs text-zinc-500">
            Grant or revoke a single permission for this Steam ID on the live server (
            <code className="rounded bg-zinc-800 px-1">oxide.grant user …</code>). Prefer the plugin detail page to
            pick from the plugin&apos;s registered permissions list.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600"
              placeholder="permission.name"
              value={oxidePerm}
              onChange={(e) => setOxidePerm(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={oxideBusy !== null}
                onClick={() => runOxidePermission("grant")}
                className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {oxideBusy === "grant" ? "…" : "Grant"}
              </button>
              <button
                type="button"
                disabled={oxideBusy !== null}
                onClick={() => runOxidePermission("revoke")}
                className="rounded-lg border border-amber-800/80 bg-amber-950/40 px-3 py-2 text-sm font-medium text-amber-200 hover:bg-amber-900/30 disabled:opacity-50"
              >
                {oxideBusy === "revoke" ? "…" : "Revoke"}
              </button>
            </div>
          </div>
          {oxideMessage && (
            <p
              className={`mt-2 text-sm ${oxideMessage.type === "ok" ? "text-emerald-400" : "text-red-400"}`}
            >
              {oxideMessage.text}
            </p>
          )}
        </div>
      )}

      {message && (
        <p className={`text-sm ${message.type === "ok" ? "text-emerald-400" : "text-red-400"}`}>
          {message.text}
        </p>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-2 text-lg font-medium text-zinc-300">Player heal &amp; vitals</h2>
        <p className="mb-3 text-xs text-zinc-500">
          <code className="rounded bg-zinc-800 px-1">refillvitals</code> uses player name; <code className="rounded bg-zinc-800 px-1">killplayer</code> uses SteamID. Heal / Fill water / Fill food all run refillvitals (health + hunger + hydration).
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => runPlayerAction(`refillvitals "${name.replace(/"/g, '\\"')}"`, "heal")}
            disabled={actionLoading !== null}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-rust-glow-subtle hover:shadow-rust-glow disabled:opacity-50"
          >
            {actionLoading === "heal" ? "…" : "Heal"}
          </button>
          <button
            type="button"
            onClick={() => runPlayerAction(`killplayer ${playerId}`, "kill")}
            disabled={actionLoading !== null}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-rust-glow-subtle hover:shadow-rust-glow disabled:opacity-50"
          >
            {actionLoading === "kill" ? "…" : "Kill"}
          </button>
          <button
            type="button"
            onClick={() => runPlayerAction(`refillvitals "${name.replace(/"/g, '\\"')}"`, "water")}
            disabled={actionLoading !== null}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-rust-glow-subtle hover:shadow-rust-glow disabled:opacity-50"
          >
            {actionLoading === "water" ? "…" : "Fill water"}
          </button>
          <button
            type="button"
            onClick={() => runPlayerAction(`refillvitals "${name.replace(/"/g, '\\"')}"`, "food")}
            disabled={actionLoading !== null}
            className="rounded-lg bg-rust-cyan px-4 py-2 text-sm font-medium text-rust-panel shadow-rust-glow hover:shadow-rust-glow-lg disabled:opacity-50"
          >
            {actionLoading === "food" ? "…" : "Fill food"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 text-lg font-medium text-zinc-300">Give items</h2>
        {giveItems.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No items enabled yet. Go to the server&apos;s Items tab to choose which items can be
            given to players.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {giveItems.map((item) => (
              <li
                key={item.shortname}
                className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2"
              >
                <span className="text-zinc-200">
                  {item.label} <span className="text-zinc-500 text-xs">×{item.amount}</span>
                </span>
                <button
                  type="button"
                  onClick={() => giveItem(item.shortname, item.amount)}
                  disabled={giving !== null}
                  className="rounded bg-rust-cyan px-3 py-1 text-sm font-medium text-rust-panel shadow-rust-glow hover:shadow-rust-glow-lg disabled:opacity-50"
                >
                  {giving === item.shortname ? "…" : "Give"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function PlayerPage() {
  return (
    <Suspense fallback={<div className="p-4 text-zinc-500">Loading…</div>}>
      <PlayerContent />
    </Suspense>
  );
}
