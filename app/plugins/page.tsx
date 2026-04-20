"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

type PluginCard = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  marketing_href: string | null;
  sort_order: number;
};

export default function PluginsDirectoryPage() {
  const [plugins, setPlugins] = useState<PluginCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/plugins")
      .then((r) => r.json())
      .then((data: { plugins?: PluginCard[]; error?: string }) => {
        setPlugins(Array.isArray(data.plugins) ? data.plugins : []);
        if (typeof data.error === "string") setError(data.error);
      })
      .catch(() => {
        setPlugins([]);
        setError("Could not load directory.");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <MarketingLayout>
      <div className="relative px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-3xl font-bold text-zinc-100">Plugins</h1>
          <p className="mt-2 text-zinc-400">
            Rust (Oxide) plugins built and maintained by RustMaxx. Each entry links to a short overview; some also have a
            full marketing or docs page.
          </p>

          {loading ? (
            <p className="mt-8 text-sm text-zinc-500">Loading…</p>
          ) : error ? (
            <p className="mt-8 text-sm text-amber-400">{error}</p>
          ) : plugins.length === 0 ? (
            <p className="mt-8 text-sm text-zinc-500">No plugins are listed yet.</p>
          ) : (
            <ul className="mt-10 grid gap-4 sm:grid-cols-2">
              {plugins.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/plugins/${p.slug}`}
                    className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 transition-colors hover:border-rust-cyan/40 hover:bg-zinc-900"
                  >
                    <span className="font-medium text-zinc-100">{p.title}</span>
                    {p.tagline ? (
                      <span className="mt-1 text-sm text-zinc-500">{p.tagline}</span>
                    ) : null}
                    {p.description ? (
                      <span className="mt-2 line-clamp-3 text-xs text-zinc-600">{p.description}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </MarketingLayout>
  );
}
