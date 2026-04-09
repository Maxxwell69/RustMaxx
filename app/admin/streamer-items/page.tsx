"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type CatalogItem = {
  shortname: string;
  label: string;
  amount: number;
  category: string;
};

type PlatformRow = {
  shortname: string;
  label: string;
  category: string;
  default_amount: number;
  max_amount: number;
  give_mode: "single" | "quantity";
  is_active: boolean;
  stack_cap: number;
};

type ServerRow = { id: string; name: string };

export default function AdminStreamerItemsPage() {
  const [items, setItems] = useState<PlatformRow[]>([]);
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<CatalogItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [applyShortnames, setApplyShortnames] = useState<string[]>([]);
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
  const [applyAll, setApplyAll] = useState(true);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  /** shortname -> local edit for quantity amounts before save */
  const [amountEdits, setAmountEdits] = useState<Record<string, { def: string; max: string }>>({});

  function load() {
    return Promise.all([
      fetch("/api/admin/streamer-items").then((r) => {
        if (r.status === 403) {
          setForbidden(true);
          return null;
        }
        return r.ok ? r.json() : null;
      }),
      fetch("/api/servers").then((r) => (r.ok ? r.json() : [])),
    ]).then(([c, s]) => {
      if (c?.items) setItems(c.items);
      setServers(Array.isArray(s) ? s : []);
    });
  }

  useEffect(() => {
    load()
      .catch(() => setForbidden(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearching(true);
      const q = searchQ.trim();
      fetch(`/api/admin/streamer-items/catalog?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d) => setSearchHits(Array.isArray(d.items) ? d.items : []))
        .catch(() => setSearchHits([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchQ]);

  async function addFromCatalog(shortname: string, giveMode: "single" | "quantity") {
    const res = await fetch("/api/admin/streamer-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ shortname, giveMode }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(typeof data.error === "string" ? data.error : "Add failed");
      return;
    }
    await load();
  }

  async function patchRow(
    shortname: string,
    patch: Partial<{ isActive: boolean; giveMode: "single" | "quantity"; defaultAmount: number; maxAmount: number }>
  ) {
    const res = await fetch("/api/admin/streamer-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ shortname, ...patch }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(typeof data.error === "string" ? data.error : "Update failed");
      return;
    }
    if (data.item) {
      setItems((prev) => {
        const row = data.item as PlatformRow;
        const idx = prev.findIndex((r) => r.shortname === row.shortname);
        const next = [...prev];
        if (idx >= 0) next[idx] = row;
        else next.push(row);
        return next.sort((a, b) => a.label.localeCompare(b.label));
      });
    } else {
      await load();
    }
  }

  async function saveAmounts(shortname: string) {
    const ed = amountEdits[shortname];
    if (!ed) return;
    const def = parseInt(ed.def, 10);
    const max = parseInt(ed.max, 10);
    if (!Number.isFinite(def) || !Number.isFinite(max)) {
      alert("Enter valid numbers for default and max.");
      return;
    }
    await patchRow(shortname, { defaultAmount: def, maxAmount: max });
    setAmountEdits((prev) => {
      const n = { ...prev };
      delete n[shortname];
      return n;
    });
  }

  async function toggleRow(shortname: string, isActive: boolean) {
    await patchRow(shortname, { isActive });
  }

  async function removeRow(shortname: string) {
    if (!window.confirm(`Remove ${shortname} from the platform streamer list?`)) return;
    const res = await fetch(
      `/api/admin/streamer-items?shortname=${encodeURIComponent(shortname)}`,
      { method: "DELETE", credentials: "same-origin" }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(typeof data.error === "string" ? data.error : "Remove failed");
      return;
    }
    setItems((prev) => prev.filter((r) => r.shortname !== shortname));
  }

  async function applyToServers() {
    setApplyMsg(null);
    if (applyShortnames.length === 0) {
      setApplyMsg("Select at least one item below.");
      return;
    }
    setApplyBusy(true);
    try {
      const res = await fetch("/api/admin/streamer-items/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          shortnames: applyShortnames,
          serverIds: applyAll ? "all" : selectedServerIds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setApplyMsg(typeof data.error === "string" ? data.error : "Apply failed");
        return;
      }
      setApplyMsg(
        `Merged ${(data.mergedShortnames as string[])?.join(", ") ?? ""} onto ${data.serversUpdated ?? 0} server(s).`
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
        <p className="text-zinc-400">Only super admins can manage streamer items.</p>
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
        <h1 className="text-2xl font-semibold text-zinc-100">Streamer Rust items</h1>
      </div>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="mb-2 text-lg font-medium text-zinc-200">Add from RustMaxx item list</h2>
        <p className="mb-3 text-sm text-zinc-500">
          Catalog is regenerated from the community Rust item JSON. Choose <strong className="text-zinc-400">Single</strong>{" "}
          for one-off spawns or a single inventory unit; choose <strong className="text-zinc-400">Quantity</strong> for
          stackable gives — then set default and max amounts on the platform list (within each item&apos;s stack cap).
        </p>
        <input
          type="search"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="Search by name or shortname…"
          className="mb-3 w-full max-w-md rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
        />
        {searching ? (
          <p className="text-xs text-zinc-500">Searching…</p>
        ) : (
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded border border-zinc-800 p-2 text-sm">
            {searchHits.map((h) => (
              <li
                key={h.shortname}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/50 py-1"
              >
                <span className="text-zinc-300">
                  {h.label}{" "}
                  <code className="text-[11px] text-emerald-600/90">{h.shortname}</code>
                  <span className="ml-1 text-[10px] text-zinc-600">stack {h.amount}</span>
                </span>
                <span className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void addFromCatalog(h.shortname, "single")}
                    className="text-xs text-rust-cyan hover:underline"
                  >
                    Add single
                  </button>
                  <button
                    type="button"
                    onClick={() => void addFromCatalog(h.shortname, "quantity")}
                    className="text-xs text-rust-cyan hover:underline"
                  >
                    Add quantity
                  </button>
                </span>
              </li>
            ))}
            {searchHits.length === 0 && searchQ.trim() ? (
              <li className="text-xs text-zinc-600">No matches.</li>
            ) : null}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="mb-2 text-lg font-medium text-zinc-200">Platform list</h2>
        <p className="mb-4 text-xs text-zinc-500">
          <strong className="text-zinc-400">Active</strong> means the item can be offered to servers. Single-mode items
          always grant ×1. Quantity-mode uses default and max within the Rust stack cap.
        </p>
        <ul className="space-y-3">
          {items.length === 0 ? (
            <li className="text-sm text-zinc-500">No items yet — search and add above.</li>
          ) : (
            items.map((row) => (
              <li
                key={row.shortname}
                className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <span className="font-medium text-zinc-200">{row.label}</span>{" "}
                    <code className="text-xs text-emerald-600/90">{row.shortname}</code>
                    <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-500">
                      {row.category}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                      <input
                        type="checkbox"
                        checked={row.is_active}
                        onChange={(e) => void toggleRow(row.shortname, e.target.checked)}
                      />
                      Active (streamer interactions)
                    </label>
                    <button
                      type="button"
                      onClick={() => void removeRow(row.shortname)}
                      className="text-xs text-red-400 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  <span className="text-zinc-500">Mode:</span>
                  <select
                    value={row.give_mode}
                    onChange={(e) =>
                      void patchRow(row.shortname, {
                        giveMode: e.target.value === "single" ? "single" : "quantity",
                      })
                    }
                    className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-200"
                  >
                    <option value="single">Single (×1)</option>
                    <option value="quantity">Quantity (stacked)</option>
                  </select>
                  <span className="text-zinc-600">Stack cap from catalog: {row.stack_cap}</span>
                </div>
                {row.give_mode === "quantity" ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="text-xs text-zinc-400">
                      Default qty
                      <input
                        type="number"
                        min={1}
                        max={row.stack_cap}
                        value={
                          amountEdits[row.shortname]?.def ??
                          String(row.default_amount)
                        }
                        onChange={(e) =>
                          setAmountEdits((prev) => ({
                            ...prev,
                            [row.shortname]: {
                              def: e.target.value,
                              max: prev[row.shortname]?.max ?? String(row.max_amount),
                            },
                          }))
                        }
                        className="ml-1 w-20 rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-zinc-100"
                      />
                    </label>
                    <label className="text-xs text-zinc-400">
                      Max qty
                      <input
                        type="number"
                        min={1}
                        max={row.stack_cap}
                        value={
                          amountEdits[row.shortname]?.max ??
                          String(row.max_amount)
                        }
                        onChange={(e) =>
                          setAmountEdits((prev) => ({
                            ...prev,
                            [row.shortname]: {
                              def: prev[row.shortname]?.def ?? String(row.default_amount),
                              max: e.target.value,
                            },
                          }))
                        }
                        className="ml-1 w-20 rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-zinc-100"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void saveAmounts(row.shortname)}
                      className="rounded bg-zinc-700 px-2 py-1 text-xs text-rust-cyan hover:bg-zinc-600"
                    >
                      Save amounts
                    </button>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-zinc-600">Single-mode: always ×1 for streamer references.</p>
                )}
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="mb-2 text-lg font-medium text-zinc-200">Apply to server allow lists</h2>
        <p className="mb-4 text-sm text-zinc-500">
          Merge selected items into each server&apos;s streamer item checklist (owners can remove later under Server
          setup).
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          {items.filter((c) => c.is_active).map((c) => (
            <label key={c.shortname} className="flex items-center gap-1.5 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={applyShortnames.includes(c.shortname)}
                onChange={(e) => {
                  const on = e.target.checked;
                  setApplyShortnames((prev) =>
                    on
                      ? [...new Set([...prev, c.shortname])]
                      : prev.filter((s) => s !== c.shortname)
                  );
                }}
              />
              {c.shortname}
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
          {applyBusy ? "Applying…" : "Merge into server lists"}
        </button>
        {applyMsg && <p className="mt-2 text-sm text-emerald-400/90">{applyMsg}</p>}
      </section>
    </div>
  );
}
