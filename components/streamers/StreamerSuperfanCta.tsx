"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type MeResponse = {
  site: { status: string } | null;
  streamers: { streamer_user_id: string; status: string }[];
};

export function StreamerSuperfanCta(props: {
  streamerId: string;
  streamerLabel: string;
  hideForSelf: boolean;
}) {
  const { streamerId, streamerLabel, hideForSelf } = props;
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => {
        if (!cancelled) setLoggedIn(r.ok);
        if (!r.ok) {
          if (!cancelled) setMe(null);
          return;
        }
        return fetch("/api/viewer/superfan/me").then((r2) => (r2.ok ? r2.json() : null));
      })
      .then((data) => {
        if (cancelled) return;
        setMe(data ? (data as MeResponse) : null);
      })
      .catch(() => {
        if (!cancelled) {
          setLoggedIn(false);
          setMe(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (hideForSelf) return null;

  const row = me?.streamers?.find((s) => s.streamer_user_id === streamerId);
  const siteStatus = me?.site?.status;

  async function submitRequest() {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/viewer/superfan/streamer-request", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamer_id: streamerId, message: msg.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Request failed");
        return;
      }
      const r2 = await fetch("/api/viewer/superfan/me").then((r) => r.json());
      setMe(r2 as MeResponse);
      setMsg("");
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 border-t border-zinc-800 pt-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Superfans</h2>
      <p className="mt-2 text-sm text-zinc-400">
        After RustMaxx approves you for viewer superfans, you can request access here. This streamer then approves you
        for their channel and you can use their{" "}
        <Link href={`/viewer/interact/${streamerId}`} className="text-rust-cyan hover:underline">
          fan boards
        </Link>
        . Fans who picked the Fan / viewer role at signup are usually approved automatically at registration;
        everyone else applies on{" "}
        <Link href="/viewer/superfan" className="text-rust-cyan hover:underline">
          viewer superfans
        </Link>{" "}
        first.
      </p>

      {loggedIn === false && (
        <p className="mt-3 text-sm text-zinc-500">
          <Link href="/login" className="text-rust-cyan hover:underline">
            Log in
          </Link>{" "}
          to request access.
        </p>
      )}

      {loggedIn && me === undefined && <p className="mt-3 text-sm text-zinc-500">Loading…</p>}

      {loggedIn && me !== undefined && me !== null && (
        <div className="mt-4 space-y-3">
          {!siteStatus || siteStatus === "rejected" ? (
            <p className="text-sm text-amber-200/90">
              Complete the site application first:{" "}
              <Link href="/viewer/superfan" className="text-rust-cyan hover:underline">
                Apply for superfans
              </Link>
            </p>
          ) : siteStatus === "pending" ? (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-3 text-sm text-amber-100/95">
              <p className="font-medium text-amber-50">Nothing has been sent to {streamerLabel} yet</p>
              <p className="mt-2 text-amber-100/85">
                Your viewer superfan application is waiting on RustMaxx staff. Until it is approved, you cannot submit a
                channel request, and this streamer will not see you under Fan club → Requests.
              </p>
              <p className="mt-2 text-xs text-amber-200/80">
                <Link href="/viewer/superfan" className="font-medium text-rust-cyan hover:underline">
                  Check your application status
                </Link>
              </p>
            </div>
          ) : siteStatus === "approved" && row?.status === "approved" ? (
            <p className="text-sm text-emerald-400">
              You have superfan access.{" "}
              <Link
                href={`/viewer/interact/${streamerId}`}
                className="font-medium text-rust-cyan hover:underline"
              >
                Open interaction page
              </Link>
            </p>
          ) : siteStatus === "approved" && row?.status === "pending" ? (
            <p className="text-sm text-zinc-400">Your request to {streamerLabel} is pending.</p>
          ) : siteStatus === "approved" && row?.status === "rejected" ? (
            <div className="space-y-2">
              <p className="text-sm text-zinc-500">This streamer declined a previous request. You can send another.</p>
              <textarea
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
                rows={2}
                placeholder="Optional message to the streamer"
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
              />
              <button
                type="button"
                disabled={busy}
                onClick={submitRequest}
                className="rounded bg-rust-cyan px-4 py-2 text-sm font-medium text-rust-panel shadow-rust-glow hover:opacity-95 disabled:opacity-50"
              >
                {busy ? "…" : "Request again"}
              </button>
            </div>
          ) : siteStatus === "approved" && !row ? (
            <div className="space-y-2">
              <textarea
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
                rows={2}
                placeholder="Optional message to the streamer"
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
              />
              <button
                type="button"
                disabled={busy}
                onClick={submitRequest}
                className="rounded bg-rust-cyan px-4 py-2 text-sm font-medium text-rust-panel shadow-rust-glow hover:opacity-95 disabled:opacity-50"
              >
                {busy ? "…" : "Request superfan access"}
              </button>
            </div>
          ) : null}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      )}

      {loggedIn && me === null && (
        <p className="mt-3 text-sm text-amber-400">Could not load superfan status. Try refreshing.</p>
      )}
    </div>
  );
}
