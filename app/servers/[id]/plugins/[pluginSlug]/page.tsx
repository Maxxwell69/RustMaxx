"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type PluginInfo = {
  name: string;
  version: string;
  author: string;
  hookTime: string;
  filename: string;
};

type PluginDetailResponse = {
  plugin: PluginInfo | null;
  permissions: string[];
  error?: string;
  code?: string;
};

export default function PluginDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const pluginSlug = params.pluginSlug as string;
  const [data, setData] = useState<PluginDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id || !pluginSlug) return;
    setLoading(true);
    setError("");
    fetch(`/api/servers/${id}/plugins/${encodeURIComponent(pluginSlug)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          setData({
            plugin: body.plugin ?? null,
            permissions: body.permissions ?? [],
            error: body.error ?? "Failed to load plugin",
            code: body.code,
          });
          return;
        }
        setData({
          plugin: body.plugin ?? null,
          permissions: Array.isArray(body.permissions) ? body.permissions : [],
        });
      })
      .catch(() => {
        setError("Failed to load plugin.");
      })
      .finally(() => setLoading(false));
  }, [id, pluginSlug]);

  const notConnected = data?.code === "not_connected" || data?.code === "rcon_error";
  const notFound = data?.code === "not_found";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/servers/${id}/plugins`} className="text-rust-cyan hover:underline">
          ← Plugins
        </Link>
        <span className="text-zinc-500">/</span>
        <h1 className="text-xl font-semibold text-zinc-100">
          {data?.plugin?.name ?? decodeURIComponent(pluginSlug)}
        </h1>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {data?.error && notConnected && (
        <div className="rounded-lg border border-amber-800/60 bg-amber-900/20 px-4 py-3 text-sm text-amber-200">
          <p className="font-medium">Not connected</p>
          <p className="mt-1 text-amber-200/90">{data.error}</p>
          <p className="mt-2">
            <Link href={`/servers/${id}`} className="text-rust-cyan hover:underline">
              Open the server page
            </Link>{" "}
            and click <strong>Connect</strong>, then return here and refresh.
          </p>
        </div>
      )}
      {data?.error && notFound && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-300">
          Plugin not found. It may have been removed or the link is outdated.{" "}
          <Link href={`/servers/${id}/plugins`} className="text-rust-cyan hover:underline">
            Back to plugins
          </Link>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : data?.plugin ? (
        <div className="space-y-6">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
            <div className="border-b border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200">
              Plugin info
            </div>
            <dl className="grid gap-3 p-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">Name</dt>
                <dd className="mt-0.5 text-sm text-zinc-100">{data.plugin.name}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">Version</dt>
                <dd className="mt-0.5 text-sm text-zinc-100">{data.plugin.version}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">Author</dt>
                <dd className="mt-0.5 text-sm text-zinc-100">{data.plugin.author || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">Hook time</dt>
                <dd className="mt-0.5 text-sm text-zinc-100">
                  {data.plugin.hookTime ? `${data.plugin.hookTime}s` : "—"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">Filename</dt>
                <dd className="mt-0.5 font-mono text-sm text-zinc-400">{data.plugin.filename}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
            <div className="border-b border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200">
              Permissions ({data.permissions.length})
            </div>
            {data.permissions.length === 0 ? (
              <div className="p-4 text-sm text-zinc-500">
                No permissions starting with this plugin’s prefix were found. The plugin may not register any, or
                <code className="mx-1 rounded bg-zinc-800 px-1">oxide.show perms</code>
                may use a different format.
              </div>
            ) : (
              <ul className="divide-y divide-zinc-800 p-2">
                {data.permissions.map((perm) => (
                  <li key={perm} className="font-mono text-sm text-zinc-300">
                    {perm}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
