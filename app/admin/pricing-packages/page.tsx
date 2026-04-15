"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type PackageRow = {
  id: string;
  package_kind: "server" | "streamer";
  tier_key: string;
  name: string;
  price_display: string;
  price_usd: number | null;
  period_display: string;
  billing_note: string | null;
  features: string[];
  is_highlighted: boolean;
  sort_order: number;
  is_published: boolean;
  updated_at: string;
};

type Draft = {
  name: string;
  price_display: string;
  price_usd: string;
  period_display: string;
  billing_note: string;
  featuresText: string;
  is_highlighted: boolean;
  sort_order: string;
  is_published: boolean;
};

function rowToDraft(p: PackageRow): Draft {
  return {
    name: p.name,
    price_display: p.price_display,
    price_usd: p.price_usd == null ? "" : String(p.price_usd),
    period_display: p.period_display,
    billing_note: p.billing_note ?? "",
    featuresText: p.features.join("\n"),
    is_highlighted: p.is_highlighted,
    sort_order: String(p.sort_order),
    is_published: p.is_published,
  };
}

export default function AdminPricingPackagesPage() {
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMessage(null);
    const res = await fetch("/api/admin/pricing-packages", { credentials: "same-origin" });
    if (res.status === 403) {
      setForbidden(true);
      setPackages([]);
      return;
    }
    const data = await res.json().catch(() => ({}));
    const list = Array.isArray(data.packages) ? (data.packages as PackageRow[]) : [];
    setPackages(list);
    const d: Record<string, Draft> = {};
    for (const p of list) d[p.id] = rowToDraft(p);
    setDrafts(d);
  }, []);

  useEffect(() => {
    load()
      .catch(() => setForbidden(true))
      .finally(() => setLoading(false));
  }, [load]);

  const serverPkgs = useMemo(
    () => packages.filter((p) => p.package_kind === "server"),
    [packages]
  );
  const streamerPkgs = useMemo(
    () => packages.filter((p) => p.package_kind === "streamer"),
    [packages]
  );

  async function savePackage(id: string) {
    const d = drafts[id];
    if (!d) return;
    setSavingId(id);
    setMessage(null);
    const priceUsdRaw = d.price_usd.trim();
    let price_usd: number | null | undefined;
    if (priceUsdRaw === "") price_usd = null;
    else {
      const n = parseFloat(priceUsdRaw);
      if (!Number.isFinite(n)) {
        setMessage("Price (USD) must be a number or empty.");
        setSavingId(null);
        return;
      }
      price_usd = n;
    }
    const sort = parseInt(d.sort_order, 10);
    if (!Number.isFinite(sort)) {
      setMessage("Sort order must be an integer.");
      setSavingId(null);
      return;
    }
    const features = d.featuresText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const res = await fetch(`/api/admin/pricing-packages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          name: d.name.trim(),
          price_display: d.price_display,
          price_usd,
          period_display: d.period_display,
          billing_note: d.billing_note.trim() || null,
          features,
          is_highlighted: d.is_highlighted,
          sort_order: sort,
          is_published: d.is_published,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(typeof data.error === "string" ? data.error : "Save failed");
        return;
      }
      setMessage("Saved. Public /pricing and /api/billing/tiers will reflect published rows.");
      await load();
    } finally {
      setSavingId(null);
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
        <p className="text-zinc-400">Only admins and super admins can manage pricing packages.</p>
        <Link href="/admin" className="mt-4 inline-block text-rust-cyan hover:underline">
          ← Admin
        </Link>
      </div>
    );
  }

  if (packages.length === 0) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <Link href="/admin" className="text-rust-cyan hover:underline">
          ← Admin
        </Link>
        <h1 className="text-xl font-semibold text-zinc-100">Pricing packages</h1>
        <p className="text-sm text-zinc-400">
          No rows found. Apply database migration <code className="rounded bg-zinc-800 px-1">031_pricing_packages.sql</code>{" "}
          to create and seed <code className="rounded bg-zinc-800 px-1">pricing_packages</code>, then refresh.
        </p>
      </div>
    );
  }

  function renderEditor(p: PackageRow) {
    const d = drafts[p.id];
    if (!d) return null;
    return (
      <div
        key={p.id}
        className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <span className="text-xs uppercase tracking-wide text-zinc-500">{p.package_kind}</span>
            <h3 className="text-lg font-medium text-zinc-100">
              {p.tier_key}
              <span className="ml-2 text-sm font-normal text-zinc-500">({p.name})</span>
            </h3>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={d.is_published}
              onChange={(e) =>
                setDrafts((prev) => ({
                  ...prev,
                  [p.id]: { ...d, is_published: e.target.checked },
                }))
              }
            />
            Published on pricing
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Display name</label>
            <input
              value={d.name}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [p.id]: { ...d, name: e.target.value } }))
              }
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Sort order</label>
            <input
              value={d.sort_order}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [p.id]: { ...d, sort_order: e.target.value } }))
              }
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Price display (e.g. $19.99)</label>
            <input
              value={d.price_display}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [p.id]: { ...d, price_display: e.target.value } }))
              }
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Price USD (number, optional)</label>
            <input
              value={d.price_usd}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [p.id]: { ...d, price_usd: e.target.value } }))
              }
              placeholder="19.99"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Period (e.g. /mo)</label>
            <input
              value={d.period_display}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [p.id]: { ...d, period_display: e.target.value } }))
              }
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Subtitle / billing note</label>
            <input
              value={d.billing_note}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [p.id]: { ...d, billing_note: e.target.value } }))
              }
              placeholder="Per server"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={d.is_highlighted}
            onChange={(e) =>
              setDrafts((prev) => ({
                ...prev,
                [p.id]: { ...d, is_highlighted: e.target.checked },
              }))
            }
          />
          Highlight card (accent border)
        </label>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Features (one per line)</label>
          <textarea
            value={d.featuresText}
            onChange={(e) =>
              setDrafts((prev) => ({ ...prev, [p.id]: { ...d, featuresText: e.target.value } }))
            }
            rows={5}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 font-mono"
          />
        </div>
        <p className="text-[11px] text-zinc-600">
          Tier key <code className="text-zinc-400">{p.tier_key}</code> controls billing (Stripe checkout). Webhook
          limits for streamer tiers still follow that key in code.
        </p>
        <button
          type="button"
          disabled={savingId === p.id}
          onClick={() => void savePackage(p.id)}
          className="rounded-lg bg-rust-cyan px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
        >
          {savingId === p.id ? "Saving…" : "Save package"}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/admin" className="text-rust-cyan hover:underline">
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-100">Pricing packages</h1>
      </div>
      <p className="text-sm text-zinc-500">
        Edits apply to the public <Link href="/pricing" className="text-rust-cyan hover:underline">pricing</Link> page
        and <code className="rounded bg-zinc-800 px-1 text-zinc-300">GET /api/billing/tiers</code>. Stripe charges still
        use environment price IDs and tier keys.
      </p>
      {message ? (
        <p className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">
          {message}
        </p>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-zinc-200">Server admins</h2>
        <div className="space-y-4">{serverPkgs.map(renderEditor)}</div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-zinc-200">Streamers</h2>
        <div className="space-y-4">{streamerPkgs.map(renderEditor)}</div>
      </section>
    </div>
  );
}
