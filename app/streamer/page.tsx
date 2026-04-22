"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/marketing/Logo";
import { SteamIdForm } from "@/components/profile/SteamIdForm";
import { STREAMER_SPAWN_PRESETS } from "@/lib/streamer-spawn-presets";
import {
  isRustChaosSoloScrapSpawnAction,
  isRustChaosStatusEffectAction,
  SOLO_SPAWN_REPEAT_MAX,
} from "@/lib/tikfinity";
import {
  buildStreamerHookQueryUrl,
  buildStreamerHookPathActionUrl,
  canBuildStreamerHookUrl,
  mergePresetParamsWithProfileAnchor,
  MAXX_GROUP_ORDER,
  MAXX_GROUP_TITLE,
  STREAMER_MAXXINVADERS_URL_PRESETS,
  webhookBaseUsesOpaqueSecret,
} from "@/lib/streamer-maxxinvaders-urls";

const LEGACY_WH_STORAGE = "rustmaxx_streamer_wh";
const SECRET_MAP_KEY = "rustmaxx_streamer_wh_by_pub";

type StoredSecretEntry = {
  secret: string;
  savedAt?: string;
};

function loadSecretMap(): Record<string, StoredSecretEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(SECRET_MAP_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string | StoredSecretEntry>;
      const out: Record<string, StoredSecretEntry> = {};
      for (const [publicId, val] of Object.entries(parsed)) {
        if (typeof val === "string") out[publicId] = { secret: val };
        else if (val && typeof val.secret === "string") out[publicId] = val;
      }
      return out;
    }
    const old = sessionStorage.getItem(LEGACY_WH_STORAGE);
    if (old) {
      const p = JSON.parse(old) as { publicId?: string; secret?: string };
      if (p.publicId && p.secret) {
        const m = { [p.publicId]: { secret: p.secret } };
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
    m[publicId] = { secret, savedAt: new Date().toISOString() };
    sessionStorage.setItem(SECRET_MAP_KEY, JSON.stringify(m));
  } catch {
    /* ignore quota */
  }
}

function legacyTokenForHook(
  h: { publicId: string; webhookUpdatedAt: string },
  secrets: Record<string, string>
): string | null {
  return secrets[h.publicId] ?? readSecretForPublicId(h.publicId, h.webhookUpdatedAt);
}

/** Full pasteable TikFinity base URL (opaque path, or legacy UUID + ?token=). */
function hookPasteableUrl(
  h: { webhookUrl: string | null; publicId: string; webhookUpdatedAt: string },
  secrets: Record<string, string>
): string | null {
  if (!h.webhookUrl) return null;
  if (webhookBaseUsesOpaqueSecret(h.webhookUrl)) return h.webhookUrl;
  const t = legacyTokenForHook(h, secrets);
  return t ? `${h.webhookUrl}?token=${encodeURIComponent(t)}` : null;
}

function readSecretForPublicId(
  publicId: string | undefined,
  webhookUpdatedAt?: string | null
): string | null {
  if (!publicId) return null;
  try {
    const m = loadSecretMap();
    const entry = m[publicId];
    if (!entry?.secret) return null;
    if (entry.savedAt && webhookUpdatedAt) {
      const savedMs = Date.parse(entry.savedAt);
      const hookMs = Date.parse(webhookUpdatedAt);
      if (Number.isFinite(savedMs) && Number.isFinite(hookMs) && savedMs + 1000 < hookMs) {
        return null;
      }
    }
    return entry.secret;
  } catch {
    return null;
  }
}

/**
 * Full URL for TikFinity: opaque path needs only `action=`; legacy URLs need `?token=&action=`.
 */
function fullRuleWebhookUrl(
  webhookBase: string | null,
  secret: string | null,
  serverAction: string,
  spawnCount?: number
): string | null {
  const name = serverAction.trim();
  if (!webhookBase || !name) return null;
  if (!canBuildStreamerHookUrl(webhookBase, secret)) return null;
  const c =
    typeof spawnCount === "number" &&
    Number.isFinite(spawnCount) &&
    spawnCount > 1
      ? Math.min(SOLO_SPAWN_REPEAT_MAX, Math.trunc(spawnCount))
      : 0;
  const params: Record<string, string> = { action: name };
  if (c > 1) params.count = String(c);
  if (webhookBaseUsesOpaqueSecret(webhookBase)) {
    return buildStreamerHookQueryUrl(webhookBase, null, params);
  }
  return buildStreamerHookQueryUrl(webhookBase, secret!, params);
}

