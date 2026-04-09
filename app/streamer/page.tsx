"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/marketing/Logo";
import { SteamIdForm } from "@/components/profile/SteamIdForm";
import { STREAMER_SPAWN_PRESETS } from "@/lib/streamer-spawn-presets";

const STREAMER_WH_SECRET_STORAGE = "rustmaxx_streamer_wh";

function persistWebhookSecret(publicId: string | undefined, secret: string) {
  if (typeof window === "undefined" || !publicId || !secret) return;
  try {
    sessionStorage.setItem(
      STREAMER_WH_SECRET_STORAGE,
      JSON.stringify({ publicId, secret })
    );
  } catch {
    /* ignore quota */
  }
}

function readWebhookSecretFromStorage(publicId: string | undefined): string | null {
  if (typeof window === "undefined" || !publicId) return null;
  try {
    const raw = sessionStorage.getItem(STREAMER_WH_SECRET_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { publicId?: string; secret?: string };
    if (parsed.publicId === publicId && typeof parsed.secret === "string" && parsed.secret) {
      return parsed.secret;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Full hook URL for TikFinity: token + rule name as `action` (empty-body safe). */
function fullRuleWebhookUrl(
  webhookBase: string | null,
  secret: string | null,
  ruleEventName: string
): string | null {
  const name = ruleEventName.trim();
  if (!webhookBase || !secret || !name) return null;
  return `${webhookBase}?token=${encodeURIComponent(secret)}&action=${encodeURIComponent(name)}`;
}

type State = {
  user: {
    email: string;
    role: string;
    steamId: string | null;
    steamLinkedAt: string | null;
    subscriptionStatus: string;
    billingOk: boolean;
    dashboardOk: boolean;
  };
  hook: {
    publicId: string;
    serverId: string;
    serverName: string | null;
    webhookUrl: string | null;
  } | null;
  rules: Array<{
    id: string;
    name: string;
    server_action: string;
    message: string | null;
    scrap_amount: number;
    npc_template_key: string | null;
  }>;
  allowedStreamerItems: Array<{
    shortname: string;
    label: string;
    category: string;
    amount: number;
  }>;
};

type ServerRow = { id: string; name: string; listing_name: string | null };

type ActionOpt = {
  action: string;
  label: string;
  description: string;
};

export default function StreamerDashboardPage() {
  const [state, setState] = useState<State | null>(null);
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [actions, setActions] = useState<ActionOpt[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [serverId, setServerId] = useState("");
  const [secretShown, setSecretShown] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);
  const [copiedRuleId, setCopiedRuleId] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [ruleAction, setRuleAction] = useState("");
  const [npcTemplate, setNpcTemplate] = useState("");
  const [quickAdding, setQuickAdding] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr("");
    const [sRes, srvRes, actRes] = await Promise.all([
      fetch("/api/streamer/state", { credentials: "same-origin" }),
      fetch("/api/streamer/servers", { credentials: "same-origin" }),
      fetch("/api/streamer/action-options", { credentials: "same-origin" }),
    ]);
    if (sRes.status === 401) {
      setState(null);
      setLoading(false);
      return;
    }
    const sJson = await sRes.json().catch(() => ({}));
    if (!sRes.ok) {
      setErr(sJson.error ?? "Could not load dashboard");
      setLoading(false);
      return;
    }
    const raw = sJson as Record<string, unknown>;
    setState({
      ...raw,
      allowedStreamerItems: Array.isArray(raw.allowedStreamerItems)
        ? (raw.allowedStreamerItems as State["allowedStreamerItems"])
        : [],
    } as State);
    if (srvRes.ok) {
      const j = await srvRes.json().catch(() => ({}));
      setServers(j.servers ?? []);
    }
    if (actRes.ok) {
      const j = await actRes.json().catch(() => ({}));
      const opts = (j.actions ?? []).map(
        (a: { action: string; label: string; description: string }) => ({
          action: a.action,
          label: a.label,
          description: a.description,
        })
      );
      setActions(opts);
      setRuleAction((prev) => prev || opts[0]?.action || "");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (state?.hook?.serverId) setServerId(state.hook.serverId);
  }, [state?.hook?.serverId]);

  useEffect(() => {
    const publicId = state?.hook?.publicId;
    if (!publicId || typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(STREAMER_WH_SECRET_STORAGE);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { publicId?: string; secret?: string };
      if (parsed.publicId === publicId && typeof parsed.secret === "string" && parsed.secret) {
        setSecretShown(parsed.secret);
      } else if (parsed.publicId && parsed.publicId !== publicId) {
        sessionStorage.removeItem(STREAMER_WH_SECRET_STORAGE);
      }
    } catch {
      sessionStorage.removeItem(STREAMER_WH_SECRET_STORAGE);
    }
  }, [state?.hook?.publicId]);

  async function saveWebhook(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setSecretShown(null);
    const res = await fetch("/api/streamer/webhook", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error ?? "Save failed");
      return;
    }
    if (data.webhookSecret) {
      setSecretShown(data.webhookSecret);
      const pid =
        typeof data.hook?.publicId === "string" ? data.hook.publicId : undefined;
      persistWebhookSecret(pid, data.webhookSecret);
    }
    await load();
  }

  async function rotateSecret() {
    setErr("");
    const publicId = state?.hook?.publicId;
    setSecretShown(null);
    const res = await fetch("/api/streamer/webhook/rotate", {
      method: "POST",
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error ?? "Rotate failed");
      return;
    }
    if (data.webhookSecret) {
      setSecretShown(data.webhookSecret);
      persistWebhookSecret(publicId, data.webhookSecret);
    }
  }

  async function copyFullWebhookUrl(fullUrl: string) {
    setErr("");
    try {
      await navigator.clipboard.writeText(fullUrl);
      setUrlCopied(true);
      window.setTimeout(() => setUrlCopied(false), 2000);
    } catch {
      setErr("Could not copy to clipboard");
    }
  }

  async function copyRuleWebhookUrl(fullUrl: string, ruleId: string) {
    setErr("");
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopiedRuleId(ruleId);
      window.setTimeout(() => setCopiedRuleId(null), 2000);
    } catch {
      setErr("Could not copy to clipboard");
    }
  }

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const body: Record<string, unknown> = {
      name: ruleName,
      serverAction: ruleAction,
    };
    if (ruleAction === "npcmaxx" && npcTemplate.trim()) {
      body.npcTemplateKey = npcTemplate.trim();
    }
    const res = await fetch("/api/streamer/rules", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error ?? "Could not add rule");
      return;
    }
    setRuleName("");
    await load();
  }

  async function addQuickPreset(preset: (typeof STREAMER_SPAWN_PRESETS)[number]) {
    setErr("");
    setQuickAdding(preset.ruleName);
    try {
      const res = await fetch("/api/streamer/rules", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: preset.ruleName,
          serverAction: preset.serverAction,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof data.error === "string" ? data.error : "Could not add rule");
        return;
      }
      setRuleName("");
      await load();
    } finally {
      setQuickAdding(null);
    }
  }

  async function deleteRule(id: string) {
    setErr("");
    const res = await fetch(`/api/streamer/rules/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErr(data.error ?? "Delete failed");
      return;
    }
    await load();
  }

  async function startCheckout() {
    setErr("");
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error ?? "Checkout unavailable");
      return;
    }
    if (data.url) window.location.href = data.url;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-zinc-400">
        Loading…
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <p className="text-zinc-300">Sign in to manage your streamer webhook.</p>
        <Link
          href="/login?from=/streamer"
          className="rounded-lg bg-rust-cyan px-4 py-2 text-sm font-medium text-zinc-950"
        >
          Log in
        </Link>
      </div>
    );
  }

  const { user, hook, rules, allowedStreamerItems = [] } = state;
  const fullTikfinityUrl =
    hook?.webhookUrl && secretShown
      ? `${hook.webhookUrl}?token=${encodeURIComponent(secretShown)}`
      : null;
  /** TikFinity often sends an empty POST body; `&action=` matches your Event → action rule name. */
  const exampleRuleForUrl =
    rules.find((r) => r.name.toLowerCase().trim() === "wolf")?.name ??
    rules[0]?.name ??
    "wolf";
  const fullTikfinityUrlWithRuleAction =
    fullTikfinityUrl && exampleRuleForUrl
      ? `${fullTikfinityUrl}&action=${encodeURIComponent(exampleRuleForUrl)}`
      : null;

  const hookSecretForRules =
    secretShown ?? (hook?.publicId ? readWebhookSecretFromStorage(hook.publicId) : null);

  return (
    <div className="mx-auto min-h-screen max-w-3xl p-6">
      <div className="mb-8 flex flex-col items-center gap-2">
        <Logo
          className="h-24 w-auto"
          width={480}
          height={96}
          fallbackClassName="text-2xl font-bold text-rust-cyan"
        />
        <h1 className="text-xl font-semibold text-zinc-100">Streamer interactions</h1>
        <p className="text-center text-sm text-zinc-400">
          Add your Steam64, pick a server, then copy one webhook line from below into TikFinity — no separate token step.
        </p>
      </div>

      {err ? (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {err}
        </div>
      ) : null}

      <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Account</h2>
        <p className="text-sm text-zinc-300">{user.email}</p>
        <p className="mt-1 text-xs text-zinc-500">
          Subscription: {user.subscriptionStatus} · Billing gate: {user.billingOk ? "ok" : "inactive"}
        </p>
        {!user.billingOk ? (
          <button
            type="button"
            onClick={() => startCheckout()}
            className="mt-3 rounded-lg bg-rust-cyan px-4 py-2 text-sm font-medium text-zinc-950"
          >
            Subscribe with Stripe
          </button>
        ) : null}
      </section>

      <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Steam</h2>
        <p className="mb-3 text-sm text-zinc-400">
          Use the same Steam64 as in-game (TikFinity anchor / patrol). You can also set this on{" "}
          <Link href="/profile#steam" className="text-rust-cyan hover:underline">
            Profile
          </Link>
          .
        </p>
        <SteamIdForm
          initialSteamId={user.steamId}
          onSaved={() => void load()}
        />
      </section>

      <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Game server</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Choose which RustMaxx server receives TikFinity actions, then use the single line in the box below in
          TikFinity.
        </p>
        <form onSubmit={saveWebhook} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-zinc-500">RustMaxx server</label>
            <select
              value={serverId || hook?.serverId || ""}
              onChange={(e) => setServerId(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
              required
            >
              <option value="">Select server…</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.listing_name || s.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
          >
            Save webhook
          </button>
        </form>

        {hook?.webhookUrl ? (
          <div className="mt-6 rounded-lg border border-emerald-900/50 bg-zinc-950/60 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-600/90">
              TikFinity — copy one line
            </h3>
            {fullTikfinityUrl ? (
              <>
                <p className="mb-3 text-sm text-zinc-300">
                  Paste this entire string into TikFinity as the webhook URL. It already includes your secret — you do
                  not need to copy anything else.
                </p>
                <code className="mb-3 block break-all rounded border border-emerald-900/40 bg-black/40 p-3 text-xs leading-relaxed text-emerald-300">
                  {fullTikfinityUrl}
                </code>
                <button
                  type="button"
                  onClick={() => void copyFullWebhookUrl(fullTikfinityUrl)}
                  className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 sm:w-auto"
                >
                  {urlCopied ? "Copied to clipboard" : "Copy webhook URL"}
                </button>
                <div className="mt-4 rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-100/95">
                  <p className="mb-2 font-medium text-amber-50">
                    Seeing{" "}
                    <code className="rounded bg-zinc-900 px-1 text-[11px] text-amber-200">
                      skipped / empty body
                    </code>{" "}
                    in TikFinity?
                  </p>
                  <p className="mb-2 text-amber-100/85">
                    TikFinity often does not send JSON. Put the rule name on the URL instead (must match an{" "}
                    <strong className="font-medium text-zinc-100">Event → action</strong> rule below). Example uses rule{" "}
                    <code className="rounded bg-zinc-900 px-1">{exampleRuleForUrl}</code>:
                  </p>
                  {fullTikfinityUrlWithRuleAction ? (
                    <>
                      <code className="mb-2 block break-all rounded border border-amber-900/40 bg-black/35 p-2 text-[11px] leading-relaxed text-emerald-200/95">
                        {fullTikfinityUrlWithRuleAction}
                      </code>
                      <button
                        type="button"
                        onClick={() => void copyFullWebhookUrl(fullTikfinityUrlWithRuleAction)}
                        className="rounded-lg border border-amber-700/80 bg-amber-900/30 px-3 py-1.5 text-[11px] font-medium text-amber-100 hover:bg-amber-900/50"
                      >
                        Copy URL with &amp;action=
                      </button>
                    </>
                  ) : null}
                  <p className="mt-2 text-[11px] text-zinc-500">
                    Or set TikFinity custom / Raw JSON to{" "}
                    <code className="rounded bg-zinc-800 px-1 text-zinc-300">{`{"action":"${exampleRuleForUrl}"}`}</code>.
                  </p>
                </div>
                {secretShown ? (
                  <div className="mt-4 border-t border-zinc-800 pt-4">
                    <p className="mb-1 text-xs text-zinc-500">
                      Only if TikFinity asks for a <span className="text-zinc-400">token</span> or{" "}
                      <span className="text-zinc-400">secret</span> in a separate field (optional):
                    </p>
                    <code className="block break-all rounded bg-zinc-900/80 p-2 text-xs text-zinc-400">{secretShown}</code>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => rotateSecret()}
                  className="mt-4 text-xs text-rust-cyan hover:underline"
                >
                  Generate new secret (invalidates the URL above until you copy the new line)
                </button>
              </>
            ) : (
              <>
                <p className="mb-3 text-sm text-zinc-400">
                  To show the full URL here, save this webhook for the first time or click below. The complete line
                  appears once — then use <strong className="font-medium text-zinc-200">Copy webhook URL</strong> only.
                </p>
                <code className="mb-3 block break-all rounded border border-zinc-800 bg-black/30 p-3 text-xs text-zinc-600">
                  {hook.webhookUrl}?token=…
                </code>
                <button
                  type="button"
                  onClick={() => rotateSecret()}
                  className="rounded-lg border border-emerald-800/80 bg-emerald-950/40 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-900/40"
                >
                  Show full webhook URL
                </button>
                <p className="mt-2 text-xs text-zinc-600">Same as &quot;Generate new secret&quot; if you already had a webhook.</p>
              </>
            )}
          </div>
        ) : null}
      </section>

      {hook && allowedStreamerItems.length > 0 ? (
        <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Rust items (this server)
          </h2>
          <p className="mb-3 text-xs text-zinc-500">
            The server owner enabled these items for your streamer setup (reference for gifts / rules). They do not
            spawn in-game by themselves.
          </p>
          <ul className="flex flex-wrap gap-2">
            {allowedStreamerItems.map((it) => (
              <li
                key={it.shortname}
                className="rounded border border-zinc-700 bg-zinc-950/50 px-2 py-1 text-xs text-zinc-300"
              >
                <span className="text-zinc-200">{it.label}</span>{" "}
                <code className="text-emerald-600/80">{it.shortname}</code>{" "}
                <span className="text-zinc-600">×{it.amount}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Event → action rules
        </h2>
        <p className="mb-4 text-xs text-zinc-500">
          When TikFinity sends an event name (e.g. in <code>action</code> or chat fields) matching a rule, that server
          action runs — same as Admin → Streamer interactions. Use <strong className="font-medium text-zinc-300">Copy
          webhook</strong> on a rule to paste the full URL (token + <code className="rounded bg-zinc-800 px-1">action</code>
          ) into TikFinity when it sends an empty body.
        </p>

        <div className="mb-6 rounded-lg border border-zinc-700/80 bg-zinc-950/40 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Quick spawns (Rust)
          </h3>
          <p className="mb-3 text-xs text-zinc-500">
            One-click rules for common RustChaos spawns. TikFinity should send an event name that matches the rule (e.g.{" "}
            <code className="rounded bg-zinc-800 px-1">bear</code>, <code className="rounded bg-zinc-800 px-1">wolf</code>
            , <code className="rounded bg-zinc-800 px-1">scientist</code>) or use{" "}
            <code className="rounded bg-zinc-800 px-1">?action=bear</code> on your webhook URL.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {STREAMER_SPAWN_PRESETS.map((p) => (
              <button
                key={p.ruleName}
                type="button"
                disabled={quickAdding !== null}
                onClick={() => void addQuickPreset(p)}
                className="rounded-lg border border-zinc-600 bg-zinc-800/80 px-3 py-3 text-left text-sm transition-colors hover:border-rust-cyan/50 hover:bg-zinc-800 disabled:opacity-50"
              >
                <span className="font-medium text-zinc-100">{p.label}</span>
                <span className="mt-1 block text-xs text-zinc-500">{p.description}</span>
                <span className="mt-2 block font-mono text-[10px] text-emerald-600/90">
                  rule: {p.ruleName} → {p.serverAction}
                </span>
                {quickAdding === p.ruleName ? (
                  <span className="mt-1 block text-xs text-rust-cyan">Adding…</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={addRule} className="mb-6 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">TikFinity event name</label>
            <input
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="e.g. rose or !bunny1"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Server action</label>
            <select
              value={ruleAction}
              onChange={(e) => setRuleAction(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
            >
              {actions.map((a) => (
                <option key={a.action} value={a.action}>
                  {a.label} ({a.action})
                </option>
              ))}
            </select>
          </div>
          {ruleAction === "npcmaxx" ? (
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-zinc-500">Roaming template key (required)</label>
              <input
                value={npcTemplate}
                onChange={(e) => setNpcTemplate(e.target.value)}
                placeholder="streamer_patrol"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
              />
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900"
            >
              Add rule
            </button>
          </div>
        </form>
        <ul className="space-y-2">
          {rules.map((r) => {
            const ruleUrl = fullRuleWebhookUrl(hook?.webhookUrl ?? null, hookSecretForRules, r.name);
            return (
              <li
                key={r.id}
                className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <span>
                  <code className="text-emerald-300">{r.name}</code> →{" "}
                  <code className="text-zinc-300">{r.server_action}</code>
                </span>
                <div className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-3">
                  {ruleUrl ? (
                    <button
                      type="button"
                      onClick={() => void copyRuleWebhookUrl(ruleUrl, r.id)}
                      className="rounded-md border border-emerald-800/70 bg-emerald-950/40 px-2.5 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-900/50"
                    >
                      {copiedRuleId === r.id ? "Copied" : "Copy webhook"}
                    </button>
                  ) : (
                    <span className="text-[11px] text-zinc-600" title="Save webhook or open Game server above to reveal token">
                      Webhook needs token
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteRule(r.id)}
                    className="text-xs text-red-400 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
          {rules.length === 0 ? (
            <li className="text-sm text-zinc-500">No rules yet.</li>
          ) : null}
        </ul>
      </section>

      <p className="mt-8 text-center text-xs text-zinc-600">
        <Link href="/servers" className="text-zinc-500 hover:text-zinc-300">
          ← Back to servers
        </Link>
      </p>
    </div>
  );
}
