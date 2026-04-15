"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

type Card = {
  id: string;
  display_name: string | null;
  stream_name: string | null;
  avatar_url: string | null;
  bio_summary: string | null;
};

export default function StreamersDirectoryPage() {
  const [streamers, setStreamers] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/streamers")
      .then((r) => r.json())
      .then((data: { streamers?: Card[]; error?: string }) => {
        setStreamers(Array.isArray(data.streamers) ? data.streamers : []);
        if (typeof data.error === "string") setError(data.error);
      })
      .catch(() => {
        setStreamers([]);
        setError("Could not load directory.");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <MarketingLayout>
      <div className="relative px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-3xl font-bold text-zinc-100">Streamers</h1>
          <p className="mt-2 text-zinc-400">
            RustMaxx creators who chose to appear here. Visit a profile for their public bio and stream name from their
            application.
          </p>

          {loading ? (
            <p className="mt-8 text-sm text-zinc-500">Loading…</p>
          ) : error ? (
            <p className="mt-8 text-sm text-amber-400">{error}</p>
          ) : streamers.length === 0 ? (
            <p className="mt-8 text-sm text-zinc-500">No streamers are listed yet.</p>
          ) : (
            <ul className="mt-10 grid gap-4 sm:grid-cols-2">
              {streamers.map((s) => {
                const title = s.stream_name || s.display_name || "Streamer";
                const subtitle = s.stream_name && s.display_name && s.stream_name !== s.display_name ? s.display_name : null;
                return (
                  <li key={s.id}>
                    <Link
                      href={`/streamers/${s.id}`}
                      className="flex gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 transition-colors hover:border-rust-cyan/40 hover:bg-zinc-900"
                    >
                      {s.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.avatar_url}
                          alt=""
                          width={56}
                          height={56}
                          className="h-14 w-14 shrink-0 rounded-full object-cover ring-1 ring-zinc-700"
                        />
                      ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-lg font-semibold text-zinc-500 ring-1 ring-zinc-700">
                          {(title[0] ?? "?").toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-zinc-100">{title}</p>
                        {subtitle ? <p className="truncate text-sm text-zinc-500">{subtitle}</p> : null}
                        {s.bio_summary ? (
                          <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{s.bio_summary}</p>
                        ) : null}
                      </div>
                    </Link>
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