type HookSummary = {
  id: string;
  publicId: string;
  serverId: string;
  serverName: string | null;
  webhookUrl: string | null;
  webhookUpdatedAt: string;
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
  spawn_count: number;
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
    id: string;
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

function getActionCategory(action: string): string {
  if (
    action === "statuspoison" ||
    action === "statusdehydrated" ||
    action === "statushungry" ||
    action === "statusbleeding" ||
    action === "statusdart" ||
    action === "statusgodmode" ||
    action === "statusbullethell" ||
    action === "statusflippers" ||
    action === "statusflash" ||
    action === "statushealthx3"
  ) {
    return "RustChaos - Status effects";
  }
  if (action === "npcmaxx") {
    return "NPCMaxx";
  }
  if (action === "maxxinvaders") {
    return "MaxxInvaders";
  }
  if (action === "follow" || action === "share" || action === "subscribe" || action === "sociallike") {
    return "TikTok Social (no RCON)";
  }
  return "RustChaos - Gameplay actions";
}

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
  const [allRulesCopied, setAllRulesCopied] = useState(false);
  const [maxxAllServersCopied, setMaxxAllServersCopied] = useState(false);
  const [maxxCopiedHookId, setMaxxCopiedHookId] = useState<string | null>(null);
  const [maxxCopiedRowKey, setMaxxCopiedRowKey] = useState<string | null>(null);
  /** Shown after rotating webhook secret — rule URLs on this page already use the new token. */
  const [rotateHint, setRotateHint] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [ruleAction, setRuleAction] = useState("");
  const [npcTemplate, setNpcTemplate] = useState("");
  const [ruleDurationSeconds, setRuleDurationSeconds] = useState("10");
  /** Solo RustChaos spawns (wolf, bear, scientist, …): times to fire `rustchaos` per webhook (1–15). */
  const [ruleSpawnCount, setRuleSpawnCount] = useState("1");
  const [quickPresetSpawnCount, setQuickPresetSpawnCount] = useState("1");
  const [quickAdding, setQuickAdding] = useState<string | null>(null);

  const groupedActions = useMemo(() => {
    const groups = new Map<string, ActionOpt[]>();
    for (const action of actions) {
      const key = getActionCategory(action.action);
      const current = groups.get(key) ?? [];
      current.push(action);
      groups.set(key, current);
    }
    return Array.from(groups.entries());
  }, [actions]);

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
        id: typeof u?.id === "string" ? u.id : "",
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
    const cached = loadSecretMap();
    const flat: Record<string, string> = {};
    for (const [publicId, entry] of Object.entries(cached)) {
      if (entry?.secret) flat[publicId] = entry.secret;
    }
    setSecretByPublicId((prev) => ({ ...flat, ...prev }));
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
    if (data.webhookUrl) {
      await load();
      setRotateHint("Link updated — copy it from the green box and paste into each TikFinity trigger.");
      window.setTimeout(() => setRotateHint(null), 18_000);
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

  async function copyAllMaxxUrlsForHook(hookId: string) {
    setErr("");
    setRotateHint(null);
    const h = state?.hooks.find((x) => x.id === hookId);
    if (!h?.webhookUrl) return;
    const token = legacyTokenForHook(h, secretByPublicId);
    if (!canBuildStreamerHookUrl(h.webhookUrl, token)) {
      setErr("Finish this server’s webhook under Game servers first.");
      return;
    }
    const lines: string[] = [];
    lines.push(`${h.serverName ?? "Server"} — Viewer bots (MaxxInvaders)`);
    lines.push("");
    for (const group of MAXX_GROUP_ORDER) {
      lines.push(`— ${MAXX_GROUP_TITLE[group]} —`);
      lines.push("");
      for (const preset of STREAMER_MAXXINVADERS_URL_PRESETS.filter((p) => p.group === group)) {
        const params = mergePresetParamsWithProfileAnchor(preset.params, state?.user.steamId);
        const url = buildStreamerHookQueryUrl(
          h.webhookUrl,
          webhookBaseUsesOpaqueSecret(h.webhookUrl) ? null : token,
          params
        );
        lines.push(preset.label);
        if (preset.hint) lines.push(`(${preset.hint})`);
        lines.push(url);
        lines.push("");
      }
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n").trimEnd());
      setMaxxCopiedHookId(hookId);
      window.setTimeout(() => setMaxxCopiedHookId(null), 2500);
    } catch {
      setErr("Could not copy to clipboard");
    }
  }

  async function copyAllMaxxUrlsAllHooks() {
    setErr("");
    setRotateHint(null);
    const hooksList = state?.hooks ?? [];
    const blocks: string[] = [];
    for (const h of hooksList) {
      const token = legacyTokenForHook(h, secretByPublicId);
      if (!canBuildStreamerHookUrl(h.webhookUrl, token)) continue;
      const lines: string[] = [];
      lines.push(`=== ${h.serverName ?? h.serverId} — Viewer bots (MaxxInvaders) ===`);
      lines.push("");
      for (const group of MAXX_GROUP_ORDER) {
        lines.push(`— ${MAXX_GROUP_TITLE[group]} —`);
        lines.push("");
        for (const preset of STREAMER_MAXXINVADERS_URL_PRESETS.filter((p) => p.group === group)) {
          const params = mergePresetParamsWithProfileAnchor(preset.params, state?.user.steamId);
          const url = buildStreamerHookQueryUrl(
            h.webhookUrl!,
            webhookBaseUsesOpaqueSecret(h.webhookUrl!) ? null : token,
            params
          );
          lines.push(preset.label);
          lines.push(url);
          lines.push("");
        }
      }
      blocks.push(lines.join("\n").trimEnd());
    }
    if (blocks.length === 0) {
      setErr("Add or refresh webhooks under Game servers first.");
      return;
    }
    try {
      await navigator.clipboard.writeText(blocks.join("\n\n"));
      setMaxxAllServersCopied(true);
      window.setTimeout(() => setMaxxAllServersCopied(false), 2500);
    } catch {
      setErr("Could not copy to clipboard");
    }
  }

  async function copyMaxxPresetUrl(fullUrl: string, rowKey: string) {
    setErr("");
    try {
      await navigator.clipboard.writeText(fullUrl);
      setMaxxCopiedRowKey(rowKey);
      window.setTimeout(() => setMaxxCopiedRowKey(null), 2000);
    } catch {
      setErr("Could not copy to clipboard");
    }
  }

  async function copyAllRuleWebhookUrls() {
    setErr("");
    setRotateHint(null);
    const lines: string[] = [];
    for (const r of state?.rules ?? []) {
      const wh = state?.hooks.find((x) => x.id === r.hookId);
      const sec = wh ? legacyTokenForHook(wh, secretByPublicId) : null;
      const u = fullRuleWebhookUrl(
        wh?.webhookUrl ?? null,
        sec ?? null,
        r.server_action,
        r.spawn_count
      );
      if (u) {
        lines.push(`${r.name} (${r.server_action})`, u, "");
      }
    }
    if (lines.length === 0) {
      setErr("Add rules and ensure each server’s webhook URL is available under Game servers first.");
      return;
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n").trimEnd());
      setAllRulesCopied(true);
      window.setTimeout(() => setAllRulesCopied(false), 2500);
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
    if (
      (ruleAction === "npcmaxx" || ruleAction === "maxxinvaders") &&
      npcTemplate.trim()
    ) {
      body.npcTemplateKey = npcTemplate.trim();
    }
    if (isRustChaosStatusEffectAction(ruleAction)) {
      const n = parseInt(ruleDurationSeconds.trim(), 10);
      body.durationSeconds = Number.isFinite(n) ? Math.min(120, Math.max(1, n)) : 10;
    }
    if (isRustChaosSoloScrapSpawnAction(ruleAction)) {
      const n = parseInt(ruleSpawnCount.trim(), 10);
      body.spawnCount = Number.isFinite(n)
        ? Math.min(SOLO_SPAWN_REPEAT_MAX, Math.max(1, n))
        : 1;
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
    setRuleSpawnCount("1");
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
          spawnCount: (() => {
            const n = parseInt(quickPresetSpawnCount.trim(), 10);
            return Number.isFinite(n)
              ? Math.min(SOLO_SPAWN_REPEAT_MAX, Math.max(1, n))
              : 1;
          })(),
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
  /** TikFinity often sends an empty POST body; force the final in-game action key in the URL. */
  const exampleRuleForUrl =
    rules.find((r) => r.server_action.toLowerCase().trim() === "wolf")?.server_action ??
    rules[0]?.server_action ??
    "wolf";
  const firstToken = firstHook ? legacyTokenForHook(firstHook, secretByPublicId) : null;
  const fullTikfinityUrlWithRuleAction =
    firstHook?.webhookUrl && canBuildStreamerHookUrl(firstHook.webhookUrl, firstToken)
      ? buildStreamerHookQueryUrl(
          firstHook.webhookUrl,
          webhookBaseUsesOpaqueSecret(firstHook.webhookUrl) ? null : firstToken,
          { action: exampleRuleForUrl }
        )
      : null;
  const pathActionChaosExample =
    firstHook?.webhookUrl && canBuildStreamerHookUrl(firstHook.webhookUrl, firstToken)
      ? buildStreamerHookPathActionUrl(firstHook.webhookUrl, "chaosraid_easy")
      : null;

  const serverIdsWithHooks = new Set(hooks.map((h) => h.serverId));
  const serversAvailableToAdd = servers.filter((s) => !serverIdsWithHooks.has(s.id));
  const serverForAdd = servers.find((s) => s.id === serverId);
  const canSubmitWebhookAdd = Boolean(serverId);
  const maxxReadyHooks = hooks.filter((h) => {
    const token = legacyTokenForHook(h, secretByPublicId);
    return canBuildStreamerHookUrl(h.webhookUrl, token);
  });

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
          Link Steam, add servers, copy each webhook URL into TikFinity (rules and presets below).
        </p>
      </div>

      <section className="mb-6 rounded-xl border border-emerald-900/40 bg-emerald-950/25 p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-300/90">
          Approval · server · webhook
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-300">
          <li>
            <strong className="text-zinc-100">RustMaxx staff approves</strong> your{" "}
            <Link href="/streamer/register" className="text-rust-cyan hover:underline">
              streamer application
            </Link>
            . Until approval, TikFinity hits to your webhook URL return{" "}
            <code className="rounded bg-zinc-800 px-1 text-xs">403</code>.
          </li>
          <li>
            Each <strong className="text-zinc-100">server owner</strong> turns on Streamer interactions under{" "}
            <strong>RustMaxx → Servers → [their server]</strong>, chooses allowed actions for streamers, and optionally
            requires approval or allowlists you there.
          </li>
          <li>
            You add a webhook per server here, then paste the URL into TikFinity and map gifts/events to{" "}
            <code className="rounded bg-zinc-800 px-1 text-xs">?action=…</code> keys the owner enabled (e.g.{" "}
            <code className="rounded bg-zinc-800 px-1 text-xs">chaosraid_easy</code>).
          </li>
          <li>
            <strong className="text-zinc-100">Chaos raids &amp; long actions:</strong> TikFinity often POSTs without your{" "}
            <code className="rounded bg-zinc-800 px-1 text-xs">?query</code>. Put the action{" "}
            <strong className="text-zinc-100">in the path</strong> instead — same hook key, then{" "}
            <code className="rounded bg-zinc-800 px-1 text-xs">/chaosraid_easy</code> (or medium/hard).{" "}
            {pathActionChaosExample ? (
              <>
                Example:{" "}
                <code className="break-all rounded bg-zinc-900 px-1 py-0.5 text-[11px] text-emerald-500/95">
                  {pathActionChaosExample}
                </code>
              </>
            ) : null}
          </li>
        </ol>
      </section>

      {err ? (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {err}
        </div>
      ) : null}

      <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Account</h2>
        <p className="text-sm text-zinc-300">{user.email}</p>
        <p className="mt-1 text-xs text-zinc-500">
          Plan <span className="text-zinc-300 capitalize">{user.streamerTier}</span>
          {" · "}
          Webhooks {user.streamerWebhookCount}/{user.streamerWebhookLimit}
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          <Link href="/streamer/superfan" className="text-rust-cyan hover:underline">
            Fan club
          </Link>
          {state.user.id ? (
            <>
              {" · "}
              <Link
                href={`/viewer/interact/${state.user.id}?preview=1`}
                className="text-rust-cyan hover:underline"
              >
                Preview boards
              </Link>
            </>
          ) : null}
        </p>
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
          <Link href="/streamer/superfan" className="text-sm text-rust-cyan hover:underline">
            Fan club
          </Link>
          {state.user.id ? (
            <Link
              href={`/viewer/interact/${state.user.id}?preview=1`}
              className="text-sm text-rust-cyan hover:underline"
            >
              Preview boards
            </Link>
          ) : null}
          <Link href="/streamer/tiktok-live" className="text-sm text-rust-cyan hover:underline">
            TikTok Live (Direct)
          </Link>
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Steam</h2>
        <p className="mb-3 text-sm text-zinc-400">
          Use the same Steam account as in-game for spawn anchors. You can also edit this on{" "}
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
          One webhook URL per server. Your servers and team servers show here; others appear after the owner enables{" "}
          <strong className="text-zinc-400">Streamer interactions</strong> or approves you. Request access via the{" "}
          <Link href="/server-list" className="text-rust-cyan hover:underline">
            server list
          </Link>{" "}
          if needed.
        </p>
        <p className="mb-4 rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-400">
          <strong className="text-zinc-200">Paste the full URL</strong> from the green box into TikFinity.{" "}
          <strong className="text-zinc-200">Regenerate URL</strong> if you need a new link — then update TikFinity to match.
        </p>
        {serversLoadError ? (
          <p className="mb-4 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">
            {serversLoadError}
          </p>
        ) : null}
        {!serversLoadError && servers.length === 0 ? (
          <p className="mb-4 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-sm text-amber-100/95">
            No servers yet. Owners: enable <strong className="text-zinc-100">Streamer interactions</strong> under{" "}
            <Link href="/servers" className="text-rust-cyan hover:underline">
              Servers
            </Link>{" "}
            and refresh. Guests: wait for approval after requesting on the server list.
          </p>
        ) : null}

        {hooks.length > 0 ? (
          <ul className="mb-6 space-y-4">
            {hooks.map((h) => {
              const fullUrl = hookPasteableUrl(h, secretByPublicId);
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
                      <p className="text-[11px] text-zinc-500">One URL per server.</p>
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
                          Regenerate URL
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="mb-2 text-[11px] text-zinc-500">
                        Webhook link isn’t ready in this browser — tap Regenerate URL.
                      </p>
                      <button
                        type="button"
                        onClick={() => void rotateSecretForHook(h.id)}
                        className="rounded-lg border border-emerald-800/80 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-900/40"
                      >
                        Regenerate URL
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

        {hooks.length > 0 && fullTikfinityUrlWithRuleAction ? (
          <div className="mb-6 rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-100/95">
            <p className="mb-2 font-medium text-amber-50">
              TikFinity not firing the action? Try a URL that sets <code className="rounded bg-zinc-900 px-1 text-amber-200">&amp;action=…</code>{" "}
              (example — first server):
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

      <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Viewer bots <span className="text-zinc-600">·</span>{" "}
          <span className="normal-case text-zinc-400">MaxxInvaders webhook lines</span>
        </h2>
        <p className="mb-3 text-xs text-zinc-500">
          Same base URL as <strong className="text-zinc-400">Game servers</strong> — each row is a ready-made line for TikFinity. Re-copy after{" "}
          <strong className="text-zinc-300">Regenerate URL</strong>.
        </p>
        {user.steamId && /^\d{17}$/.test(user.steamId.trim()) ? (
          <p className="mb-3 rounded-lg border border-emerald-900/40 bg-emerald-950/25 px-3 py-2 text-xs text-emerald-100/95">
            Preset URLs include your Steam ID for spawn anchoring when the server allows it — paste as copied.
          </p>
        ) : (
          <p className="mb-3 rounded-lg border border-amber-900/50 bg-amber-950/25 px-3 py-2 text-xs text-amber-100/95">
            Add your Steam ID above so preset links can anchor spawns correctly.
          </p>
        )}
        <p className="mb-3 text-[11px] text-zinc-500">
          In-game spawn errors are usually from the Rust server (terrain / position), not a broken RustMaxx link.
        </p>
        {hooks.length === 0 ? (
          <p className="text-sm text-zinc-500">Add a webhook under Game servers first.</p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={maxxReadyHooks.length === 0}
                title={
                  maxxReadyHooks.length === 0 ? "Finish webhooks under Game servers first" : undefined
                }
                onClick={() => void copyAllMaxxUrlsAllHooks()}
                className="rounded-lg border border-violet-800/80 bg-violet-950/40 px-3 py-2 text-xs font-medium text-violet-100 hover:bg-violet-900/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {maxxAllServersCopied
                  ? "Copied all servers"
                  : "Copy all viewer-bot lines (every server)"}
              </button>
              <span className="text-[11px] text-zinc-600">All rows below, every server.</span>
            </div>
            <ul className="space-y-5">
              {hooks.map((h) => {
                const token = legacyTokenForHook(h, secretByPublicId);
                const ready = canBuildStreamerHookUrl(h.webhookUrl, token);
                return (
                  <li
                    key={h.id}
                    className="rounded-lg border border-violet-900/35 bg-zinc-950/50 p-4"
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-zinc-200">{h.serverName ?? "Server"}</p>
                      <button
                        type="button"
                        disabled={!ready}
                        onClick={() => void copyAllMaxxUrlsForHook(h.id)}
                        className="shrink-0 rounded-lg border border-violet-700/70 bg-violet-950/50 px-3 py-1.5 text-xs font-medium text-violet-100 hover:bg-violet-900/40 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {maxxCopiedHookId === h.id ? "Copied" : "Copy all lines (this server)"}
                      </button>
                    </div>
                    {!ready ? (
                      <p className="text-xs text-amber-200/90">
                        Copy or <strong className="text-amber-100">Regenerate URL</strong> under Game servers first.
                      </p>
                    ) : (
                      <div className="max-h-[min(28rem,50vh)] overflow-auto rounded border border-zinc-800/80">
                        <table className="w-full min-w-[280px] text-left text-[11px]">
                          <thead className="sticky top-0 z-10 bg-zinc-900/95 text-zinc-500">
                            <tr>
                              <th className="px-2 py-1.5 font-medium">Use for</th>
                              <th className="px-2 py-1.5 font-medium">Webhook line</th>
                              <th className="w-14 px-2 py-1.5 font-medium"> </th>
                            </tr>
                          </thead>
                          <tbody className="text-zinc-300">
                            {MAXX_GROUP_ORDER.map((group) => (
                              <Fragment key={`${h.id}:${group}`}>
                                <tr className="border-t border-zinc-800/90 bg-zinc-900/70">
                                  <td
                                    colSpan={3}
                                    className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500"
                                  >
                                    {MAXX_GROUP_TITLE[group]}
                                  </td>
                                </tr>
                                {STREAMER_MAXXINVADERS_URL_PRESETS.filter((p) => p.group === group).map((preset) => {
                                  const base = h.webhookUrl as string;
                                  const fullUrl = buildStreamerHookQueryUrl(
                                    base,
                                    webhookBaseUsesOpaqueSecret(base) ? null : token,
                                    mergePresetParamsWithProfileAnchor(preset.params, user.steamId)
                                  );
                                  const rowKey = `${h.id}:${preset.id}`;
                                  return (
                                    <tr key={preset.id} className="border-t border-zinc-800/90 align-top">
                                      <td className="px-2 py-2 text-zinc-200">
                                        <span className="font-medium">{preset.label}</span>
                                        {preset.hint ? (
                                          <span className="mt-0.5 block text-[10px] font-normal text-zinc-500">
                                            {preset.hint}
                                          </span>
                                        ) : null}
                                      </td>
                                      <td className="px-2 py-2">
                                        <code className="break-all text-emerald-600/90">{fullUrl}</code>
                                      </td>
                                      <td className="px-2 py-2">
                                        <button
                                          type="button"
                                          onClick={() => void copyMaxxPresetUrl(fullUrl, rowKey)}
                                          className="whitespace-nowrap rounded border border-zinc-600 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800"
                                        >
                                          {maxxCopiedRowKey === rowKey ? "Copied" : "Copy"}
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
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
          Pick a server, then map a <strong className="text-zinc-400">TikFinity event name</strong> to a{" "}
          <strong className="text-zinc-400">server action</strong>. Use <strong className="text-zinc-300">Copy webhook</strong> on each
          rule for the full URL. After <strong className="text-zinc-300">Regenerate URL</strong>, copy rules again.
        </p>
        {rotateHint ? (
          <p className="mb-4 rounded-lg border border-emerald-900/50 bg-emerald-950/30 p-3 text-xs text-emerald-100/95">
            {rotateHint}
          </p>
        ) : null}
        {rules.length > 0 ? (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void copyAllRuleWebhookUrls()}
              className="rounded-lg border border-emerald-800/80 bg-emerald-950/40 px-3 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-900/40"
            >
              {allRulesCopied ? "Copied all" : "Copy all rule webhooks"}
            </button>
            <span className="text-[11px] text-zinc-600">Re-copy after regenerating your webhook URL.</span>
          </div>
        ) : null}

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
            Adds a rule whose event name matches the preset (e.g. bear, wolf). Or use{" "}
            <code className="rounded bg-zinc-800 px-1">&amp;action=…</code> on your webhook URL.
          </p>
          <div className="mb-3 flex max-w-xs flex-col gap-1">
            <label className="text-xs text-zinc-500">
              How many animals / scientists per trigger (1–{SOLO_SPAWN_REPEAT_MAX})
            </label>
            <input
              type="number"
              min={1}
              max={SOLO_SPAWN_REPEAT_MAX}
              value={quickPresetSpawnCount}
              onChange={(e) => setQuickPresetSpawnCount(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
            />
          </div>
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
            <label className="mb-1 block text-xs text-zinc-500">TikFinity event name (alias)</label>
            <input
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="e.g. rose or !bunny1"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Server action (in-game)</label>
            <select
              value={ruleAction}
              onChange={(e) => setRuleAction(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
            >
              {groupedActions.map(([group, rows]) => (
                <optgroup key={group} label={group}>
                  {rows.map((a) => (
                    <option key={a.action} value={a.action}>
                      {a.label} ({a.action})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          {ruleAction === "npcmaxx" || ruleAction === "maxxinvaders" ? (
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-zinc-500">
                Roaming template key
                {ruleAction === "npcmaxx" ? " (required)" : " (optional — default streamer_patrol)"}
              </label>
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
          {isRustChaosSoloScrapSpawnAction(ruleAction) ? (
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Spawn count (per webhook)</label>
              <input
                type="number"
                min={1}
                max={SOLO_SPAWN_REPEAT_MAX}
                value={ruleSpawnCount}
                onChange={(e) => setRuleSpawnCount(e.target.value)}
                className="w-full max-w-[10rem] rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-[11px] text-zinc-600">
                Optional <code className="rounded bg-zinc-900 px-0.5">&amp;count=</code> on the URL overrides this.
              </p>
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
            const sec = wh ? legacyTokenForHook(wh, secretByPublicId) : null;
            const ruleUrl = fullRuleWebhookUrl(
              wh?.webhookUrl ?? null,
              sec ?? null,
              r.server_action,
              r.spawn_count
            );
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
                  {isRustChaosSoloScrapSpawnAction(r.server_action) && (r.spawn_count ?? 1) > 1 ? (
                    <span className="text-zinc-500"> · ×{r.spawn_count}</span>
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
                    <span
                      className="text-[11px] text-zinc-600"
                      title="Set up the webhook under Game servers above"
                    >
                      Webhook URL unavailable
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
