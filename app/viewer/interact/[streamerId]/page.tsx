"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

type ClubTier = "fan" | "superfan" | "mod";

type BoardSlot = { action_key: string; label: string; sort_order: number; server_id: string | null };

type MemberRow = {
  id: string;
  viewer_user_id: string;
  viewer_email: string;
  viewer_display_name: string | null;
  club_tier: ClubTier | null;
};

function tierLabel(t: ClubTier | null): string {
  if (t === "mod") return "Mod";
  if (t === "superfan") return "Superfan";
  if (t === "fan") return "Fan";
  return "Member";
}

function ViewerInteractContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const streamerId = typeof params.streamerId === "string" ? params.streamerId : "";
  const isPreview = searchParams.get("preview") === "1";

  const [state, setState] = useState<"load" | "deny" | "ok">("load");
  const [previewMode, setPreviewMode] = useState(false);
  const [clubTier, setClubTier] = useState<ClubTier | null>(null);
  const [boards, setBoards] = useState<Record<string, BoardSlot[]>>({});
  const [err, setErr] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [modMembers, setModMembers] = useState<MemberRow[]>([]);
  const [modBusy, setModBusy] = useState<string | null>(null);
  const [tierSettings, setTierSettings] = useState<
    Record<string, { cooldown_seconds: number; max_buttons: number | null }> | null
  >(null);

  const loadBoards = useCallback(() => {
    if (!streamerId) return;
    const q = new URLSearchParams({ streamer_id: streamerId });
    if (isPreview) q.set("preview", "1");
    fetch(`/api/viewer/fan-board?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("board"))))
      .then((data) => {
        setPreviewMode(data.preview === true);
        setClubTier(data.club_tier ?? null);
        setBoards(typeof data.boards === "object" && data.boards ? data.boards : {});
        setTierSettings(
          data.tier_settings && typeof data.tier_settings === "object" ? data.tier_settings : null
        );
      })
      .catch(() => setErr("Could not load fan boards."));
  }, [streamerId, isPreview]);

  useEffect(() => {
    if (!streamerId) {
      setState("deny");
      return;
    }
    let cancelled = false;

    if (isPreview) {
      fetch(
        `/api/viewer/fan-board?streamer_id=${encodeURIComponent(streamerId)}&preview=1`
      )
        .then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok) {
            if (!cancelled) {
              setErr(typeof data.error === "string" ? data.error : "Could not load preview.");
              setState("deny");
            }
            return null;
          }
          return data;
        })
        .then((data) => {
          if (cancelled || !data) return;
          setPreviewMode(true);
          setClubTier(null);
          setBoards(typeof data.boards === "object" && data.boards ? data.boards : {});
          setTierSettings(
            data.tier_settings && typeof data.tier_settings === "object" ? data.tier_settings : null
          );
          setState("ok");
        })
        .catch(() => {
          if (!cancelled) setState("deny");
        });
      return () => {
        cancelled = true;
      };
    }

    fetch(`/api/viewer/superfan/access?streamer_id=${encodeURIComponent(streamerId)}`)
      .then((r) => {
        if (!r.ok) {
          if (!cancelled) setState("deny");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data?.allowed === true) {
          setState("ok");
          loadBoards();
        } else setState("deny");
      })
      .catch(() => {
        if (!cancelled) setState("deny");
      });
    return () => {
      cancelled = true;
    };
  }, [streamerId, isPreview, loadBoards]);

  useEffect(() => {
    if (state !== "ok" || clubTier !== "mod" || !streamerId || previewMode) return;
    fetch(`/api/viewer/fan-club/members?streamer_id=${encodeURIComponent(streamerId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.members) setModMembers(d.members);
      })
      .catch(() => {});
  }, [state, clubTier, streamerId, previewMode]);

  async function trigger(boardTier: ClubTier, actionKey: string) {
    if (previewMode) return;
    const key = `${boardTier}:${actionKey}`;
    setBusyAction(key);
    setErr("");
    try {
      const res = await fetch("/api/viewer/fan-board/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamer_id: streamerId, board_tier: boardTier, action_key: actionKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setErr(typeof data.error === "string" ? data.error : "Please wait before another action on this board.");
        return;
      }
      if (!res.ok) {
        setErr(typeof data.error === "string" ? data.error : "Action failed");
        return;
      }
    } catch {
      setErr("Network error");
    } finally {
      setBusyAction(null);
    }
  }

  async function modRevoke(membershipId: string) {
    setModBusy(membershipId);
    setErr("");
    try {
      const res = await fetch("/api/viewer/fan-club/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamer_id: streamerId, membership_id: membershipId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof data.error === "string" ? data.error : "Remove failed");
        return;
      }
      setModMembers((prev) => prev.filter((m) => m.id !== membershipId));
    } catch {
      setErr("Network error");
    } finally {
      setModBusy(null);
    }
  }

  if (state === "load") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <p className="text-sm text-zinc-500">Loading…</p>
      </div>
    );
  }

  if (state === "deny") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-xl font-semibold text-zinc-100">
          {isPreview ? "Preview unavailable" : "Access required"}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {isPreview ? (
            <>
              {err ||
                "Open Preview boards from the Streamer interactions page while logged in as an approved streamer, or check that your streamer application is approved."}{" "}
              <Link href="/streamer" className="text-rust-cyan hover:underline">
                Streamer setup
              </Link>
            </>
          ) : (
            <>
              You need the streamer to approve you for their fan club. Apply from{" "}
              <Link href="/viewer/superfan" className="text-rust-cyan hover:underline">
                viewer superfans
              </Link>{" "}
              and the streamer&apos;s public profile.
            </>
          )}
        </p>
      </div>
    );
  }

  const boardOrder: { tier: ClubTier; title: string }[] = [
    { tier: "fan", title: "Fan board" },
    { tier: "superfan", title: "Superfan board" },
    { tier: "mod", title: "Mod board" },
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <p className="text-sm text-zinc-500">
        <Link href="/viewer/superfan" className="text-rust-cyan hover:underline">
          ← Fan club home
        </Link>
        {previewMode ? (
          <>
            {" · "}
            <Link href="/streamer/superfan" className="text-rust-cyan hover:underline">
              Edit boards
            </Link>
          </>
        ) : null}
      </p>
      <h1 className="mt-4 text-2xl font-semibold text-zinc-100">Fan boards</h1>
      {previewMode ? (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100/95">
          <strong className="text-amber-50">Preview</strong> — you&apos;re seeing all three boards as fans will (by
          tier). Buttons do not send RCON. Use{" "}
          <Link href="/streamer/superfan" className="underline hover:text-white">
            Fan club
          </Link>{" "}
          to change actions.
        </div>
      ) : (
        <p className="mt-2 text-sm text-zinc-400">
          Your tier: <span className="text-zinc-200">{tierLabel(clubTier)}</span>. Buttons run the streamer&apos;s Rust
          server actions (RCON). Cooldowns and server rules still apply in-game.
        </p>
      )}

      {err && state === "ok" && <p className="mt-4 text-sm text-red-400">{err}</p>}

      <div className="mt-8 space-y-10">
        {!boardOrder.some(({ tier }) => (boards[tier]?.length ?? 0) > 0) && (
          <p className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-6 text-sm text-zinc-500">
            {previewMode
              ? "No buttons on your boards yet. Add actions under Fan club → Fan boards."
              : "This streamer has not configured fan board buttons yet, or none apply to your tier. Check back later or message them."}
          </p>
        )}
        {boardOrder.map(({ tier, title }) => {
          const slots = boards[tier] ?? [];
          if (slots.length === 0) return null;
          return (
            <section key={tier} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
              {tierSettings?.[tier] ? (
                <p className="mt-1 text-xs text-zinc-500">
                  {tierSettings[tier]!.cooldown_seconds <= 0
                    ? "No cooldown between button presses."
                    : `At least ${tierSettings[tier]!.cooldown_seconds}s between button presses on this board.`}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {slots.map((s) => {
                  const key = `${tier}:${s.action_key}`;
                  const loading = busyAction === key;
                  return (
                    <button
                      key={s.action_key}
                      type="button"
                      disabled={loading || previewMode}
                      onClick={() => trigger(tier, s.action_key)}
                      title={previewMode ? "Preview only — not sent to server" : undefined}
                      className="rounded-lg border border-rust-cyan/40 bg-rust-cyan/10 px-3 py-2 text-sm font-medium text-rust-cyan hover:bg-rust-cyan/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? "…" : s.label}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {!previewMode && clubTier === "mod" && (
        <section className="mt-12 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h2 className="text-sm font-semibold text-amber-100/90">Mod tools — remove fans</h2>
          <p className="mt-1 text-xs text-zinc-500">
            You can remove fans and superfans from this channel. You cannot remove other mods — the streamer does that.
          </p>
          {modMembers.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No members loaded.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {modMembers.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm"
                >
                  <div>
                    <span className="text-zinc-200">{m.viewer_display_name || m.viewer_email}</span>
                    <span className="ml-2 text-xs text-zinc-500">
                      {m.club_tier} · {m.viewer_email}
                    </span>
                  </div>
                  {m.club_tier !== "mod" ? (
                    <button
                      type="button"
                      disabled={modBusy !== null}
                      onClick={() => modRevoke(m.id)}
                      className="rounded border border-red-500/50 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      {modBusy === m.id ? "…" : "Remove"}
                    </button>
                  ) : (
                    <span className="text-xs text-zinc-600">Mod</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

export default function ViewerInteractPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl px-4 py-12">
          <p className="text-sm text-zinc-500">Loading…</p>
        </div>
      }
    >
      <ViewerInteractContent />
    </Suspense>
  );
}
