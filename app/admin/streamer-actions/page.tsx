"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type CatalogRow = {
  action_key: string;
  is_active: boolean;
  label: string | null;
  /** From API merge: row exists in DB (false until sync or first toggle). */
  registered?: boolean;
};
type ServerRow = { id: string; name: string };

export default function AdminStreamerActionsPage() {
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [applyKeys, setApplyKeys] = useState<string[]>([]);
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
  const [applyAll, setApplyAll] = useState(true);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [platformEnv, setPlatformEnv] = useState<{ maxxInvadersEnabled: boolean } | null>(null);

  const catalogSorted = useMemo(() => {
    const list = [...catalog];
    list.sort((a, b) => {
      const pri = (k: string) => (k === "maxxinvaders" ? 0 : 1);
      const d = pri(a.action_key) - pri(b.action_key);
      return d !== 0 ? d : a.action_key.localeCompare(b.action_key);
    });
    return list;
  }, [catalog]);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/streamer-actions").then((r) => {
        if (r.status === 403) {
          setForbidden(true);
          return null;
        }
        return r.ok ? r.json() : null;
      }),
      fetch("/api/servers").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([c, s]) => {
        if (c?.catalog) setCatalog(c.catalog);
        if (c?.platformEnv && typeof c.platformEnv.maxxInvadersEnabled === "boolean") {
          setPlatformEnv({ maxxInvadersEnabled: c.platformEnv.maxxInvadersEnabled });
        }
        setServers(Array.isArray(s) ? s : []);
      })
      .catch(() => setForbidden(true))
      .finally(() => setLoading(false));
  }, []);

  async function toggleRow(key: string, isActive: boolean) {
    const res = await fetch("/api/admin/streamer-actions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ actionKey: key, isActive }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(typeof d.error === "string" ? d.error : "Update failed");
      return;
    }
    setCatalog((prev) =>
      prev.map((r) => (r.action_key === key ? { ...r, is_active: isActive, registered: true } : r))
    );
  }

  async function syncCatalogFromCode() {
    setSyncMsg(null);
    setSyncBusy(true);
    try {
      const res = await fetch("/api/admin/streamer-actions/sync-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncMsg(typeof data.error === "string" ? data.error : "Sync failed");
        return;
      }
      setSyncMsg(
        `Registered ${typeof data.inserted === "number" ? data.inserted : 0} new catalog row(s) (${data.keysTotal ?? "?"} actions defined in code).`
      );
      const c = await fetch("/api/admin/streamer-actions").then((r) => (r.ok ? r.json() : null));
      if (c?.catalog) setCatalog(c.catalog);
      if (c?.platformEnv && typeof c.platformEnv.maxxInvadersEnabled === "boolean") {
        setPlatformEnv({ maxxInvadersEnabled: c.platformEnv.maxxInvadersEnabled });
      }
    } finally {
      setSyncBusy(false);
    }
  }

  async function applyToServers() {
    setApplyMsg(null);
    if (applyKeys.length === 0) {
      setApplyMsg("Select at least one action below.");
      return;
    }
    setApplyBusy(true);
    try {
      const res = await fetch("/api/admin/streamer-actions/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          actionKeys: applyKeys,
          serverIds: applyAll ? "all" : selectedServerIds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setApplyMsg(typeof data.error === "string" ? data.error : "Apply failed");
        return;
      }
      setApplyMsg(
        `Merged ${(data.mergedActions as string[])?.join(", ") ?? ""} onto ${data.serversUpdated ?? 0} server(s).`
      );
    } finally {
      setApplyBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="text-zinc-500">Loading…</p>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="text-zinc-400">Only super admins can manage streamer actions.</p>
        <Link href="/admin" className="mt-4 inline-block text-rust-cyan hover:underline">
          ← Admin
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/admin" className="text-rust-cyan hover:underline">
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-100">Streamer action catalog</h1>
      </div>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="mb-2 text-lg font-medium text-zinc-200">Platform actions</h2>
        <p className="mb-4 text-sm text-zinc-500">
          RustMaxx administrators control which TikFinity actions exist on the platform. The list follows{" "}
          <strong className="text-zinc-400">STREAMER_BASE_ACTION_KEYS</strong> in code. Toggle{" "}
          <strong className="text-zinc-300">Active</strong> so server owners can offer that action under{" "}
          <strong className="text-zinc-400">Servers → Streamer interactions</strong>.
        </p>
        <div className="mb-4 rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-100/95">
          <p className="font-medium text-emerald-200">MaxxInvaders (viewer bots)</p>
          <p className="mt-1 text-emerald-100/85">
            Find <code className="rounded bg-zinc-900 px-1">maxxinvaders</code> below. When{" "}
            <strong className="text-emerald-100">Active</strong>, hosts can allow{" "}
            <code className="rounded bg-zinc-900 px-1">maxxinvaders.spawn</code> for streamers (requires MaxxInvaders +
            RoamingNPCs on the Rust server). When inactive, TikFinity webhooks with{" "}
            <code className="rounded bg-zinc-900 px-1">?action=maxxinvaders</code> are rejected for every server until you
            turn it back on.
          </p>
          {platformEnv && !platformEnv.maxxInvadersEnabled ? (
            <p className="mt-2 text-amber-200/95">
              <strong>Environment override:</strong> <code className="rounded bg-zinc-900 px-1">RUSTMAXX_PLATFORM_MAXXINVADERS_ENABLED=false</code>{" "}
              — MaxxInvaders is hidden from all streamer flows until this is removed or set to true (ops kill-switch).
            </p>
          ) : null}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={syncBusy}
            onClick={() => void syncCatalogFromCode()}
            className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
          >
            {syncBusy ? "Syncing…" : "Register missing rows in database"}
          </button>
          <span className="text-xs text-zinc-500">
            Inserts any new action keys into the catalog (active by default). Safe to run repeatedly.
          </span>
        </div>
        {syncMsg && <p className="mb-4 text-sm text-emerald-400/90">{syncMsg}</p>}
        <ul className="space-y-2">
          {catalogSorted.map((row) => (
            <li
              key={row.action_key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm"
            >
              <span>
                <span className="font-medium text-zinc-200">{row.label ?? row.action_key}</span>{" "}
                <code className="text-xs text-emerald-600/90">{row.action_key}</code>
                {row.registered === false && (
                  <span className="ml-2 text-xs text-amber-500/90">(not in DB — toggle or sync)</span>
                )}
              </span>
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={row.is_active}
                  onChange={(e) => void toggleRow(row.action_key, e.target.checked)}
                />
                Active
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="mb-2 text-lg font-medium text-zinc-200">Apply actions to servers</h2>
        <p className="mb-4 text-sm text-zinc-500">
          Merge the selected actions into each server&apos;s allowed list (existing choices are kept). Use this to roll
          out a new action without editing every server by hand.
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          {catalog.filter((c) => c.is_active).map((c) => (
            <label key={c.action_key} className="flex items-center gap-1.5 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={applyKeys.includes(c.action_key)}
                onChange={(e) => {
                  const on = e.target.checked;
                  setApplyKeys((prev) =>
                    on ? [...new Set([...prev, c.action_key])] : prev.filter((k) => k !== c.action_key)
                  );
                }}
              />
              {c.action_key}
            </label>
          ))}
        </div>
        <label className="mb-2 flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
          All servers
        </label>
        {!applyAll && (
          <div className="mb-4 max-h-48 space-y-1 overflow-y-auto rounded border border-zinc-800 p-2">
            {servers.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={selectedServerIds.includes(s.id)}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setSelectedServerIds((prev) =>
                      on ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                    );
                  }}
                />
                {s.name}
              </label>
            ))}
          </div>
        )}
        <button
          type="button"
          disabled={applyBusy}
          onClick={() => void applyToServers()}
          className="rounded-lg bg-rust-cyan px-4 py-2 text-sm font-medium text-zinc-950 hover:opacity-90 disabled:opacity-50"
        >
          {applyBusy ? "Applying…" : "Merge into allowed lists"}
        </button>
        {applyMsg && <p className="mt-2 text-sm text-emerald-400/90">{applyMsg}</p>}
      </section>
    </div>
  );
}
