"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

type ListedServer = {
  id: string;
  name: string;
  listing_name: string | null;
  listing_description: string | null;
  game_host: string | null;
  game_port: number | null;
  location: string | null;
  logo_url: string | null;
};

export default function ServerListPage() {
  const [servers, setServers] = useState<ListedServer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/server-list")
      .then((r) => r.json())
      .then((data) => setServers(Array.isArray(data) ? data : []))
      .catch(() => setServers([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <MarketingLayout>
      <div className="relative px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-3xl font-bold text-zinc-100">Server list</h1>
          <p className="mt-2 text-zinc-400">
            Rust servers that use RustMaxx and have opted in to appear here. Connect in-game using
            the address shown.
          </p>

          {loading ? (
            <p className="mt-8 text-zinc-500">Loading…</p>
          ) : servers.length === 0 ? (
            <div className="mt-8 rounded-lg border border-rust-border bg-rust-surface/50 p-8 text-center">
              <p className="text-zinc-400">No servers are listed yet.</p>
              <p className="mt-2 text-sm text-zinc-500">
                Server owners can opt in when they add their server in the RustMaxx dashboard.
              </p>
              <Link
                href="/"
                className="mt-4 inline-block text-sm font-medium text-rust-cyan hover:underline"
              >
                Learn about RustMaxx →
              </Link>
            </div>
          ) : (
            <ul className="mt-8 space-y-4">
              {servers.map((s) => {
                const displayName = s.listing_name?.trim() || s.name;
                const connectAddress =
                  s.game_host && s.game_port
                    ? `${s.game_host}:${s.game_port}`
                    : null;
                const location = s.location?.trim() || null;
                const logoUrl = s.logo_url?.trim() || null;
                return (
                  <li
                    key={s.id}
                    className="rounded-lg border border-rust-border bg-rust-surface p-5"
                  >
                    <div className="flex flex-wrap items-start gap-4">
                      {logoUrl && (
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-rust-border bg-rust-panel">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={logoUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-semibold text-zinc-100">{displayName}</h2>
                          {location && (
                            <span className="rounded bg-rust-border px-2 py-0.5 text-xs text-zinc-400">
                              {location}
                            </span>
                          )}
                        </div>
                        {s.listing_description?.trim() && (
                          <p className="mt-1 text-sm text-zinc-400">{s.listing_description.trim()}</p>
                        )}
                        {connectAddress && (
                          <p className="mt-2 font-mono text-sm text-rust-cyan">
                            Connect: {connectAddress}
                          </p>
                        )}
                        {!connectAddress && (
                          <p className="mt-2 text-xs text-zinc-500">Connect info not provided</p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </MarketingLayout>
  );
}
