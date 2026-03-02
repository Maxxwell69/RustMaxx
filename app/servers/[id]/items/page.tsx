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
  ammo: "Ammo & Explosives",
  medical: "Medical",
  tools: "Tools",
  building: "Building",
  attachments: "Attachments",
  other: "Other",
};

export default function ServerItemsPage() {
  const params = useParams();
  const id = params.id as string;
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

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

  const itemsByCategory = items.reduce<Record<string, Item[]>>((acc, item) => {
    const key = item.category || "other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const orderedCategories = Object.keys(CATEGORY_LABELS).filter(
    (k) => itemsByCategory[k]?.length
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
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
        <div className="space-y-4">
          {orderedCategories.map((cat) => (
            <section
              key={cat}
              className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden"
            >
              <div className="border-b border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200">
                {CATEGORY_LABELS[cat] ?? cat}
              </div>
              <ul className="divide-y divide-zinc-800">
                {itemsByCategory[cat]!.map((item) => (
                  <li
                    key={item.shortname}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-2"
                  >
                    <div>
                      <div className="text-sm text-zinc-100">{item.label}</div>
                      <div className="text-xs text-zinc-500">{item.shortname}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-zinc-300">
                        <span className="text-zinc-500">Amount</span>
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
                          className="w-20 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-zinc-100 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          onChange={(e) =>
                            toggleItem(item.shortname, e.target.checked)
                          }
                          disabled={saving === item.shortname}
                          className="rounded border-zinc-600 bg-zinc-800 text-rust-cyan focus:ring-rust-cyan"
                        />
                        {item.enabled ? "Enabled" : "Enable"}
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

