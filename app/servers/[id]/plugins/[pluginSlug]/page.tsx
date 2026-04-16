"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type ServerMe = { name: string; myRole?: string };

type GroupRow = { id: string; name: string };

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
  const [serverMe, setServerMe] = useState<ServerMe | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [data, setData] = useState<PluginDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [permPick, setPermPick] = useState("");
  const [permCustom, setPermCustom] = useState("");
  const [grantSteamId, setGrantSteamId] = useState("");
  const [grantGroupName, setGrantGroupName] = useState("");
  const [oxideBusy, setOxideBusy] = useState<string | null>(null);
  const [oxideMessage, setOxideMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/servers/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!body || typeof body !== "object") return;
        const name = typeof (body as { name?: string }).name === "string" ? (body as { name: string }).name : "";
        const myRole =
          typeof (body as { myRole?: string }).myRole === "string"
            ? (body as { myRole: string }).myRole
            : undefined;
        setServerMe({ name, myRole });
      })
      .catch(() => setServerMe(null));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const canManage = serverMe?.myRole === "owner" || serverMe?.myRole === "admin";
    if (!canManage) {
      setGroups([]);
      return;
    }
    fetch(`/api/servers/${id}/groups`)
      .then((r) => (r.ok ? r.json() : []))
      .then((body) => {
        setGroups(Array.isArray(body) ? body : []);
      })
      .catch(() => setGroups([]));
  }, [id, serverMe?.myRole]);

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
  const canManageOxide = serverMe?.myRole === "owner" || serverMe?.myRole === "admin";

  function resolvePermissionString(): string {
    if (permPick === "__custom__") return permCustom.trim();
    if (permPick) return permPick;
    return permCustom.trim();
  }

  async function runOxidePerm(
    action: "grant" | "revoke",
    subject: "user" | "group",
    subjectId: string,
    label: string
  ) {
    setOxideMessage(null);
    const permission = resolvePermissionString();
    if (!permission) {
      setOxideMessage({ type: "error", text: "Choose a permission or enter a custom permission." });
      return;
    }
    if (!subjectId.trim()) {
      setOxideMessage({ type: "error", text: subject === "user" ? "Enter a Steam ID." : "Choose a group." });
      return;
    }
    setOxideBusy(label);
    try {
      const res = await fetch(`/api/servers/${id}/oxide-permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          subject,
          subjectId: subjectId.trim(),
          permission,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOxideMessage({
          type: "error",
          text: typeof body.error === "string" ? body.error : "Request failed.",
        });
        return;
      }
      const resp =
        typeof (body as { response?: string }).response === "string"
          ? (body as { response: string }).response.trim()
          : "";
      setOxideMessage({
        type: "ok",
        text: resp || (action === "grant" ? "Permission granted." : "Permission revoked."),
      });
    } catch {
      setOxideMessage({ type: "error", text: "Network error." });
    } finally {
      setOxideBusy(null);
    }
  }

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

          {canManageOxide && !notConnected && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
              <div className="border-b border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200">
                Grant or revoke on the Rust server (Oxide)
              </div>
              <div className="space-y-4 p-4 text-sm text-zinc-300">
                <p className="text-xs text-zinc-500">
                  Runs <code className="rounded bg-zinc-800 px-1">oxide.grant</code> /{" "}
                  <code className="rounded bg-zinc-800 px-1">oxide.revoke</code> over RCON. Group targets must already
                  exist under{" "}
                  <Link href={`/servers/${id}/permissions`} className="text-rust-cyan hover:underline">
                    Permissions
                  </Link>{" "}
                  so RustMaxx matches Oxide.
                </p>

                <div className="space-y-2">
                  <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Permission
                  </label>
                  {data.permissions.length > 0 ? (
                    <select
                      className="w-full max-w-xl rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100"
                      value={permPick}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPermPick(v);
                        if (v !== "__custom__") setPermCustom("");
                      }}
                    >
                      <option value="">— Select —</option>
                      {data.permissions.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                      <option value="__custom__">Custom…</option>
                    </select>
                  ) : null}
                  {(data.permissions.length === 0 || permPick === "__custom__") && (
                    <input
                      type="text"
                      placeholder="e.g. maxxinvaders.use"
                      className="w-full max-w-xl rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600"
                      value={permCustom}
                      onChange={(e) => setPermCustom(e.target.value)}
                    />
                  )}
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-3">
                  <div className="text-xs font-medium text-zinc-400">To a player (Steam64)</div>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="7656119…"
                    className="w-full max-w-xl rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600"
                    value={grantSteamId}
                    onChange={(e) => setGrantSteamId(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={oxideBusy !== null}
                      onClick={() =>
                        runOxidePerm("grant", "user", grantSteamId, "grant-user")
                      }
                      className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                    >
                      {oxideBusy === "grant-user" ? "…" : "Grant to player"}
                    </button>
                    <button
                      type="button"
                      disabled={oxideBusy !== null}
                      onClick={() =>
                        runOxidePerm("revoke", "user", grantSteamId, "revoke-user")
                      }
                      className="rounded-lg border border-amber-800/80 bg-amber-950/40 px-3 py-2 text-xs font-medium text-amber-200 hover:bg-amber-900/30 disabled:opacity-50"
                    >
                      {oxideBusy === "revoke-user" ? "…" : "Revoke from player"}
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-3">
                  <div className="text-xs font-medium text-zinc-400">To a permission group</div>
                  {groups.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                      No groups yet. Create one on the Permissions page, then refresh this page.
                    </p>
                  ) : (
                    <select
                      className="w-full max-w-xl rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                      value={grantGroupName}
                      onChange={(e) => setGrantGroupName(e.target.value)}
                    >
                      <option value="">— Select group —</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.name}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={oxideBusy !== null || groups.length === 0}
                      onClick={() =>
                        runOxidePerm("grant", "group", grantGroupName, "grant-group")
                      }
                      className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                    >
                      {oxideBusy === "grant-group" ? "…" : "Grant to group"}
                    </button>
                    <button
                      type="button"
                      disabled={oxideBusy !== null || groups.length === 0}
                      onClick={() =>
                        runOxidePerm("revoke", "group", grantGroupName, "revoke-group")
                      }
                      className="rounded-lg border border-amber-800/80 bg-amber-950/40 px-3 py-2 text-xs font-medium text-amber-200 hover:bg-amber-900/30 disabled:opacity-50"
                    >
                      {oxideBusy === "revoke-group" ? "…" : "Revoke from group"}
                    </button>
                  </div>
                </div>

                {oxideMessage && (
                  <p
                    className={`text-xs ${oxideMessage.type === "ok" ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {oxideMessage.text}
                  </p>
                )}
              </div>
            </section>
          )}

          {!canManageOxide && serverMe && (
            <p className="text-xs text-zinc-500">
              Only the server owner or a server admin can grant Oxide permissions from RustMaxx. Your role:{" "}
              <span className="text-zinc-400">{serverMe.myRole ?? "—"}</span>.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
