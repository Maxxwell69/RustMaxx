"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type SiteRow = {
  id: string;
  message: string | null;
  status: string;
  reviewed_at: string | null;
  created_at: string;
} | null; // null = no row

type StreamerRow = {
  id: string;
  streamer_user_id: string;
  streamer_display_name: string | null;
  streamer_stream_name: string | null;
  status: string;
  created_at: string;
};

export default function ViewerSuperfanPage() {
  const [auth, setAuth] = useState<"unknown" | "in" | "out">("unknown");
  const [site, setSite] = useState<SiteRow | undefined>(undefined);
  const [streamers, setStreamers] = useState<StreamerRow[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/auth/me")
      .then((r) => {
        if (!r.ok) {
          setAuth("out");
          return;
        }
        setAuth("in");
        return fetch("/api/viewer/superfan/me").then((r2) => {
          if (!r2.ok) return null;
          return r2.json();
        });
      })
      .then((data) => {
        if (data && typeof data === "object") {
          setSite((data.site ?? null) as SiteRow);
          setStreamers(Array.isArray(data.streamers) ? data.streamers : []);
        } else {
          setSite(null);
          setStreamers([]);
        }
      })
      .catch(() => setAuth("out"));
  }

  useEffect(() => {
    load();
  }, []);

  async function submitSite() {
    setErr("");
    setSaving(true);
    try {
      const res = await fetch("/api/viewer/superfan/site-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof data.error === "string" ? data.error : "Failed");
        return;
      }
      setMessage("");
      load();
    } catch {
      setErr("Network error");
    } finally {
      setSaving(false);
    }
  }

  if (auth === "unknown" || (auth === "in" && site === undefined)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <p className="text-sm text-zinc-500">Loading…</p>
      </div>
    );
  }

  if (auth === "out") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-semibold text-zinc-100">Viewer superfans</h1>
        <p className="mt-2 text-sm text-zinc-400">
          <Link href="/login" className="text-rust-cyan hover:underline">
            Log in
          </Link>{" "}
          to apply. Fans who sign up as viewers are approved automatically; then you can request access from individual
          streamers (each streamer still approves you).
        </p>
      </div>
    );
  }

  const status = site?.status;

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-semibold text-zinc-100">Viewer superfans</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Submit once below (you are approved immediately — no staff wait). Fans who picked Fan / viewer at signup are
        usually already on file. Then open a streamer in the{" "}
        <Link href="/streamers" className="text-rust-cyan hover:underline">
          directory
        </Link>{" "}
        and use Request superfan access on their profile. Each streamer still approves you for their channel.
      </p>

      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h2 className="text-sm font-medium text-zinc-200">Site access</h2>
        {status === "approved" ? (
          <p className="mt-2 text-sm text-emerald-400">
            You can request streamers from their profiles. Each streamer approves you separately for their channel.
          </p>
        ) : status === "pending" ? (
          <p className="mt-2 text-sm text-zinc-400">
            You started before auto-approval — click <strong className="text-zinc-300">Submit application</strong>{" "}
            below once to activate; you will be approved immediately.
          </p>
        ) : status === "rejected" ? (
          <p className="mt-2 text-sm text-amber-200/90">Not approved. You can submit a new message below.</p>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">You have not applied yet.</p>
        )}

        {status !== "approved" && (
          <>
            <textarea
              className="mt-4 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
              rows={4}
              placeholder="Optional note (for your own reference or if a streamer asks)"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button
              type="button"
              disabled={saving}
              onClick={submitSite}
              className="mt-3 rounded bg-rust-cyan px-4 py-2 text-sm font-medium text-rust-panel shadow-rust-glow hover:opacity-95 disabled:opacity-50"
            >
              {saving ? "…" : status === "pending" ? "Activate access" : "Submit application"}
            </button>
          </>
        )}
        {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
      </section>

      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h2 className="text-sm font-medium text-zinc-200">Streamer requests</h2>
        {streamers.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">
            None yet. Browse{" "}
            <Link href="/streamers" className="text-rust-cyan hover:underline">
              streamers
            </Link>{" "}
            and use &quot;Superfans&quot; on their profile.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {streamers.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-950/50 px-3 py-2"
              >
                <span className="text-zinc-200">
                  {s.streamer_stream_name || s.streamer_display_name || "Streamer"}
                </span>
                <span
                  className={
                    s.status === "approved"
                      ? "text-emerald-400"
                      : s.status === "pending"
                        ? "text-amber-200"
                        : "text-zinc-500"
                  }
                >
                  {s.status}
                </span>
                {s.status === "approved" && (
                  <Link
                    href={`/viewer/interact/${s.streamer_user_id}`}
                    className="text-rust-cyan hover:underline"
                  >
                    Interaction page →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
