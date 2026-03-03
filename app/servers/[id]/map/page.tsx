"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

function isMapViewerUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.hostname === "playrust.io" || u.hostname === "www.playrust.io";
  } catch {
    return false;
  }
}

type MapData = {
  name: string;
  seed: number | null;
  worldSize: number | null;
  level: string | null;
  mapPreviewUrl: string | null;
  lastFetchedAt: string | null;
};

export default function ServerMapPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [savingUrl, setSavingUrl] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [error, setError] = useState("");
  const [fetchError, setFetchError] = useState("");

  function load() {
    setLoading(true);
    setError("");
    fetch(`/api/servers/${id}/map`)
      .then((r) => {
        if (!r.ok) {
          if (r.status === 404) setError("Server not found.");
          else setError("Failed to load map info.");
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d) {
          setData(d);
          if (d.mapPreviewUrl) setManualUrl(d.mapPreviewUrl);
        }
      })
      .catch(() => setError("Failed to load map info."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (id) load();
  }, [id]);

  function handleFetchFromRcon() {
    setFetching(true);
    setFetchError("");
    fetch(`/api/servers/${id}/map/fetch`, { method: "POST" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          setFetchError(body.error ?? "Fetch failed");
          if (r.status === 429) setFetchError("Wait 30 seconds before fetching again.");
          return;
        }
        setData((prev) =>
          prev
            ? {
                ...prev,
                seed: body.seed ?? prev.seed,
                worldSize: body.worldSize ?? prev.worldSize,
                level: body.level ?? prev.level,
                mapPreviewUrl: body.mapPreviewUrl ?? prev.mapPreviewUrl,
                lastFetchedAt: body.lastFetchedAt ?? prev.lastFetchedAt,
              }
            : prev
        );
        if (body.mapPreviewUrl) setManualUrl(body.mapPreviewUrl);
      })
      .catch(() => setFetchError("Fetch failed"))
      .finally(() => setFetching(false));
  }

  function handleSaveManualUrl() {
    const url = manualUrl.trim();
    if (!url) return;
    setSavingUrl(true);
    setError("");
    fetch(`/api/servers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ map_preview_url: url }),
    })
      .then((r) => {
        if (r.ok) return r.json();
        throw new Error("Save failed");
      })
      .then((updated) => {
        setData((prev) =>
          prev ? { ...prev, mapPreviewUrl: url } : prev
        );
      })
      .catch(() => setError("Failed to save URL"))
      .finally(() => setSavingUrl(false));
  }

  const lastFetchedLabel = data?.lastFetchedAt
    ? new Date(data.lastFetchedAt).toLocaleString()
    : "Never";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/servers/${id}`} className="text-rust-cyan hover:underline">
          ← Back to server
        </Link>
        <h1 className="text-xl font-semibold text-zinc-100">
          {data?.name ?? "Map"}
        </h1>
      </div>

      <p className="text-sm text-zinc-500">
        Map seed, world size, and level are fetched from the server via RCON. Connect from the server page first if fetch fails. You can set a map preview URL manually as fallback.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {fetchError && (
        <p className="text-sm text-amber-400" role="alert">
          {fetchError}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
            <div className="border-b border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 flex items-center justify-between">
              Map info
              <button
                type="button"
                onClick={handleFetchFromRcon}
                disabled={fetching}
                className="rounded bg-rust-cyan px-3 py-1.5 text-sm font-medium text-rust-panel hover:opacity-90 disabled:opacity-50"
              >
                {fetching ? "Fetching…" : "Fetch from RCON"}
              </button>
            </div>
            <dl className="grid gap-3 p-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">Seed</dt>
                <dd className="mt-0.5 text-sm text-zinc-100">
                  {data?.seed != null ? String(data.seed) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">World size</dt>
                <dd className="mt-0.5 text-sm text-zinc-100">
                  {data?.worldSize != null ? String(data.worldSize) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">Level</dt>
                <dd className="mt-0.5 text-sm text-zinc-100">
                  {data?.level ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">Last fetched</dt>
                <dd className="mt-0.5 text-sm text-zinc-100">{lastFetchedLabel}</dd>
              </div>
            </dl>
          </section>

          {data?.mapPreviewUrl ? (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
              <div className="border-b border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 flex items-center justify-between">
                <span>Map preview</span>
                <a
                  href={data.mapPreviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-rust-cyan hover:underline"
                >
                  Open in new tab
                </a>
              </div>
              <div className="p-4">
                {isMapViewerUrl(data.mapPreviewUrl) ? (
                  <iframe
                    title="Rust map preview"
                    src={data.mapPreviewUrl}
                    className="w-full h-[480px] min-h-[320px] rounded-lg border border-zinc-700 bg-zinc-900"
                    sandbox="allow-scripts allow-same-origin"
                  />
                ) : (
                  <img
                    src={data.mapPreviewUrl}
                    alt="Map preview"
                    className="max-w-full h-auto rounded-lg border border-zinc-700"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                      const parent = (e.target as HTMLImageElement).nextElementSibling;
                      if (parent) (parent as HTMLElement).style.display = "block";
                    }}
                  />
                )}
                {!isMapViewerUrl(data.mapPreviewUrl) && (
                  <p
                    className="mt-2 text-sm text-zinc-500 hidden"
                    style={{ display: "none" }}
                    data-fallback
                  >
                    Image could not be loaded.{" "}
                    <a
                      href={data.mapPreviewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-rust-cyan hover:underline"
                    >
                      Open link
                    </a>
                  </p>
                )}
              </div>
            </section>
          ) : null}

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
            <div className="border-b border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200">
              Manual map preview URL
            </div>
            <p className="p-4 text-sm text-zinc-500">
              If RCON fetch does not set a preview, paste a map image URL below (e.g. from rustmaps.com or playrust.io).
            </p>
            <div className="flex flex-wrap gap-2 px-4 pb-4">
              <input
                type="url"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                placeholder="https://…"
                className="flex-1 min-w-[200px] rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
              />
              <button
                type="button"
                onClick={handleSaveManualUrl}
                disabled={savingUrl || !manualUrl.trim()}
                className="rounded bg-rust-cyan px-4 py-2 text-sm font-medium text-rust-panel hover:opacity-90 disabled:opacity-50"
              >
                {savingUrl ? "Saving…" : "Save URL"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
