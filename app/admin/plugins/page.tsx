"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

type PluginRow = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  marketing_href: string | null;
  sort_order: number;
  published: boolean;
  updated_at: string;
};

type Draft = {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  marketing_href: string;
  sort_order: string;
  published: boolean;
};

function rowToDraft(p: PluginRow): Draft {
  return {
    slug: p.slug,
    title: p.title,
    tagline: p.tagline ?? "",
    description: p.description ?? "",
    marketing_href: p.marketing_href ?? "",
    sort_order: String(p.sort_order),
    published: p.published,
  };
}

const emptyCreate: Draft = {
  slug: "",
  title: "",
  tagline: "",
  description: "",
  marketing_href: "",
  sort_order: "0",
  published: true,
};

export default function AdminPluginsPage() {
  const [plugins, setPlugins] = useState<PluginRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [createDraft, setCreateDraft] = useState<Draft>(emptyCreate);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMessage(null);
    const res = await fetch("/api/admin/plugins", { credentials: "same-origin" });
    if (res.status === 403) {
      setForbidden(true);
      setPlugins([]);
      return;
    }
    const data = await res.json().catch(() => ({}));
    const list = Array.isArray(data.plugins) ? (data.plugins as PluginRow[]) : [];
    setPlugins(list);
    const d: Record<string, Draft> = {};
    for (const p of list) d[p.id] = rowToDraft(p);
    setDrafts(d);
  }, []);

  useEffect(() => {
    load()
      .catch(() => setForbidden(true))
      .finally(() => setLoading(false));
  }, [load]);

  async function savePlugin(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    setMessage(null);
    const sort = parseInt(draft.sort_order, 10);
    if (!Number.isFinite(sort)) {
      setMessage("Sort order must be an integer.");
      setSavingId(null);
      return;
    }
    try {
      const res = await fetch(`/api/admin/plugins/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          slug: draft.slug.trim(),
          title: draft.title.trim(),
          tagline: draft.tagline.trim(),
          description: draft.description.trim(),
          marketing_href: draft.marketing_href.trim(),
          sort_order: sort,
          published: draft.published,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(typeof data.error === "string" ? data.error : "Save failed");
        return;
      }
      setMessage("Saved. Public /plugins reflects published rows.");
      await load();
    } finally {
      setSavingId(null);
    }
  }

  async function deletePlugin(id: string) {
    if (!confirm("Remove this plugin from the directory?")) return;
    setSavingId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/plugins/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(typeof data.error === "string" ? data.error : "Delete failed");
        return;
      }
      setMessage("Deleted.");
      await load();
    } finally {
      setSavingId(null);
    }
  }

  async function createPlugin(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setMessage(null);
    const sort = parseInt(createDraft.sort_order, 10);
    if (!Number.isFinite(sort)) {
      setMessage("Sort order must be an integer.");
      setCreating(false);
      return;
    }
    try {
      const res = await fetch("/api/admin/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          slug: createDraft.slug.trim(),
          title: createDraft.title.trim(),
          tagline: createDraft.tagline.trim(),
          description: createDraft.description.trim(),
          marketing_href: createDraft.marketing_href.trim(),
          sort_order: sort,
          published: createDraft.published,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(typeof data.error === "string" ? data.error : "Create failed");
        return;
      }
      setCreateDraft(emptyCreate);
      setMessage("Created.");
      await load();
    } finally {
      setCreating(false);
    }
  }

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      return { ...prev, [id]: { ...cur, ...patch } };
    });
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
        <p className="text-zinc-400">Only admins and super admins can manage the plugin directory.</p>
        <Link href="/admin" className="mt-4 inline-block text-rust-cyan hover:underline">
          ← Admin
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-10 p-6">
      <div>
        <Link href="/admin" className="text-rust-cyan hover:underline">
          ← Admin
        </Link>
        <h1 className="mt-4 text-xl font-semibold text-zinc-100">Plugin directory</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Entries appear on <Link href="/plugins" className="text-rust-cyan hover:underline">/plugins</Link> when
          published. Optional <span className="font-mono text-zinc-300">marketing_href</span> links to an existing page
          (e.g. <span className="font-mono text-zinc-300">/maxxinvaders</span>).
        </p>
      </div>

      {message ? (
        <p className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-300">{message}</p>
      ) : null}

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="text-lg font-medium text-zinc-200">Add plugin</h2>
        <form onSubmit={createPlugin} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-zinc-500">Slug (URL)</span>
              <input
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                value={createDraft.slug}
                onChange={(e) => setCreateDraft((c) => ({ ...c, slug: e.target.value }))}
                placeholder="my-plugin"
                required
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-500">Title</span>
              <input
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                value={createDraft.title}
                onChange={(e) => setCreateDraft((c) => ({ ...c, title: e.target.value }))}
                required
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-zinc-500">Tagline</span>
            <input
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              value={createDraft.tagline}
              onChange={(e) => setCreateDraft((c) => ({ ...c, tagline: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-500">Description</span>
            <textarea
              className="mt-1 min-h-[100px] w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
              value={createDraft.description}
              onChange={(e) => setCreateDraft((c) => ({ ...c, description: e.target.value }))}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block text-sm sm:col-span-2">
              <span className="text-zinc-500">Marketing path (optional)</span>
              <input
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100"
                value={createDraft.marketing_href}
                onChange={(e) => setCreateDraft((c) => ({ ...c, marketing_href: e.target.value }))}
                placeholder="/maxxinvaders"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-500">Sort</span>
              <input
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                value={createDraft.sort_order}
                onChange={(e) => setCreateDraft((c) => ({ ...c, sort_order: e.target.value }))}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={createDraft.published}
              onChange={(e) => setCreateDraft((c) => ({ ...c, published: e.target.checked }))}
            />
            Published
          </label>
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-rust-cyan/20 px-4 py-2 text-sm font-medium text-rust-cyan hover:bg-rust-cyan/30 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </form>
      </section>

      <section className="space-y-6">
        <h2 className="text-lg font-medium text-zinc-200">Existing entries</h2>
        {plugins.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No rows yet. If the table is missing, apply migration{" "}
            <code className="rounded bg-zinc-800 px-1">047_plugin_directory.sql</code>.
          </p>
        ) : (
          plugins.map((p) => {
            const d = drafts[p.id];
            if (!d) return null;
            return (
              <div key={p.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-mono text-sm text-zinc-500">{p.id}</p>
                  <label className="flex items-center gap-2 text-sm text-zinc-400">
                    <input
                      type="checkbox"
                      checked={d.published}
                      onChange={(e) => updateDraft(p.id, { published: e.target.checked })}
                    />
                    Published
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="text-zinc-500">Slug</span>
                    <input
                      className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100"
                      value={d.slug}
                      onChange={(e) => updateDraft(p.id, { slug: e.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-zinc-500">Title</span>
                    <input
                      className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                      value={d.title}
                      onChange={(e) => updateDraft(p.id, { title: e.target.value })}
                    />
                  </label>
                </div>
                <label className="block text-sm">
                  <span className="text-zinc-500">Tagline</span>
                  <input
                    className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                    value={d.tagline}
                    onChange={(e) => updateDraft(p.id, { tagline: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-zinc-500">Description</span>
                  <textarea
                    className="mt-1 min-h-[88px] w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                    value={d.description}
                    onChange={(e) => updateDraft(p.id, { description: e.target.value })}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-sm sm:col-span-2">
                    <span className="text-zinc-500">Marketing path</span>
                    <input
                      className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100"
                      value={d.marketing_href}
                      onChange={(e) => updateDraft(p.id, { marketing_href: e.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-zinc-500">Sort</span>
                    <input
                      className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
                      value={d.sort_order}
                      onChange={(e) => updateDraft(p.id, { sort_order: e.target.value })}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => savePlugin(p.id)}
                    disabled={savingId === p.id}
                    className="rounded-lg bg-rust-cyan/20 px-4 py-2 text-sm font-medium text-rust-cyan hover:bg-rust-cyan/30 disabled:opacity-50"
                  >
                    {savingId === p.id ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePlugin(p.id)}
                    disabled={savingId === p.id}
                    className="rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-2 text-sm text-red-300 hover:bg-red-950/50 disabled:opacity-50"
                  >
                    Delete
                  </button>
                  <Link
                    href={`/plugins/${p.slug}`}
                    className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:border-zinc-600"
                  >
                    View public →
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
