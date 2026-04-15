"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/marketing/Logo";
import { SteamIdForm } from "@/components/profile/SteamIdForm";
import { STREAMER_SPAWN_PRESETS } from "@/lib/streamer-spawn-presets";
import { isRustChaosStatusEffectAction } from "@/lib/tikfinity";

const LEGACY_WH_STORAGE = "rustmaxx_streamer_wh";
const SECRET_MAP_KEY = "rustmaxx_streamer_wh_by_pub";

function loadSecretMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(SECRET_MAP_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string>;
    const old = sessionStorage.getItem(LEGACY_WH_STORAGE);
    if (old) {
      const p = JSON.parse(old) as { publicId?: string; secret?: string };
      if (p.publicId && p.secret) {
        const m = { [p.publicId]: p.secret };
        sessionStorage.setItem(SECRET_MAP_KEY, JSON.stringify(m));
        sessionStorage.removeItem(LEGACY_WH_STORAGE);
        return m;
      }
    }
  } catch {
    /* ignore */
  }
  return {};
}

function persistSecretForPublicId(publicId: string | undefined, secret: string) {
  if (typeof window === "undefined" || !publicId || !secret) return;
  try {
    const m = loadSecretMap();
    m[publicId] = secret;
    sessionStorage.setItem(SECRET_MAP_KEY, JSON.stringify(m));
  } catch {
    /* ignore quota */
  }
}

function readSecretForPublicId(publicId: string | undefined): string | null {
  if (!publicId) return null;
  const m = loadSecretMap();
  return m[publicId] ?? null;
}

/** Full hook URL for TikFinity: token + resolved server action as `action` (empty-body safe). */
function fullRuleWebhookUrl(
  webhookBase: string | null,
  secret: string | null,
  serverAction: string
): string | null {
  const name = serverAction.trim();
  if (!webhookBase || !secret || !name) return null;
  return `${webhookBase}?token=${encodeURIComponent(secret)}&action=${encodeURIComponent(name)}`;
}

type HookSummary = {
  id: string;
  publicId: string;
  serverId: string;
  serverName: string | null;
  webhookUrl: string | null;
};

type RuleRow = {
  id: string;
  hookId: string;
  serverId: string;
  serverName: string | null;
  name: string;
  server_action: string;
  message: string | null;
  scrap_amount: number;
  duration_seconds: number;
  npc_template_key: string | null;
  created_at: string;
};

type ItemRow = {
  shortname: string;
  label: string;
  category: string;
  amount: number;
  max_amount: number;
  give_mode: "single" | "quantity";
  stack_cap: number;
};

type State = {
  user: {
    email: string;
    role: string;
    steamId: string | null;
    steamLinkedAt: string | null;
    subscriptionStatus: string;
    billingOk: boolean;
    dashboardOk: boolean;
    streamerTier: "free" | "plus" | "max";
    streamerWebhookLimit: number;
    streamerWebhookCount: number;
  };
  hooks: HookSummary[];
  rules: RuleRow[];
  allowedStreamerItemsByServer: Array<{
    serverId: string;
    serverName: string | null;
    items: ItemRow[];
  }>;
};

type ServerRow = {
  id: string;
  name: string;
  listing_name: string | null;
  streamer_interactions_enabled: boolean;
};

type ActionOpt = {
  action: string;
  label: string;
  description: string;
};

