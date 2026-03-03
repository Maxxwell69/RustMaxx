"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type PluginRow = {
  name: string;
  version: string;
  author: string;
  hookTime: string;
  filename: string;
};

function pluginSlug(filename: string): string {
  return filename.replace(/\.(cs|cs\.disabled)$/i, "").trim();
}

type PluginsResponse = {
  plugins: PluginRow[];
  failed: string[];
  raw?: string;
  error?: string;
  code?: string;
};

export default function ServerPluginsPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<PluginsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    setError("");
    fetch(`/api/servers/${id}/plugins`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          setData({
            plugins: body.plugins ?? [],
            failed: body.failed ?? [],
            error: body.error ?? "Failed to load plugins",
            code: body.code,
          });
          return;
        }
        setData({
          plugins: Array.isArray(body.plugins) ? body.plugins : [],
          failed: Array.isArray(body.failed) ? body.failed : [],
          raw: body.raw,
        });
      })
      .catch(() => {
        setError("Failed to load plugins.");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const notConnected = data?.code === "not_connected" || data?.code === "rcon_error";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/servers/${id}`} className="text-rust-cyan hover:underline">
          ← Back to server
        </Link>
        <h1 className="text-xl font-semibold text-zinc-100">Plugins</h1>
      </div>

      <p className="text-sm text-zinc-500">
        Oxide/uMod plugins detected on the server. Connect to the server from the server page first so we can run{" "}
        <code className="rounded bg-zinc-800 px-1">oxide.plugins</code>.
      </p>

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

      {loading ? (
        <p className="text-sm text-zinc-500">Loading plugins…</p>
      ) : data ? (
        <div className="space-y-4">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
            <div className="border-b border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200">
              Loaded plugins ({data.plugins.length})
            </div>
            {data.plugins.length === 0 && !notConnected ? (
              <div className="p-4 text-sm text-zinc-500">
                No plugins loaded, or the server did not return a recognized list. Ensure Oxide/uMod is installed and
                the server is connected.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-left text-zinc-400">
                      <th className="px-4 py-2 font-medium">Name</th>
                      <th className="px-4 py-2 font-medium">Version</th>
                      <th className="px-4 py-2 font-medium">Author</th>
                      <th className="px-4 py-2 font-medium">Hook time</th>
                      <th className="px-4 py-2 font-medium">Filename</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.plugins.map((p, i) => {
                      const slug = encodeURIComponent(pluginSlug(p.filename));
                      return (
                        <tr
                          key={`${p.filename}-${i}`}
                          className="border-b border-zinc-800/80 text-zinc-300"
                        >
                          <td className="px-4 py-2">
                            <Link
                              href={`/servers/${id}/plugins/${slug}`}
                              className="text-rust-cyan hover:underline"
                            >
                              {p.name}
                            </Link>
                          </td>
                          <td className="px-4 py-2">{p.version}</td>
                          <td className="px-4 py-2">{p.author}</td>
                          <td className="px-4 py-2">{p.hookTime}s</td>
                          <td className="px-4 py-2 font-mono text-xs text-zinc-500">
                            <Link
                              href={`/servers/${id}/plugins/${slug}`}
                              className="text-zinc-500 hover:text-rust-cyan hover:underline"
                            >
                              {p.filename}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {data.failed.length > 0 && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
              <div className="border-b border-zinc-800 px-4 py-2 text-sm font-medium text-amber-200/90">
                Failed or unparsed lines ({data.failed.length})
              </div>
              <ul className="divide-y divide-zinc-800 p-2">
                {data.failed.map((line, i) => (
                  <li key={i} className="font-mono text-xs text-zinc-500">
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : null}
    </div>
  );
}
