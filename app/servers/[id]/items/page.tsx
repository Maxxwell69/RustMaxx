"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { ItemCategory } from "@/lib/item-catalog";

type Item = {
  shortname: string;
  label: string;
  amount: number;
  category: ItemCategory | string;
  enabled: boolean;
};

const CATEGORY_LABELS: Record<string, string> = {
  resources: "Resources",
  components: "Components",
  weapons: "Weapons",
  ammo: "Ammunition",
  medical: "Medical",
  tools: "Tool",
  building: "Construction",
  attachments: "Attachments",
  attire: "Attire",
  food: "Food",
  other: "Misc",
};

// Tab order matching Rust-style: All, then by category
const TAB_ORDER = [
  "all",
  "weapons",
  "building",
  "resources",
  "attire",
  "tools",
  "medical",
  "food",
  "ammo",
  "components",
  "attachments",
  "traps",
  "other",
];

export default function ServerItemsPage() {
  const params = useParams();
  const id = params.id as string;
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selectedTab, setSelectedTab] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  function load() {
    setLoading(true);
    setError("");
    fetch(`/api/servers/${id}/items`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        setItems(Array.isArray(data) ? data : []);
      })
      .catch(() => setError("Failed to load items."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveItem(shortname: string, enabled: boolean, amount: number) {
    setSaving(shortname);
    setError("");
    try {
      const res = await fetch(`/api/servers/${id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortname, enabled, amount }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof (data as { error?: string })?.error === "string"
            ? (data as { error: string }).error
            : "Failed to update item.";
        setError(msg);
        return;
      }
      setItems((prev) =>
        prev.map((i) =>
          i.shortname === shortname ? { ...i, enabled, amount: data.amount ?? amount } : i
        )
      );
    } catch {
      setError("Failed to update item.");
    } finally {
      setSaving(null);
    }
  }

  function toggleItem(shortname: string, enabled: boolean) {
    const item = items.find((i) => i.shortname === shortname);
    saveItem(shortname, enabled, item?.amount ?? 1);
  }

  function updateAmount(shortname: string, newAmount: number, currentlyEnabled: boolean) {
    const clamped = Math.max(1, Math.min(999999, Math.floor(newAmount)));
    setItems((prev) =>
      prev.map((i) => (i.shortname === shortname ? { ...i, amount: clamped } : i))
    );
    if (currentlyEnabled) {
      saveItem(shortname, true, clamped);
    }
  }

  const searchLower = searchQuery.trim().toLowerCase();
  const isTraps = selectedTab === "traps";

  const filteredItems = items.filter((item) => {
    const cat = item.category || "other";
    if (selectedTab !== "all") {
      if (isTraps) {
        if (cat !== "building") return false;
        const sn = (item.shortname || "").toLowerCase();
        const lb = (item.label || "").toLowerCase();
        if (!sn.includes("trap") && !lb.includes("trap")) return false;
      } else if (cat !== selectedTab) return false;
    }
    if (searchLower) {
      const match =
        (item.label || "").toLowerCase().includes(searchLower) ||
        (item.shortname || "").toLowerCase().includes(searchLower);
      if (!match) return false;
    }
    return true;
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/servers/${id}`} className="text-rust-cyan hover:underline">
          ← Back to server
        </Link>
        <h1 className="text-xl font-semibold text-zinc-100">Server items</h1>
      </div>

      <p className="text-sm text-zinc-500">
        Choose which items appear on the player page &quot;Give items&quot; section. Only enabled
        items can be given by admins and moderators.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading items…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="overflow-x-auto border-b border-zinc-800 -mb-px">
              <nav className="flex gap-0 min-w-0" aria-label="Item categories">
                <button
                  type="button"
                  onClick={() => setSelectedTab("all")}
                  className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                    selectedTab === "all"
                      ? "border-rust-cyan text-rust-cyan bg-zinc-800/80"
                      : "border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
                  }`}
                >
                  All
                </button>
                {TAB_ORDER.filter((k) => k !== "all").map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedTab(cat)}
                    className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                      selectedTab === cat
                        ? "border-rust-cyan text-rust-cyan bg-zinc-800/80"
                        : "border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
                    }`}
                  >
                    {cat === "traps" ? "Traps" : CATEGORY_LABELS[cat] ?? cat}
                  </button>
                ))}
              </nav>
            </div>
            <div className="flex-shrink-0 w-full sm:w-56">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search items…"
                className="w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
                aria-label="Search items by name or shortname"
              />
            </div>
          </div>

          <p className="text-xs text-zinc-500">
            {filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""}
            {searchLower && " matching search"}
            {selectedTab !== "all" && !isTraps && ` in ${CATEGORY_LABELS[selectedTab] ?? selectedTab}`}
            {isTraps && " (traps)"}
          </p>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredItems.map((item) => (
              <div
                key={item.shortname}
                className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 flex flex-col gap-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-100 truncate" title={item.label}>
                    {item.label}
                  </div>
                  <div className="text-xs text-zinc-500 truncate font-mono" title={item.shortname}>
                    {item.shortname}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-auto">
                  <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <span>Amt</span>
                    <input
                      type="number"
                      min={1}
                      max={999999}
                      value={item.amount}
                      onChange={(e) =>
                        updateAmount(
                          item.shortname,
                          e.target.valueAsNumber,
                          item.enabled
                        )
                      }
                      disabled={saving === item.shortname}
                      className="w-16 rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-zinc-100 text-xs focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(e) =>
                        toggleItem(item.shortname, e.target.checked)
                      }
                      disabled={saving === item.shortname}
                      className="rounded border-zinc-600 bg-zinc-800 text-rust-cyan focus:ring-rust-cyan"
                    />
                    {item.enabled ? "On" : "Off"}
                  </label>
                </div>
              </div>
            ))}
          </div>

          {filteredItems.length === 0 && (
            <p className="py-8 text-center text-sm text-zinc-500">
              No items match. Try another category or clear the search.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

