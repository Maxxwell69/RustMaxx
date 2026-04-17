"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ClubTier = "fan" | "superfan" | "mod";

/** Mirrors lib/streamer-fan-board (client-safe; avoid importing server db). */
const MAX_FAN_BOARD_BUTTONS: Record<ClubTier, number | null> = {
  fan: 5,
  superfan: 10,
  mod: null,
};

type Req = {
  id: string;
  viewer_user_id: string;
  viewer_email: string;
  viewer_display_name: string | null;
  message: string | null;
  status: string;
  club_tier: ClubTier | null;
  created_at: string;
};

type ActionOpt = { action: string; label: string; description: string };
type ServerOpt = { id: string; name: string | null };

type MemberRow = {
  id: string;
  viewer_user_id: string;
  viewer_email: string;
  viewer_display_name: string | null;
  club_tier: ClubTier | null;
};

type Tab = "requests" | "boards" | "members";

export default function StreamerSuperfanIncomingPage() {
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("requests");
  const [rows, setRows] = useState<Req[]>([]);
  const [err, setErr] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [approveTier, setApproveTier] = useState<Record<string, ClubTier>>({});

  const [actions, setActions] = useState<ActionOpt[]>([]);
  const [servers, setServers] = useState<ServerOpt[]>([]);
  const [slots, setSlots] = useState<
    { id: string; board_tier: string; action_key: string; sort_order: number; server_id: string | null }[]
  >([]);
  const [boardEditTier, setBoardEditTier] = useState<ClubTier>("fan");
  const [selectedActions, setSelectedActions] = useState<Set<string>>(new Set());
  const [boardServerId, setBoardServerId] = useState<string>("");
  const [boardSaving, setBoardSaving] = useState(false);

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);

  const [cooldownDraft, setCooldownDraft] = useState<Record<ClubTier, number>>({
    fan: 30,
    superfan: 30,
    mod: 0,
  });

  function loadRequests() {
    fetch("/api/streamer/superfan/incoming")
      .then((r) => {
        if (r.status === 403) {
          setForbidden(true);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (d?.requests) setRows(d.requests);
        else setRows([]);
      })
      .catch(() => setErr("Failed to load"));
  }

  function loadFanBoard() {
    fetch("/api/streamer/fan-board")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        if (Array.isArray(d.actions)) setActions(d.actions);
        if (Array.isArray(d.servers)) setServers(d.servers);
        if (Array.isArray(d.slots)) setSlots(d.slots);
        if (d.settings && typeof d.settings === "object") {
          const s = d.settings as Record<string, { cooldown_seconds?: number }>;
          setCooldownDraft((prev) => ({
            fan: typeof s.fan?.cooldown_seconds === "number" ? s.fan.cooldown_seconds : prev.fan,
            superfan:
              typeof s.superfan?.cooldown_seconds === "number" ? s.superfan.cooldown_seconds : prev.superfan,
            mod: typeof s.mod?.cooldown_seconds === "number" ? s.mod.cooldown_seconds : prev.mod,
          }));
        }
      })
      .catch(() => {});
  }

  function loadMembers() {
    fetch("/api/streamer/fan-club/members")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.members) setMembers(d.members);
        else setMembers([]);
      })
      .catch(() => {});
  }

  useEffect(() => {
    loadRequests();
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { id?: string } | null) => {
        if (d && typeof d.id === "string") setMyUserId(d.id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === "boards") loadFanBoard();
    if (tab === "members") loadMembers();
  }, [tab]);

  useEffect(() => {
    const forTier = slots.filter((s) => s.board_tier === boardEditTier).map((s) => s.action_key);
    setSelectedActions(new Set(forTier));
    const firstSlot = slots.find((s) => s.board_tier === boardEditTier);
    setBoardServerId(firstSlot?.server_id ?? servers[0]?.id ?? "");
  }, [boardEditTier, slots, servers]);

  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(id);
    setErr("");
    try {
      const tier = approveTier[id] ?? "fan";
      const res = await fetch(`/api/streamer/superfan/incoming/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: decision === "approve" ? "approve" : "reject",
          ...(decision === "approve" ? { initial_tier: tier } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof data.error === "string" ? data.error : "Failed");
        return;
      }
      loadRequests();
    } finally {
      setBusy(null);
    }
  }

  async function saveBoard() {
    setBoardSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/streamer/fan-board", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: boardEditTier,
          actions: [...selectedActions],
          server_id: boardServerId || null,
          cooldown_seconds: cooldownDraft[boardEditTier],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof data.error === "string" ? data.error : "Save failed");
        return;
      }
      loadFanBoard();
    } finally {
      setBoardSaving(false);
    }
  }

  function toggleAction(key: string) {
    setSelectedActions((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else {
        const maxB = MAX_FAN_BOARD_BUTTONS[boardEditTier];
        if (maxB !== null && n.size >= maxB) return prev;
        n.add(key);
      }
      return n;
    });
  }

  async function updateMemberTier(id: string, club_tier: ClubTier) {
    setMemberBusy(id);
    setErr("");
    try {
      const res = await fetch(`/api/streamer/fan-club/members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ club_tier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof data.error === "string" ? data.error : "Update failed");
        return;
      }
      loadMembers();
    } finally {
      setMemberBusy(null);
    }
  }

  async function revokeMember(id: string) {
    setMemberBusy(id);
    setErr("");
    try {
      const res = await fetch(`/api/streamer/fan-club/members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revoke: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof data.error === "string" ? data.error : "Remove failed");
        return;
      }
      loadMembers();
    } finally {
      setMemberBusy(null);
    }
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-xl font-semibold text-zinc-100">Fan club</h1>
        <p className="mt-2 text-sm text-zinc-500">
          This page is only for accounts with an approved streamer application.{" "}
          <Link href="/streamer" className="text-rust-cyan hover:underline">
            Streamer hub
          </Link>
        </p>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "requests", label: "Requests" },
    { id: "boards", label: "Fan boards" },
    { id: "members", label: "Members" },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold text-zinc-100">Fan club</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Approve fans with a tier (Fan, Superfan, or Mod). Configure action buttons per board. Mods can remove fans
        from the fan interaction page; you can remove anyone including mods.
      </p>

      {myUserId ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-rust-cyan/30 bg-rust-cyan/5 px-4 py-3">
          <span className="text-sm text-zinc-300">See your boards as fans will (preview, no RCON):</span>
          <Link
            href={`/viewer/interact/${myUserId}?preview=1`}
            className="inline-flex items-center rounded-lg bg-rust-cyan px-3 py-1.5 text-sm font-medium text-zinc-950 hover:opacity-95"
          >
            Open board pages
          </Link>
          <Link href="/streamer" className="text-sm text-zinc-500 hover:text-zinc-300">
            ← Streamer setup
          </Link>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2 border-b border-zinc-800 pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              tab === t.id ? "bg-rust-cyan/20 text-rust-cyan" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {err && <p className="mt-4 text-sm text-red-400">{err}</p>}

      {tab === "requests" && (
        <>
          {rows.length === 0 ? (
            <p className="mt-8 text-sm text-zinc-500">No requests yet.</p>
          ) : (
            <ul className="mt-8 space-y-4">
              {rows.map((r) => (
                <li key={r.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-zinc-200">{r.viewer_display_name || r.viewer_email}</p>
                      <p className="text-xs text-zinc-500">{r.viewer_email}</p>
                      {r.message ? (
                        <p className="mt-2 text-sm text-zinc-400 whitespace-pre-wrap">{r.message}</p>
                      ) : null}
                      <p className="mt-2 text-xs text-zinc-600">
                        {r.status}
                        {r.club_tier ? ` · tier ${r.club_tier}` : ""} · {new Date(r.created_at).toLocaleString()}
                      </p>
                    </div>
                    {r.status === "pending" && (
                      <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
                        <label className="flex items-center gap-1 text-xs text-zinc-400">
                          Tier
                          <select
                            value={approveTier[r.id] ?? "fan"}
                            onChange={(e) =>
                              setApproveTier((prev) => ({
                                ...prev,
                                [r.id]: e.target.value as ClubTier,
                              }))
                            }
                            className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-200"
                          >
                            <option value="fan">Fan</option>
                            <option value="superfan">Superfan</option>
                            <option value="mod">Mod</option>
                          </select>
                        </label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => decide(r.id, "approve")}
                            className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                          >
                            {busy === r.id ? "…" : "Approve"}
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => decide(r.id, "reject")}
                            className="rounded border border-zinc-600 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "boards" && (
        <div className="mt-8 space-y-4">
          {myUserId ? (
            <p className="text-sm text-zinc-300">
              <Link
                href={`/viewer/interact/${myUserId}?preview=1`}
                className="font-medium text-rust-cyan hover:underline"
              >
                View board pages
              </Link>{" "}
              — same layout fans get (preview mode; buttons don&apos;t send commands).
            </p>
          ) : null}
          <p className="text-sm text-zinc-500">
            Only actions enabled on your webhook server(s) appear here. Fans see buttons for each board they can
            access (Fan → fan board only; Superfan → fan + superfan; Mod → all boards + mod tools).
          </p>
          <div className="flex flex-wrap gap-2">
            {(["fan", "superfan", "mod"] as ClubTier[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setBoardEditTier(t)}
                className={`rounded px-3 py-1 text-xs font-medium capitalize ${
                  boardEditTier === t ? "bg-zinc-700 text-zinc-100" : "bg-zinc-900 text-zinc-400"
                }`}
              >
                {t} board
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500">
            Limits: <strong className="text-zinc-400">Fan</strong> up to 5 buttons ·{" "}
            <strong className="text-zinc-400">Superfan</strong> up to 10 ·{" "}
            <strong className="text-zinc-400">Mod</strong> all enabled actions.
          </p>
          <label className="block text-sm text-zinc-300">
            Cooldown — minimum seconds between any two button presses on this board (same viewer)
            <input
              type="number"
              min={0}
              max={3600}
              value={cooldownDraft[boardEditTier]}
              onChange={(e) => {
                const v = Math.min(3600, Math.max(0, parseInt(e.target.value, 10) || 0));
                setCooldownDraft((prev) => ({ ...prev, [boardEditTier]: v }));
              }}
              className="mt-1 block w-full max-w-[12rem] rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
            <span className="mt-1 block text-xs text-zinc-500">
              Defaults: Fan 30s, Superfan 30s, Mod 0 (no wait). Saved with this board.
            </span>
          </label>
          {servers.length > 0 && (
            <label className="block text-xs text-zinc-400">
              RCON target server for this board
              <select
                value={boardServerId}
                onChange={(e) => setBoardServerId(e.target.value)}
                className="mt-1 block w-full max-w-md rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-200"
              >
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name ?? s.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          {actions.length === 0 ? (
            <p className="text-sm text-amber-200/80">
              No actions available — add a streamer webhook and ensure the server owner enabled streamer actions.
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded border border-zinc-800 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {actions.map((a) => (
                  <label key={a.action} className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={selectedActions.has(a.action)}
                      onChange={() => toggleAction(a.action)}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium text-zinc-200">{a.label}</span>
                      <span className="block text-xs text-zinc-500">{a.action}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <button
            type="button"
            disabled={boardSaving || servers.length === 0}
            onClick={saveBoard}
            className="rounded bg-rust-cyan px-4 py-2 text-sm font-medium text-rust-panel hover:opacity-95 disabled:opacity-50"
          >
            {boardSaving ? "Saving…" : `Save ${boardEditTier} board`}
          </button>
        </div>
      )}

      {tab === "members" && (
        <div className="mt-8">
          {members.length === 0 ? (
            <p className="text-sm text-zinc-500">No active members.</p>
          ) : (
            <ul className="space-y-3">
              {members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                  <div>
                    <p className="text-sm text-zinc-200">{m.viewer_display_name || m.viewer_email}</p>
                    <p className="text-xs text-zinc-500">{m.viewer_email}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={m.club_tier ?? "fan"}
                      disabled={memberBusy === m.id}
                      onChange={(e) => updateMemberTier(m.id, e.target.value as ClubTier)}
                      className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 capitalize"
                    >
                      <option value="fan">Fan</option>
                      <option value="superfan">Superfan</option>
                      <option value="mod">Mod</option>
                    </select>
                    <button
                      type="button"
                      disabled={memberBusy !== null}
                      onClick={() => revokeMember(m.id)}
                      className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      {memberBusy === m.id ? "…" : "Remove"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
