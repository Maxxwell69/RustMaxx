"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Row = {
  id: string;
  user_id: string;
  applicant_email: string;
  applicant_display_name: string | null;
  preferred_stream_name: string;
  tiktok_url: string | null;
  twitch_url: string | null;
  kick_url: string | null;
  youtube_url: string | null;
  twitter_url: string | null;
  instagram_url: string | null;
  discord_username: string | null;
  other_socials: string | null;
  avg_live_viewers: string | null;
  stream_schedule: string | null;
  content_summary: string;
  why_rustmaxx: string;
  status: string;
  reviewed_at: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
};

export default function AdminStreamerApplicationsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<"pending" | "all" | "approved" | "rejected">("pending");
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const q =
      filter === "all"
        ? ""
        : `?status=${filter === "pending" ? "pending" : filter === "approved" ? "approved" : "rejected"}`;
    fetch(`/api/admin/streamer-applications${q}`)
      .then((r) => {
        if (r.status === 403) {
          setForbidden(true);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (cancelled) return;
        if (d?.applications) setRows(d.applications);
        else setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  async function decide(id: string, decision: "approve" | "reject") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/streamer-applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          decision,
          admin_notes: notes[id]?.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof data.error === "string" ? data.error : "Failed");
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
      setExpanded(null);
    } finally {
      setBusyId(null);
    }
  }

  if (loading && rows.length === 0 && !forbidden) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <p className="text-zinc-500">Loading…</p>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <p className="text-zinc-400">Super admin access required.</p>
        <Link href="/admin" className="mt-4 inline-block text-rust-cyan hover:underline">
          ← Admin
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/admin" className="text-rust-cyan hover:underline">
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-100">Streamer applications</h1>
      </div>
      <p className="text-sm text-zinc-500">
        Review stream name, social URLs, and fit. Approving sets the user&apos;s role to <strong className="text-zinc-400">streamer</strong> when they are
        still guest or player.
      </p>

      <div className="flex flex-wrap gap-2">
        {(["pending", "all", "approved", "rejected"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              filter === f
                ? "bg-rust-cyan text-rust-panel"
                : "border border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
            }`}
          >
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-zinc-500">No applications in this view.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-zinc-200">{r.preferred_stream_name}</p>
                  <p className="text-sm text-zinc-500">
                    {r.applicant_email}
                    {r.applicant_display_name ? ` · ${r.applicant_display_name}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-zinc-600">
                    Status: {r.status} · Updated {new Date(r.updated_at).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setExpanded((e) => (e === r.id ? null : r.id))}
                  className="text-sm text-rust-cyan hover:underline"
                >
                  {expanded === r.id ? "Hide" : "Details"}
                </button>
              </div>

              {expanded === r.id && (
                <div className="mt-4 space-y-3 border-t border-zinc-800 pt-4 text-sm">
                  <div className="grid gap-2 text-zinc-400 sm:grid-cols-2">
                    {r.tiktok_url && (
                      <p>
                        TikTok:{" "}
                        <a href={r.tiktok_url} className="text-rust-cyan hover:underline" target="_blank" rel="noreferrer">
                          link
                        </a>
                      </p>
                    )}
                    {r.twitch_url && (
                      <p>
                        Twitch:{" "}
                        <a href={r.twitch_url} className="text-rust-cyan hover:underline" target="_blank" rel="noreferrer">
                          link
                        </a>
                      </p>
                    )}
                    {r.kick_url && (
                      <p>
                        Kick:{" "}
                        <a href={r.kick_url} className="text-rust-cyan hover:underline" target="_blank" rel="noreferrer">
                          link
                        </a>
                      </p>
                    )}
                    {r.youtube_url && (
                      <p>
                        YouTube:{" "}
                        <a href={r.youtube_url} className="text-rust-cyan hover:underline" target="_blank" rel="noreferrer">
                          link
                        </a>
                      </p>
                    )}
                    {r.twitter_url && (
                      <p>
                        X:{" "}
                        <a href={r.twitter_url} className="text-rust-cyan hover:underline" target="_blank" rel="noreferrer">
                          link
                        </a>
                      </p>
                    )}
                    {r.instagram_url && (
                      <p>
                        Instagram:{" "}
                        <a href={r.instagram_url} className="text-rust-cyan hover:underline" target="_blank" rel="noreferrer">
                          link
                        </a>
                      </p>
                    )}
                    {r.discord_username && <p>Discord: {r.discord_username}</p>}
                  </div>
                  {r.other_socials && (
                    <div>
                      <p className="text-xs font-medium uppercase text-zinc-500">Other socials</p>
                      <p className="whitespace-pre-wrap text-zinc-300">{r.other_socials}</p>
                    </div>
                  )}
                  {(r.avg_live_viewers || r.stream_schedule) && (
                    <div className="text-zinc-400">
                      {r.avg_live_viewers && <p>Viewers: {r.avg_live_viewers}</p>}
                      {r.stream_schedule && (
                        <p className="mt-1 whitespace-pre-wrap">Schedule: {r.stream_schedule}</p>
                      )}
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-medium uppercase text-zinc-500">What they stream</p>
                    <p className="whitespace-pre-wrap text-zinc-300">{r.content_summary}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-zinc-500">Why RustMaxx</p>
                    <p className="whitespace-pre-wrap text-zinc-300">{r.why_rustmaxx}</p>
                  </div>
                  {r.status === "rejected" && r.admin_notes && (
                    <p className="text-xs text-amber-400/90">Previous note: {r.admin_notes}</p>
                  )}

                  {r.status === "pending" && (
                    <div className="space-y-2 pt-2">
                      <label className="block text-xs text-zinc-500">
                        Internal note (optional; shown to applicant on rejection)
                        <textarea
                          value={notes[r.id] ?? ""}
                          onChange={(e) =>
                            setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))
                          }
                          rows={2}
                          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-200"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void decide(r.id, "approve")}
                          className="rounded-lg bg-emerald-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                        >
                          {busyId === r.id ? "…" : "Approve"}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void decide(r.id, "reject")}
                          className="rounded-lg border border-red-500/60 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