export default function StreamerDashboardPage() {
  const [state, setState] = useState<State | null>(null);
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [serversLoadError, setServersLoadError] = useState<string | null>(null);
  const [actions, setActions] = useState<ActionOpt[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [serverId, setServerId] = useState("");
  /** Revealed token per webhook public_id (also persisted in sessionStorage). */
  const [secretByPublicId, setSecretByPublicId] = useState<Record<string, string>>({});
  const [ruleTargetHookId, setRuleTargetHookId] = useState("");
  const [urlCopied, setUrlCopied] = useState(false);
  const [copiedRuleId, setCopiedRuleId] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [ruleAction, setRuleAction] = useState("");
  const [npcTemplate, setNpcTemplate] = useState("");
  const [ruleDurationSeconds, setRuleDurationSeconds] = useState("10");
  const [quickAdding, setQuickAdding] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr("");
    setServersLoadError(null);
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
    const u = raw.user as Record<string, unknown> | undefined;
    const tierRaw = u?.streamerTier;
    const streamerTier: State["user"]["streamerTier"] =
      tierRaw === "plus" || tierRaw === "max" ? tierRaw : "free";
    setState({
      user: {
        ...(u as State["user"]),
        streamerTier,
        streamerWebhookLimit:
          typeof u?.streamerWebhookLimit === "number" ? u.streamerWebhookLimit : 5,
        streamerWebhookCount:
          typeof u?.streamerWebhookCount === "number" ? u.streamerWebhookCount : 0,
      },
      hooks: Array.isArray(raw.hooks) ? (raw.hooks as HookSummary[]) : [],
      rules: Array.isArray(raw.rules) ? (raw.rules as RuleRow[]) : [],
      allowedStreamerItemsByServer: Array.isArray(raw.allowedStreamerItemsByServer)
        ? (raw.allowedStreamerItemsByServer as State["allowedStreamerItemsByServer"])
        : [],
    });
    if (srvRes.ok) {
      const j = await srvRes.json().catch(() => ({}));
      const raw = Array.isArray(j.servers) ? j.servers : [];
      const normalized: ServerRow[] = raw.map((s: Record<string, unknown>) => ({
        id: String(s.id ?? ""),
        name: String(s.name ?? ""),
        listing_name: typeof s.listing_name === "string" ? s.listing_name : null,
        streamer_interactions_enabled: Boolean(s.streamer_interactions_enabled),
      }));
      normalized.sort((a, b) => {
        if (a.streamer_interactions_enabled !== b.streamer_interactions_enabled) {
          return a.streamer_interactions_enabled ? -1 : 1;
        }
        return (a.listing_name || a.name).localeCompare(b.listing_name || b.name);
      });
      setServers(normalized);
    } else {
      const ej = await srvRes.json().catch(() => ({}));
      setServersLoadError(
        typeof ej.error === "string" ? ej.error : `Could not load servers (HTTP ${srvRes.status}).`
      );
      setServers([]);
    }
    if (actRes.ok) {
      const j = (await actRes.json().catch(() => ({}))) as Record<string, unknown>;
      const rawActs = Array.isArray(j.actions) ? j.actions : [];
      const opts = rawActs.map((a) => {
        const x = a as { action: string; label: string; description: string };
        return { action: x.action, label: x.label, description: x.description };
      });
      setActions(opts);
      setRuleAction((prev) => prev || opts[0]?.action || "");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSecretByPublicId((prev) => ({ ...loadSecretMap(), ...prev }));
  }, []);

  useEffect(() => {
    const hooks = state?.hooks ?? [];
    if (hooks.length === 0) {
      setRuleTargetHookId("");
      return;
    }
    setRuleTargetHookId((cur) => (cur && hooks.some((h) => h.id === cur) ? cur : hooks[0]!.id));
  }, [state?.hooks]);

  useEffect(() => {
    if (!ruleTargetHookId) return;
    fetch(`/api/streamer/action-options?hookId=${encodeURIComponent(ruleTargetHookId)}`, {
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : {}))
      .then((j: Record<string, unknown>) => {
        const rawActs = Array.isArray(j.actions) ? j.actions : [];
        const opts = rawActs.map((a) => {
          const x = a as { action: string; label: string; description: string };
          return {
            action: x.action,
            label: x.label,
            description: x.description,
          };
        });
        setActions(opts);
        setRuleAction((prev) => (opts.some((o: ActionOpt) => o.action === prev) ? prev : opts[0]?.action || ""));
      })
      .catch(() => {});
  }, [ruleTargetHookId]);

  async function saveWebhook(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
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
    if (data.webhookSecret && data.hook?.publicId) {
      const pid = String(data.hook.publicId);
      persistSecretForPublicId(pid, data.webhookSecret);
      setSecretByPublicId((prev) => ({ ...prev, [pid]: data.webhookSecret }));
    }
    setServerId("");
    await load();
  }

  async function rotateSecretForHook(hookId: string) {
    setErr("");
    const res = await fetch("/api/streamer/webhook/rotate", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hookId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error ?? "Rotate failed");
      return;
    }
    if (data.webhookSecret) {
      const h = state?.hooks.find((x) => x.id === hookId);
      const publicId = h?.publicId;
      if (publicId) {
        persistSecretForPublicId(publicId, data.webhookSecret);
        setSecretByPublicId((prev) => ({ ...prev, [publicId]: data.webhookSecret }));
      }
    }
  }

  async function removeWebhook(hookId: string) {
    if (!window.confirm("Remove this webhook and its TikFinity URL? Rules for this server will be deleted.")) {
      return;
    }
    setErr("");
    const res = await fetch(`/api/streamer/webhook/${encodeURIComponent(hookId)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error ?? "Remove failed");
      return;
    }
    await load();
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
    if (!ruleTargetHookId) {
      setErr("Choose which server’s webhook should receive this rule (Rules for server).");
      return;
    }
    const body: Record<string, unknown> = {
      hookId: ruleTargetHookId,
      name: ruleName,
      serverAction: ruleAction,
    };
    if (ruleAction === "npcmaxx" && npcTemplate.trim()) {
      body.npcTemplateKey = npcTemplate.trim();
    }
    if (isRustChaosStatusEffectAction(ruleAction)) {
      const n = parseInt(ruleDurationSeconds.trim(), 10);
      body.durationSeconds = Number.isFinite(n) ? Math.min(120, Math.max(1, n)) : 10;
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
    setRuleDurationSeconds("10");
    await load();
  }

  async function addQuickPreset(preset: (typeof STREAMER_SPAWN_PRESETS)[number]) {
    setErr("");
    if (!ruleTargetHookId) {
      setErr("Choose Rules for server first.");
      return;
    }
    setQuickAdding(preset.ruleName);
    try {
      const res = await fetch("/api/streamer/rules", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hookId: ruleTargetHookId,
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

  async function startStreamerCheckout(tier: "plus" | "max") {
    setErr("");
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ kind: "streamer", tier }),
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

  const { user, hooks, rules, allowedStreamerItemsByServer = [] } = state;

  const firstHook = hooks[0];
  const firstPublicId = firstHook?.publicId;
  const firstSecret =
    (firstPublicId && (secretByPublicId[firstPublicId] ?? readSecretForPublicId(firstPublicId))) || null;
  const firstUrl =
    firstHook?.webhookUrl && firstSecret
      ? `${firstHook.webhookUrl}?token=${encodeURIComponent(firstSecret)}`
      : null;
  /** TikFinity often sends an empty POST body; force the final in-game action key in URL. */
  const exampleRuleForUrl =
    rules.find((r) => r.server_action.toLowerCase().trim() === "wolf")?.server_action ??
    rules[0]?.server_action ??
    "wolf";
  const fullTikfinityUrlWithRuleAction =
    firstUrl && exampleRuleForUrl
      ? `${firstUrl}&action=${encodeURIComponent(exampleRuleForUrl)}`
      : null;

  const serverIdsWithHooks = new Set(hooks.map((h) => h.serverId));
  const serversAvailableToAdd = servers.filter((s) => !serverIdsWithHooks.has(s.id));
  const serverForAdd = servers.find((s) => s.id === serverId);
  const canSubmitWebhookAdd = Boolean(serverId);

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
          Add your Steam64, connect one or more servers (each gets its own TikFinity URL), then copy the lines into
          TikFinity.
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
          Streamer plan:{" "}
          <span className="text-zinc-300 capitalize">{user.streamerTier}</span>
          {" · "}
          Webhooks: {user.streamerWebhookCount}/{user.streamerWebhookLimit}
        </p>
        <p className="mt-1 text-[11px] text-zinc-600">
          Stripe subscription: {user.subscriptionStatus}
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">Viewer-based perks — coming soon.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {user.streamerTier === "free" ? (
            <>
              <button
                type="button"
                onClick={() => void startStreamerCheckout("plus")}
                className="rounded-lg bg-rust-cyan px-4 py-2 text-sm font-medium text-zinc-950"
              >
                Upgrade to Plus — $19.99/mo
              </button>
              <button
                type="button"
                onClick={() => void startStreamerCheckout("max")}
                className="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700"
              >
                Upgrade to Max — $39.99/mo
              </button>
            </>
          ) : user.streamerTier === "plus" ? (
            <button
              type="button"
              onClick={() => void startStreamerCheckout("max")}
              className="rounded-lg bg-rust-cyan px-4 py-2 text-sm font-medium text-zinc-950"
            >
              Upgrade to Max — $39.99/mo
            </button>
          ) : null}
          <Link href="/pricing" className="text-sm text-rust-cyan hover:underline">
            Pricing
          </Link>
          <Link href="/streamer/tiktok-live" className="text-sm text-rust-cyan hover:underline">
            TikTok Live (Direct)
          </Link>
        </div>
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
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Game servers &amp; webhooks</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Add each RustMaxx server you want TikFinity to drive — you get a <strong className="text-zinc-400">separate URL</strong>{" "}
          per server. Servers you own or are on the team for always appear here. Other servers appear when they turn on{" "}
          <strong className="text-zinc-400">Streamer interactions</strong>, or when you have an{" "}
          <strong className="text-zinc-400">approved</strong> access request (you may see the server listed before the owner
          finishes setup). Use the public{" "}
          <Link href="/server-list" className="text-rust-cyan hover:underline">
            server list
          </Link>{" "}
          to request access if the owner requires approval.
        </p>
        {serversLoadError ? (
          <p className="mb-4 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">
            {serversLoadError}
          </p>
        ) : null}
        {!serversLoadError && servers.length === 0 ? (
          <p className="mb-4 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-sm text-amber-100/95">
            No servers are available yet. If this is your server, open{" "}
            <Link href="/servers" className="text-rust-cyan hover:underline">
              Servers
            </Link>
            , pick it, go to <strong className="text-zinc-100">Streamer interactions</strong>, and turn on{" "}
            <em>Allow streamers to use this server for TikFinity webhooks</em> (Pro plan may be required), then save and
            refresh this page. If you requested access from the server list, wait for the owner to approve and enable
            TikFinity — the server will show here once you are approved.
          </p>
        ) : null}

        {hooks.length > 0 ? (
          <ul className="mb-6 space-y-4">
            {hooks.map((h) => {
              const token = secretByPublicId[h.publicId] ?? readSecretForPublicId(h.publicId);
              const fullUrl =
                h.webhookUrl && token
                  ? `${h.webhookUrl}?token=${encodeURIComponent(token)}`
                  : null;
              return (
                <li
                  key={h.id}
                  className="rounded-lg border border-emerald-900/40 bg-zinc-950/60 p-4"
                >
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-zinc-200">
                        {h.serverName ?? "Server"}
                      </p>
                      <p className="text-[11px] text-zinc-500">One TikFinity URL per server — use a different RustMaxx preset in TikFinity if you run multiple channels.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeWebhook(h.id)}
                      className="shrink-0 text-xs text-red-400 hover:underline"
                    >
                      Remove webhook
                    </button>
                  </div>
                  {fullUrl ? (
                    <>
                      <code className="mb-2 block break-all rounded border border-emerald-900/40 bg-black/40 p-2 text-[11px] leading-relaxed text-emerald-300">
                        {fullUrl}
                      </code>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void copyFullWebhookUrl(fullUrl)}
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
                        >
                          {urlCopied ? "Copied" : "Copy webhook URL"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void rotateSecretForHook(h.id)}
                          className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
                        >
                          New secret
                        </button>
                      </div>
                      {token ? (
                        <p className="mt-2 text-[10px] text-zinc-600">
                          Optional separate token field: <code className="text-zinc-400">{token}</code>
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <code className="mb-2 block break-all rounded border border-zinc-800 bg-black/30 p-2 text-[11px] text-zinc-600">
                        {h.webhookUrl}?token=…
                      </code>
                      <button
                        type="button"
                        onClick={() => void rotateSecretForHook(h.id)}
                        className="rounded-lg border border-emerald-800/80 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-900/40"
                      >
                        Reveal URL (new secret)
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-zinc-500">No webhooks yet — add a server below.</p>
        )}

        {hooks.length > 0 && firstUrl ? (
          <div className="mb-6 rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-100/95">
            <p className="mb-2 font-medium text-amber-50">
              Seeing{" "}
              <code className="rounded bg-zinc-900 px-1 text-[11px] text-amber-200">skipped / empty body</code> in
              TikFinity? (example for your first server)
            </p>
            {fullTikfinityUrlWithRuleAction ? (
              <>
                <code className="mb-2 block break-all rounded border border-amber-900/40 bg-black/35 p-2 text-[11px] text-emerald-200/95">
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
          </div>
        ) : null}

        {serversAvailableToAdd.length > 0 ? (
          <form onSubmit={saveWebhook} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-zinc-500">
                {hooks.length > 0 ? "Add another server" : "Add a server"}
              </label>
              <select
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
                required
              >
                <option value="">Select server…</option>
                {serversAvailableToAdd.map((s) => {
                  const label = s.listing_name || s.name;
                  const ready = s.streamer_interactions_enabled;
                  return (
                    <option key={s.id} value={s.id}>
                      {ready
                        ? label
                        : `${label} — waiting for server owner to enable TikFinity / Streamer interactions`}
                    </option>
                  );
                })}
              </select>
            </div>
            <button
              type="submit"
              disabled={!canSubmitWebhookAdd}
              title={
                !serverId
                  ? "Choose a server"
                  : !serverForAdd
                    ? "Choose a server"
                    : undefined
              }
              className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add webhook
            </button>
          </form>
        ) : null}
        {serversAvailableToAdd.length > 0 && serverId && serverForAdd && !serverForAdd.streamer_interactions_enabled ? (
          <p className="mb-4 text-xs text-amber-200/90">
            TikFinity is not enabled on this server yet. The owner must turn on{" "}
            <strong className="text-amber-100">Streamer interactions</strong> under{" "}
            <strong className="text-amber-100">Server → Streamer interactions</strong> (and meet the server plan) before
            you can add a webhook here.
          </p>
        ) : null}
        {serversAvailableToAdd.length > 0 ? null : servers.length > 0 && hooks.length > 0 ? (
          <p className="text-xs text-zinc-500">Every available server already has a webhook. Remove one above to reassign.</p>
        ) : null}
      </section>

      {allowedStreamerItemsByServer.length > 0 ? (
        <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Rust items (by server)
          </h2>
          <div className="space-y-4">
            {allowedStreamerItemsByServer.map((block) => (
              <div key={block.serverId}>
                <p className="mb-2 text-xs font-medium text-zinc-400">
                  {block.serverName ?? block.serverId}
                </p>
                <ul className="flex flex-wrap gap-2">
                  {block.items.map((it) => (
                    <li
                      key={`${block.serverId}-${it.shortname}`}
                      className="rounded border border-zinc-700 bg-zinc-950/50 px-2 py-1 text-xs text-zinc-300"
                    >
                      <span className="text-zinc-200">{it.label}</span>{" "}
                      <code className="text-emerald-600/80">{it.shortname}</code>{" "}
                      <span className="ml-1 rounded bg-zinc-800 px-1 text-[10px] text-zinc-500">
                        {it.give_mode === "single" ? "single" : "qty"}
                      </span>
                      <span className="text-zinc-600">
                        {it.give_mode === "single"
                          ? " · ×1"
                          : ` · default ${it.amount} · max ${it.max_amount} (stack ${it.stack_cap})`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Event → action rules
        </h2>
        <p className="mb-4 text-xs text-zinc-500">
          Rules belong to <strong className="text-zinc-400">one server webhook</strong> at a time. Pick which server below,
          then add rules or quick spawns. Use <strong className="font-medium text-zinc-300">Copy webhook</strong> on a rule
          for a URL that sends the final <code className="rounded bg-zinc-800 px-1">server action</code> directly (most
          reliable for empty-body TikFinity posts).
        </p>

        <div className="mb-4">
          <label className="mb-1 block text-xs text-zinc-500">Rules for server (webhook)</label>
          <select
            value={ruleTargetHookId}
            onChange={(e) => setRuleTargetHookId(e.target.value)}
            className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
          >
            {hooks.length === 0 ? (
              <option value="">Add a webhook under Game servers first</option>
            ) : (
              hooks.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.serverName ?? h.serverId}
                </option>
              ))
            )}
          </select>
        </div>

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
          {isRustChaosStatusEffectAction(ruleAction) ? (
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Effect duration (seconds)</label>
              <input
                type="number"
                min={1}
                max={120}
                value={ruleDurationSeconds}
                onChange={(e) => setRuleDurationSeconds(e.target.value)}
                className="w-full max-w-[10rem] rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-[11px] text-zinc-600">1–120. Applies to poison, thirst, hunger, bleed, and dart HUD effects.</p>
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
            const wh = hooks.find((x) => x.id === r.hookId);
            const sec =
              wh?.publicId != null
                ? secretByPublicId[wh.publicId] ?? readSecretForPublicId(wh.publicId)
                : null;
            const ruleUrl = fullRuleWebhookUrl(wh?.webhookUrl ?? null, sec ?? null, r.server_action);
            return (
              <li
                key={r.id}
                className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <span>
                  <span className="mr-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                    {r.serverName ?? "Server"}
                  </span>
                  <code className="text-emerald-300">{r.name}</code> →{" "}
                  <code className="text-zinc-300">{r.server_action}</code>
                  {isRustChaosStatusEffectAction(r.server_action) ? (
                    <span className="text-zinc-500"> · {r.duration_seconds ?? 10}s</span>
                  ) : null}
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
