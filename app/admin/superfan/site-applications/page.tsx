"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Row = {
  id: string;
  user_id: string;
  email: string;
  message: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export default function AdminSuperfanSiteApplicationsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/superfan/site-applications")
      .then((r) => {
        if (r.status === 403) {
          setForbidden(true);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (d?.applications) setRows(d.applications);
        else setRows([]);
      });
  }, []);

  async function decide(userId: string, decision: "approve" | "reject") {
    setBusy(userId);
    try {
      const res = await fetch(`/api/admin/superfan/site-applications/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(typeof data.error === "string" ? data.error : "Failed");
        return;
      }
      setRows((prev) => prev.filter((r) => r.user_id !== userId));
    } finally {
      setBusy(null);
    }
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-zinc-500">Super admin only.</p>
        <Link href="/admin" className="mt-2 inline-block text-rust-cyan hover:underline">
          Admin home
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold text-zinc-100">Viewer superfan (site) applications</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Viewer superfans are auto-approved when they submit; this list only shows any remaining pending rows (for
        example before a DB migration cleared the old queue).{" "}
        <Link href="/admin" className="text-rust-cyan hover:underline">
          Admin home
        </Link>
      </p>

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-500">No pending site applications.</p>
      ) : (
        <ul className="mt-8 space-y-4">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="font-mono text-sm text-zinc-200">{r.email}</p>
              <p className="text-xs text-zinc-600">{r.user_id}</p>
              {r.message ? (
                <p className="mt-2 text-sm text-zinc-400 whitespace-pre-wrap">{r.message}</p>
              ) : (
                <p className="mt-2 text-sm text-zinc-600">(no message)</p>
              )}
              <p className="mt-2 text-xs text-zinc-600">{new Date(r.created_at).toLocaleString()}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => decide(r.user_id, "approve")}
                  className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  {busy === r.user_id ? "…" : "Approve"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => decide(r.user_id, "reject")}
                  className="rounded border border-zinc-600 px-3 py-1.5 text-sm text-zinc-300 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
