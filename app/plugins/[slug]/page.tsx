"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

type Plugin = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  marketing_href: string | null;
};

export default function PluginDetailPage() {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const [plugin, setPlugin] = useState<Plugin | null | undefined>(undefined);

  useEffect(() => {
    if (!slug) {
      setPlugin(null);
      return;
    }
    let cancelled = false;
    setPlugin(undefined);
    fetch(`/api/plugins/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (r.status === 404) {
          if (!cancelled) setPlugin(null);
          return;
        }
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.plugin) {
          if (!cancelled) setPlugin(null);
          return;
        }
        if (!cancelled) setPlugin(data.plugin as Plugin);
      })
      .catch(() => {
        if (!cancelled) setPlugin(null);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <MarketingLayout>
      <div className="relative px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-2xl">
          <p className="mb-6 text-sm">
            <Link href="/plugins" className="text-rust-cyan hover:underline">
              ← Plugins
            </Link>
          </p>

          {plugin === undefined ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : plugin === null ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
              <h1 className="text-xl font-semibold text-zinc-200">Plugin not found</h1>
              <p className="mt-2 text-sm text-zinc-500">
                This plugin is not in the directory or is not published.
              </p>
              <Link href="/plugins" className="mt-4 inline-block text-sm text-rust-cyan hover:underline">
                Back to directory
              </Link>
            </div>
          ) : (
            <article className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-8">
              <h1 className="text-2xl font-bold text-zinc-100">{plugin.title}</h1>
              {plugin.tagline ? (
                <p className="mt-2 text-lg text-zinc-400">{plugin.tagline}</p>
              ) : null}
              {plugin.description ? (
                <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{plugin.description}</p>
              ) : (
                <p className="mt-6 text-sm text-zinc-500">No extended description yet.</p>
              )}
              {plugin.marketing_href ? (
                <p className="mt-8">
                  <Link
                    href={plugin.marketing_href}
                    className="inline-flex rounded-lg bg-rust-cyan/15 px-4 py-2 text-sm font-medium text-rust-cyan hover:bg-rust-cyan/25"
                  >
                    Full product page →
                  </Link>
                </p>
              ) : null}
            </article>
          )}
        </div>
      </div>
    </MarketingLayout>
  );
}
