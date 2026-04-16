"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Req = {
  id: string;
  viewer_user_id: string;
  viewer_email: string;
  viewer_display_name: string | null;
  message: string | null;
  status: string;
  created_at: string;
};

export default function StreamerSuperfanIncomingPage() {
  const [rows, setRows] = useState<Req[]>([]);
  const [err, setErr] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
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

  useEffect(() => {
    load();
  }, []);

  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(id);
    setErr("");
    try {
      const res = await fetch(`/api/streamer/superfan/incoming/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: decision === "approve" ? "approve" : "reject" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof data.error === "string" ? data.error : "Failed");
        return;
      }
      load();
    } finally {
      setBusy(null);
    }
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-xl font-semibold text-zinc-100">Superfan requests</h1>
        <p className="mt-2 text-sm text-zinc-500">
          This page is only for accounts with an approved streamer application.{" "}
          <Link href="/streamer" className="text-rust-cyan hover:underline">
            Streamer hub
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold text-zinc-100">Superfan requests</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Viewers who completed the site application can ask to become your superfan. Approve to let them use your
        interaction page.
      </p>

      {err && <p className="mt-4 text-sm text-red-400">{err}</p>}

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
                    {r.status} · {new Date(r.created_at).toLocaleString()}
                  </p>
                </div>
                {r.status === "pending" && (
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
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
