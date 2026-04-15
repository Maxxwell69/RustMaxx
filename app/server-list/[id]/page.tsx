"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

type ServerPublic = {
  id: string;
  name: string;
  listing_name: string | null;
  listing_description: string | null;
  game_host: string | null;
  game_port: number | null;
  location: string | null;
  logo_url: string | null;
  listed: boolean;
  streamer_interactions_enabled: boolean;
  streamer_join_requires_owner_approval: boolean;
};

type Viewer = {
  loggedIn: boolean;
  applicationApproved: boolean;
  canRequest: boolean;
  request: { status: string; message: string | null } | null;
  reason?: string;
};

export default function PublicServerDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [server, setServer] = useState<ServerPublic | null>(null);
  const [viewer, setViewer] = useState<Viewer | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);

  useEffect(() => {
    setLoadingDetail(true);
    setServer(null);
    setViewer(undefined);
    fetch(`/api/server-list/${encodeURIComponent(id)}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.server) {
          setServer(null);
          return;
        }
        setServer(d.server as ServerPublic);
        setViewer(d.viewer as Viewer | undefined);
      })
      .catch(() => setServer(null))
      .finally(() => setLoadingDetail(false));
  }, [id]);

  async function submitRequest() {
    setFormErr(null);
    setFormOk(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/server-list/${encodeURIComponent(id)}/streamer-request`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormErr(typeof data.error === "string" ? data.error : "Request failed");
        return;
      }
      setFormOk("Request sent. The server owner will review it in RustMaxx under Server → Streamer interactions → Access requests.");
      setMessage("");
      const detail = await fetch(`/api/server-list/${encodeURIComponent(id)}`, {
        credentials: "same-origin",
      }).then((r) => (r.ok ? r.json() : null));
      if (detail?.viewer) setViewer(detail.viewer as Viewer);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingDetail) {
    return (
      <MarketingLayout>
        <div className="px-4 py-16 sm:px-6">
          <p className="mx-auto max-w-3xl text-zinc-500">Loading…</p>
        </div>
      </MarketingLayout>
    );
  }

  if (server === null) {
    return (
      <MarketingLayout>
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h1 className="text-xl font-semibold text-zinc-100">Server not found</h1>
          <p className="mt-2 text-sm text-zinc-500">This server is not on the public list.</p>
          <Link href="/server-list" className="mt-4 inline-block text-sm text-rust-cyan hover:underline">
            ← Back to server list
          </Link>
        </div>
      </MarketingLayout>
    );
  }

  const displayName = server.listing_name?.trim() || server.name;
  const connectAddress =
    server.game_host && server.game_port ? `${server.game_host}:${server.game_port}` : null;

  return (
    <MarketingLayout>
      <div className="relative px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-3xl">
          <Link href="/server-list" className="text-sm text-zinc-500 hover:text-rust-cyan">
            ← Server list
          </Link>
          <div className="mt-6 flex flex-wrap items-start gap-4">
            {server.logo_url?.trim() ? (
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-rust-border bg-rust-panel">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={server.logo_url.trim()}
                  alt=""
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold text-zinc-100">{displayName}</h1>
              {server.location?.trim() ? (
                <p className="mt-1 text-sm text-zinc-500">{server.location.trim()}</p>
              ) : null}
            </div>
          </div>
          {server.listing_description?.trim() ? (
            <p className="mt-4 text-sm text-zinc-400">{server.listing_description.trim()}</p>
          ) : null}
          {connectAddress ? (
            <p className="mt-4 font-mono text-rust-cyan">Connect: {connectAddress}</p>
          ) : (
            <p className="mt-4 text-sm text-zinc-600">Connect address not listed.</p>
          )}

          <section className="mt-10 rounded-lg border border-rust-border bg-rust-surface p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Streamer access</h2>
            {!viewer?.loggedIn ? (
              <p className="mt-3 text-sm text-zinc-400">
                To request TikFinity access for this server,{" "}
                <Link
                  href={`/login?from=${encodeURIComponent(`/server-list/${id}`)}`}
                  className="font-medium text-rust-cyan hover:underline"
                >
                  log in
                </Link>{" "}
                with your RustMaxx account. You must have an{" "}
                <strong className="text-zinc-300">approved streamer application</strong> from RustMaxx staff first (
                <Link href="/streamer/register" className="text-rust-cyan hover:underline">
                  apply here
                </Link>
                ).
              </p>
            ) : !viewer.applicationApproved ? (
              <p className="mt-3 text-sm text-zinc-400">
                Your RustMaxx streamer application is not approved yet. After staff approves it, you can request access
                here.{" "}
                <Link href="/streamer/register" className="text-rust-cyan hover:underline">
                  View application status
                </Link>
                .
              </p>
            ) : !server.streamer_interactions_enabled ? (
              <p className="mt-3 text-sm text-zinc-500">
                This server does not have streamer interactions enabled. Check back later or contact the owner.
              </p>
            ) : !server.streamer_join_requires_owner_approval ? (
              <p className="mt-3 text-sm text-zinc-400">
                This server does not require a separate access request. If you are eligible, add it from your{" "}
                <Link href="/streamer" className="text-rust-cyan hover:underline">
                  Streamer dashboard
                </Link>
                .
              </p>
            ) : viewer.canRequest ? (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-zinc-400">
                  Send a short note to the server owner. They will accept or deny under their server&apos;s{" "}
                  <strong className="text-zinc-300">Streamer interactions → Access requests</strong>.
                </p>
                {formErr ? <p className="text-sm text-red-400">{formErr}</p> : null}
                {formOk ? <p className="text-sm text-emerald-400/90">{formOk}</p> : null}
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Optional message (e.g. your channel name, schedule)"
                  rows={3}
                  maxLength={2000}
                  className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                />
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void submitRequest()}
                  className="rounded-lg bg-rust-cyan px-4 py-2 text-sm font-medium text-zinc-950 hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? "Sending…" : "Submit access request"}
                </button>
              </div>
            ) : (
              <p className="mt-3 text-sm text-amber-200/90">{viewer.reason ?? "You cannot submit a request right now."}</p>
            )}
          </section>
        </div>
      </div>
    </MarketingLayout>
  );
}
