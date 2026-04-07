"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  RUSTMAXX_ORIGIN,
  normalizeTikfinityWebhookUrlForDisplay,
  rustmaxxTikfinityWebhookUrl,
} from "@/lib/rustmaxx-public-url";
import { MAXX_INVADERS_OUTFIT_PROFILE_DOCS } from "@/lib/maxxinvaders-outfit-profiles";

/** Keys under RoamingNPCs.json → Bots settings — must match server config. */
const ROAMING_TEMPLATE_KEYS = [
  "bob_resources_farmer",
  "john_looter",
  "alfred_hunter",
  "austin_fighter",
] as const;

type ActionMeta = {
  action: string;
  label: string;
  description: string;
  exampleGifts: string[];
};

type ConnectionRow = {
  id: string;
  name: string;
  server_action: string;
  message?: string | null;
  scrap_amount?: number;
  npc_template_key?: string | null;
  created_at: string;
};

type RnpcSpawnEventRow = {
  id: string;
  viewer_name: string;
  template_key: string;
  command: string;
  status: string;
  error_message?: string | null;
  tikfinity_event_name?: string | null;
  created_at: string;
};

type CrewRnpcRegistrationRow = {
  id: string;
  tiktok_unique_id: string;
  display_name: string;
  created_at: string;
};

type ActionMapsResponse = {
  webhookUrl: string | null;
  availableActions: ActionMeta[];
  giftToActionMap: Record<string, string>;
  connections?: ConnectionRow[];
  tikfinityFeatures?: {
    crewSpawnOnRegisterConfigured: boolean;
    npcmaxxRequireCrewRegistry: boolean;
  };
};

type TestResult = {
  ok: boolean;
  error?: string;
  debug?: string;
  skipped?: boolean;
  reason?: string;
  action?: string;
  viewerName?: string;
  giftName?: string;
  command?: string;
  availableActions?: string[];
};

export default function AdminStreamerInteractionsPage() {
  const [data, setData] = useState<ActionMapsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testGift, setTestGift] = useState("Puppy");
  const [testViewer, setTestViewer] = useState("TestViewer");
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [newConnectionName, setNewConnectionName] = useState("");
  const [newConnectionMessage, setNewConnectionMessage] = useState("");
  const [newConnectionScrap, setNewConnectionScrap] = useState<number>(0);
  const [newConnectionAction, setNewConnectionAction] = useState("likes");
  const [newConnectionNpcTemplate, setNewConnectionNpcTemplate] = useState("");
  const [rnpcSpawnEvents, setRnpcSpawnEvents] = useState<RnpcSpawnEventRow[]>([]);
  const [crewRegistrations, setCrewRegistrations] = useState<CrewRnpcRegistrationRow[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingCrewId, setDeletingCrewId] = useState<string | null>(null);
  const [tikfinitySpawnTemplate, setTikfinitySpawnTemplate] = useState<string>(
    ROAMING_TEMPLATE_KEYS[0]
  );
  const [diagnosticsText, setDiagnosticsText] = useState<string | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);

  const ALLOWED_ROLES = ["admin", "super_admin"];

  function refetchData() {
    fetch("/api/tikfinity/action-maps", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setData(d);
          setConnections(d.connections ?? []);
        }
      })
      .catch(() => {});
    fetch("/api/tikfinity/rnpc-spawns?limit=100", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { events?: RnpcSpawnEventRow[] } | null) => {
        if (d?.events) setRnpcSpawnEvents(d.events);
      })
      .catch(() => {});
    fetch("/api/tikfinity/crew-rnpc?limit=500", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { registrations?: CrewRnpcRegistrationRow[] } | null) => {
        if (d?.registrations) setCrewRegistrations(d.registrations);
      })
      .catch(() => {});
  }

  useEffect(() => {
    // Use same role source as the header badge (/api/auth/me) so access matches what the user sees
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((me: { role?: string } | null) => {
        if (!me?.role || !ALLOWED_ROLES.includes(me.role)) {
          setAccessDenied(true);
          setLoading(false);
          return;
        }
        setAccessDenied(false);
        return fetch("/api/tikfinity/action-maps", { credentials: "same-origin" });
      })
      .then((r) => {
        if (!r || !(r instanceof Response)) return null;
        if (r.status === 403) {
          // Backend still returned forbidden; show page but data will be empty (suggest re-login in UI)
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (d) {
          setData(d);
          setConnections(d.connections ?? []);
        }
      })
      .catch(() => setAccessDenied(true))
      .finally(() => setLoading(false));
    fetch("/api/tikfinity/rnpc-spawns?limit=100", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { events?: RnpcSpawnEventRow[] } | null) => {
        if (d?.events) setRnpcSpawnEvents(d.events);
      })
      .catch(() => {});
    fetch("/api/tikfinity/crew-rnpc?limit=500", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { registrations?: CrewRnpcRegistrationRow[] } | null) => {
        if (d?.registrations) setCrewRegistrations(d.registrations);
      })
      .catch(() => {});
  }, []);

  function copyWebhook() {
    if (!data) return;
    navigator.clipboard.writeText(
      normalizeTikfinityWebhookUrlForDisplay(
        data.webhookUrl ?? rustmaxxTikfinityWebhookUrl()
      )
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function runTest() {
    setTestResult(null);
    setTestLoading(true);
    fetch("/api/tikfinity/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ giftName: testGift, viewerName: testViewer || "TestViewer" }),
    })
      .then((r) => r.json())
      .then((res) => setTestResult(res as TestResult))
      .catch((err) => setTestResult({ ok: false, error: String(err.message || err), debug: "Request failed." }))
      .finally(() => setTestLoading(false));
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="text-zinc-500">Loading…</p>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h1 className="text-xl font-semibold text-zinc-100">Streamer interactions (TikFinity)</h1>
          <p className="mt-2 text-zinc-400">
            Only admins and super admins can view this page.
          </p>
          <Link href="/admin" className="mt-4 inline-block text-rust-cyan hover:underline">
            ← Back to admin
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h1 className="text-xl font-semibold text-zinc-100">Streamer interactions (TikFinity)</h1>
          <p className="mt-2 text-zinc-400">
            Settings could not be loaded. Try logging out and back in. If you recently deployed, run database migrations (<code className="rounded bg-zinc-800 px-1">npm run migrate</code>) on your server.
          </p>
          <Link href="/admin" className="mt-4 inline-block text-rust-cyan hover:underline">
            ← Back to admin
          </Link>
        </div>
      </div>
    );
  }

  const giftEntries = Object.entries(data.giftToActionMap).sort(
    ([a], [b]) => a.localeCompare(b)
  );

  // Actions to show in webhook URL area and connections (exclude test, rose, smoke, fireworks, likes)
  const WEBHOOK_HIDDEN_ACTIONS = ["test", "rose", "smoke", "fireworks", "likes"];
  const webhookActions = data.availableActions.filter(
    (a) => !WEBHOOK_HIDDEN_ACTIONS.includes(a.action)
  );
  /** Chips: hide npcmaxx — use the dedicated spawn URL block (needs template). */
  const webhookActionChips = webhookActions.filter((a) => a.action !== "npcmaxx");

  /** Live webhook base URL (always www on rustmaxx.com apex for TikFinity). */
  const webhookUrl = normalizeTikfinityWebhookUrlForDisplay(
    data.webhookUrl ?? rustmaxxTikfinityWebhookUrl()
  );
  const spawnNpcWebhookUrl = `${webhookUrl}?action=npcmaxx&template=${encodeURIComponent(
    tikfinitySpawnTemplate
  )}`;

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/admin" className="text-rust-cyan hover:underline">
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-100">
          Streamer interactions (TikFinity)
        </h1>
      </div>

      <p className="text-zinc-400">
        Public site: <strong className="text-zinc-300">{RUSTMAXX_ORIGIN}</strong> — set{" "}
        <code className="rounded bg-zinc-800 px-1 text-zinc-300">APP_URL</code> to this exact origin in
        production (apex vs <code className="rounded bg-zinc-800 px-1">www</code> must match what TikFinity
        calls). In TikFinity, use <strong>Trigger WebHook</strong> and paste the URLs below. Gifts map to
        RustChaos; roaming bots use the spawn URL or a connection (event name → Roaming NPC).
      </p>

      {/* Webhook URL */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="text-lg font-medium text-zinc-200">Webhook URL (for TikFinity)</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Base URL — use the <strong className="text-zinc-400">spawn roaming NPC</strong> block for bots, or
          TikFinity connections when the event name is sent in the body.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="flex-1 break-all rounded bg-zinc-800 px-3 py-2 text-sm text-zinc-300">
            {webhookUrl}
          </code>
          <button
            type="button"
            onClick={copyWebhook}
            className="rounded bg-rust-cyan/20 px-3 py-2 text-sm font-medium text-rust-cyan hover:bg-rust-cyan/30"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-rust-cyan/35 bg-rust-cyan/5 p-4">
          <h3 className="text-base font-semibold text-zinc-100">
            Spawn roaming NPC — TikFinity trigger → bot on server
          </h3>
          <p className="mt-2 text-sm text-zinc-400">
            Paste this <strong className="text-zinc-300">full URL</strong> into TikFinity → New Action →
            Trigger WebHook. When the action runs, RustMaxx sends{" "}
            <code className="rounded bg-zinc-800 px-1">npcmaxx.spawn</code> to your Rust server (from{" "}
            <code className="rounded bg-zinc-800 px-1">TIKFINITY_SERVER_ID</code>) and the roaming NPC is
            created with the viewer name from the TikFinity payload.
          </p>
          {data.tikfinityFeatures?.npcmaxxRequireCrewRegistry && (
            <p className="mt-2 rounded border border-amber-800/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-100/95">
              <strong>Crew gate is on</strong> (<code className="rounded bg-zinc-900 px-1">NPCMAXX_REQUIRE_CREW_REGISTRY</code>
              ): this spawn only works if that viewer is already in the crew registry (use the join URL
              first), and the payload must include <code className="rounded bg-zinc-900 px-1">userId</code> /{" "}
              <code className="rounded bg-zinc-900 px-1">uniqueId</code>.
            </p>
          )}
          <div className="mt-4 max-w-xl">
            <label className="block text-xs text-zinc-500">Roaming template key (must match <code className="rounded bg-zinc-800 px-1">Bots settings</code> on your server)</label>
            <input
              type="text"
              list="roaming-template-keys"
              value={tikfinitySpawnTemplate}
              onChange={(e) => setTikfinitySpawnTemplate(e.target.value)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-200"
              placeholder="bob_resources_farmer"
            />
            <datalist id="roaming-template-keys">
              {ROAMING_TEMPLATE_KEYS.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="flex-1 break-all rounded bg-zinc-900 px-3 py-2 text-xs text-rust-cyan">
              {spawnNpcWebhookUrl}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(spawnNpcWebhookUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="shrink-0 rounded bg-rust-cyan/25 px-4 py-2 text-sm font-medium text-rust-cyan hover:bg-rust-cyan/35"
            >
              {copied ? "Copied" : "Copy spawn URL"}
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            If you use <strong className="text-zinc-400">TikFinity connections</strong> instead, add a row
            with server action <strong className="text-zinc-400">Roaming NPC (viewer bot)</strong> and the
            same template key — then TikFinity can call the <strong>base</strong> webhook URL and match the
            event name; no <code className="rounded bg-zinc-800 px-1">?action=</code> needed.
          </p>

          <div className="mt-6 rounded-lg border border-zinc-700 bg-zinc-950/50 p-4">
            <h3 className="text-base font-semibold text-zinc-100">
              MaxxInvaders — viewer name on bot (Streamer Patrol)
            </h3>
            <p className="mt-2 text-sm text-zinc-400">
              Runs <code className="rounded bg-zinc-800 px-1">maxxinvaders.spawn</code> with Roaming template{" "}
              <strong className="text-zinc-300">streamer_patrol</strong> by default. The in-game bot uses the{" "}
              <strong className="text-zinc-300">viewer&apos;s name</strong> from TikFinity: send{" "}
              <code className="rounded bg-zinc-800 px-1">viewerName</code> in the JSON body (mapped from the
              viewer field), or add <code className="rounded bg-zinc-800 px-1">?viewerName=...</code> to the URL.
              Optional:               <code className="rounded bg-zinc-800 px-1">?template=other_bot_key</code>,{" "}
              <code className="rounded bg-zinc-800 px-1">tier</code>, <code className="rounded bg-zinc-800 px-1">uniqueId</code> when crew gate is on.
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              <strong className="text-zinc-300">Easiest — patrol near you without URL params:</strong> open{" "}
              <strong className="text-zinc-300">Servers → your server → TikFinity patrol anchor</strong> and save your 17-digit Steam64 once.
              Webhooks for that server then anchor automatically (same as setting env{" "}
              <code className="rounded bg-zinc-800 px-1">TIKFINITY_MAXXINVADERS_ANCHOR_STEAM_ID</code>, but per-server in the dashboard).
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              <strong className="text-zinc-300">Outfit profiles</strong> (same spawn path; only clothes change):{" "}
              <code className="rounded bg-zinc-800 px-1">?outfit=</code> or JSON{" "}
              <code className="rounded bg-zinc-800 px-1">outfit</code> /{" "}
              <code className="rounded bg-zinc-800 px-1">outfitProfile</code>. Registered profiles:{" "}
              {MAXX_INVADERS_OUTFIT_PROFILE_DOCS.map((p) => p.id).join(", ")} — extend in{" "}
              <code className="rounded bg-zinc-800 px-1">lib/maxxinvaders-outfit-profiles.ts</code>. Raw pipe:{" "}
              <code className="rounded bg-zinc-800 px-1">?outfit=short.one|short.two</code>.{" "}
              <strong className="text-zinc-300">bunny1npc</strong> always uses profile{" "}
              <code className="rounded bg-zinc-800 px-1">bunny1</code>.{" "}
              <strong className="text-zinc-300">gingynpc</strong> / <strong className="text-zinc-300">eggnpc</strong> /{" "}
              <strong className="text-zinc-300">vampnpc</strong> use fixed Roaming templates{" "}
              <code className="rounded bg-zinc-800 px-1">gingy</code>, <code className="rounded bg-zinc-800 px-1">egg</code>,{" "}
              <code className="rounded bg-zinc-800 px-1">vamp</code> (wear + weapons from server JSON).
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              <strong className="text-zinc-300">Override:</strong>{" "}
              <code className="rounded bg-zinc-800 px-1">?anchorSteam=7656119…</code> or JSON{" "}
              <code className="rounded bg-zinc-800 px-1">anchorSteam</code>. You must be{" "}
              <strong className="text-zinc-300">online or sleeping</strong> on the Rust server. Tighten leash in{" "}
              <code className="rounded bg-zinc-800 px-1">MaxxInvaders.json</code> (
              <code className="rounded bg-zinc-800 px-1">MaxDistanceFromAnchor</code>).
            </p>
            {data.tikfinityFeatures?.npcmaxxRequireCrewRegistry && (
              <p className="mt-2 rounded border border-amber-800/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-100/95">
                <strong>Crew gate is on</strong> (<code className="rounded bg-zinc-900 px-1">NPCMAXX_REQUIRE_CREW_REGISTRY</code>
                ): MaxxInvaders webhooks only run if the payload includes TikTok <code className="rounded bg-zinc-900 px-1">userId</code> /{" "}
                <code className="rounded bg-zinc-900 px-1">uniqueId</code> and that viewer is already in the crew registry (join URL first). Otherwise the API returns{" "}
                <code className="rounded bg-zinc-900 px-1">skipped</code> — not an RCON failure.
              </p>
            )}
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <code className="flex-1 break-all rounded bg-zinc-900 px-3 py-2 text-xs text-zinc-300">
                  {`${webhookUrl}?action=maxxinvaders`}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`${webhookUrl}?action=maxxinvaders`);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="shrink-0 rounded bg-zinc-800 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-700"
                >
                  {copied ? "Copied" : "Copy URL"}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="flex-1 break-all rounded bg-zinc-900 px-3 py-2 text-xs text-zinc-300">
                  {`${webhookUrl}?action=maxxinvaders&outfit=bunny1`}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `${webhookUrl}?action=maxxinvaders&outfit=bunny1`
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="shrink-0 rounded bg-zinc-800 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-700"
                >
                  Copy bunny outfit
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="flex-1 break-all rounded bg-zinc-900 px-3 py-2 text-xs text-zinc-300">
                  {`${webhookUrl}?action=gingynpc&nickname=%nickname%`}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `${webhookUrl}?action=gingynpc&nickname=%nickname%`
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="shrink-0 rounded bg-zinc-800 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-700"
                >
                  Copy Gingy bot
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="flex-1 break-all rounded bg-zinc-900 px-3 py-2 text-xs text-zinc-300">
                  {`${webhookUrl}?action=eggnpc&nickname=%nickname%`}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `${webhookUrl}?action=eggnpc&nickname=%nickname%`
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="shrink-0 rounded bg-zinc-800 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-700"
                >
                  Copy Egg bot
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="flex-1 break-all rounded bg-zinc-900 px-3 py-2 text-xs text-zinc-300">
                  {`${webhookUrl}?action=vampnpc&nickname=%nickname%`}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `${webhookUrl}?action=vampnpc&nickname=%nickname%`
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="shrink-0 rounded bg-zinc-800 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-700"
                >
                  Copy Vamp bot
                </button>
              </div>
            </div>
          </div>

          <details className="mt-4 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2">
            <summary className="cursor-pointer text-sm text-zinc-300">Webhook debug (diagnostics)</summary>
            <p className="mt-2 text-xs text-zinc-500">
              If TikFinity fires but nothing happens, run diagnostics below and check your host logs (e.g. Railway).
              Full checklist: <code className="rounded bg-zinc-800 px-1">docs/TIKFINITY_WEBHOOK_DEBUG.md</code> in the
              repo.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={diagnosticsLoading}
                onClick={() => {
                  setDiagnosticsLoading(true);
                  fetch("/api/tikfinity/diagnostics", { credentials: "same-origin" })
                    .then((r) => r.json())
                    .then((j) => setDiagnosticsText(JSON.stringify(j, null, 2)))
                    .catch((e) => setDiagnosticsText(String(e)))
                    .finally(() => setDiagnosticsLoading(false));
                }}
                className="rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
              >
                {diagnosticsLoading ? "…" : "Run diagnostics"}
              </button>
              <button
                type="button"
                disabled={diagnosticsLoading}
                onClick={() => {
                  setDiagnosticsLoading(true);
                  fetch("/api/tikfinity/diagnostics?probeRcon=1", { credentials: "same-origin" })
                    .then((r) => r.json())
                    .then((j) => setDiagnosticsText(JSON.stringify(j, null, 2)))
                    .catch((e) => setDiagnosticsText(String(e)))
                    .finally(() => setDiagnosticsLoading(false));
                }}
                className="rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
              >
                {diagnosticsLoading ? "…" : "Diagnostics + RCON probe"}
              </button>
            </div>
            {diagnosticsText && (
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-zinc-950 p-2 text-left text-[11px] text-zinc-400">
                {diagnosticsText}
              </pre>
            )}
          </details>
        </div>
        {data.tikfinityFeatures && (
          <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
            <p className="font-medium text-zinc-300">RNPC automation (env)</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>
                <code className="rounded bg-zinc-800 px-1">CREW_RNPC_TEMPLATE_KEY</code>{" "}
                {data.tikfinityFeatures.crewSpawnOnRegisterConfigured ? (
                  <span className="text-green-400/90">set</span>
                ) : (
                  <span className="text-zinc-500">not set</span>
                )}
                {" — first crew join also runs "}
                <code className="rounded bg-zinc-800 px-1">npcmaxx.spawn</code> for that viewer.
              </li>
              <li>
                <code className="rounded bg-zinc-800 px-1">NPCMAXX_REQUIRE_CREW_REGISTRY</code>{" "}
                {data.tikfinityFeatures.npcmaxxRequireCrewRegistry ? (
                  <span className="text-amber-200/90">on</span>
                ) : (
                  <span className="text-zinc-500">off</span>
                )}
                {" — gift/connection "}
                <code className="rounded bg-zinc-800 px-1">npcmaxx</code> only if the viewer is in the crew registry.
              </li>
            </ul>
          </div>
        )}
            <h3 className="mt-4 text-sm font-medium text-zinc-300">Per-action URLs (RustChaos)</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Quick-copy <code className="rounded bg-zinc-800 px-1">?action=...</code> for scientists, wolves, etc. Roaming NPCs use the <strong className="text-zinc-400">spawn roaming NPC</strong> section above (not these chips).
            </p>
            <h3 className="mt-4 text-sm font-medium text-zinc-300">Crew (subscriber) — join the LIVE</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Create a separate TikFinity action for <strong className="text-zinc-400">viewer joined</strong> and point it at this URL with <code className="rounded bg-zinc-800 px-1">?event=join</code>. Only payloads that look like <strong className="text-zinc-400">crew / team / subscriber</strong> and include a stable TikTok viewer id are stored once per user; repeat joins return <code className="rounded bg-zinc-800 px-1">alreadyRegistered</code> without duplicating.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="flex-1 break-all rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
                {`${webhookUrl}?event=join`}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(`${webhookUrl}?event=join`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                Copy join URL
              </button>
            </div>
            <details className="mt-3 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-xs text-zinc-400">
              <summary className="cursor-pointer text-zinc-300">Test crew registration (PowerShell)</summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-zinc-500">
{`$body = '{"teamMember":true,"userId":"7335694216609711150","viewerName":"melbc123"}'
Invoke-RestMethod -Uri "${webhookUrl}?event=join" -Method POST -ContentType "application/json; charset=utf-8" -Body $body`}
              </pre>
              <p className="mt-1 text-zinc-500">
                First run registers; second run returns <code className="rounded bg-zinc-800 px-1">alreadyRegistered</code>.
              </p>
            </details>
            <ul className="mt-2 flex flex-wrap gap-2">
              {webhookActionChips.map((a) => (
                <li key={a.action}>
                  <button
                    type="button"
                    onClick={() => {
                      const url = `${webhookUrl}?action=${a.action}`;
                      navigator.clipboard.writeText(url);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
                    title={`Copy ${webhookUrl}?action=${a.action}`}
                  >
                    {a.label ?? a.action}
                  </button>
                </li>
              ))}
            </ul>
      </section>

      {/* TikFinity connections: event name → server action */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="text-lg font-medium text-zinc-200">TikFinity connections</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Map TikFinity event/action names to server actions. When TikFinity sends an event with the given name (e.g. &quot;Likes&quot;, &quot;Wolf Attack&quot;), the chosen server action runs. Names are case-insensitive.
        </p>

        <h3 className="mt-4 text-sm font-medium text-zinc-300">Available server actions (commands)</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Choose one of these when setting the action for a connection.
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-800/50">
                <th className="px-3 py-2 font-medium text-zinc-400">Command</th>
                <th className="px-3 py-2 font-medium text-zinc-400">Description</th>
              </tr>
            </thead>
            <tbody>
              {webhookActions.map((a) => (
                <tr key={a.action} className="border-b border-zinc-800/50">
                  <td className="px-3 py-2 font-mono text-rust-cyan">{a.label ?? a.action}</td>
                  <td className="px-3 py-2 text-zinc-400">{a.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="mt-4 text-sm font-medium text-zinc-300">Add connection</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Set the name (as in TikFinity), optional message and scrap, then choose the server action. For <strong className="text-zinc-400">Roaming NPC (viewer bot)</strong>, set the Roaming template key (same key as in <code className="rounded bg-zinc-800 px-1">RoamingNPCs</code> config on the game server).
        </p>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-zinc-500">Event / action name (as in TikFinity)</label>
              <input
                type="text"
                value={newConnectionName}
                onChange={(e) => { setNewConnectionName(e.target.value); setConnectionError(null); }}
                placeholder="e.g. Likes, Wolf Attack"
                className="mt-1 w-48 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-200 placeholder:text-zinc-500"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500">Message (chat when triggered)</label>
              <input
                type="text"
                value={newConnectionMessage}
                onChange={(e) => { setNewConnectionMessage(e.target.value); setConnectionError(null); }}
                placeholder="e.g. Thanks for the likes!"
                className="mt-1 w-56 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-200 placeholder:text-zinc-500"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500">Scrap to give (0–10000)</label>
              <input
                type="number"
                min={0}
                max={10000}
                value={newConnectionScrap}
                onChange={(e) => { setNewConnectionScrap(Number(e.target.value) || 0); setConnectionError(null); }}
                className="mt-1 w-24 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-200"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500">Server action</label>
              <select
                value={newConnectionAction}
                onChange={(e) => {
                  setNewConnectionAction(e.target.value);
                  setConnectionError(null);
                }}
                className="mt-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-200"
              >
                {webhookActions.map((a) => (
                  <option key={a.action} value={a.action}>{a.label ?? a.action}</option>
                ))}
              </select>
            </div>
            {newConnectionAction === "npcmaxx" && (
              <div>
                <label className="block text-xs text-zinc-500">Roaming template key</label>
                <input
                  type="text"
                  value={newConnectionNpcTemplate}
                  onChange={(e) => { setNewConnectionNpcTemplate(e.target.value); setConnectionError(null); }}
                  placeholder="e.g. bob_resources_farmer"
                  className="mt-1 w-56 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-500"
                />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              const name = newConnectionName.trim();
              if (!name) { setConnectionError("Enter a name"); return; }
              if (newConnectionAction === "npcmaxx" && !newConnectionNpcTemplate.trim()) {
                setConnectionError("Enter a Roaming template key for Roaming NPC");
                return;
              }
              setConnectionError(null);
              setConnectionLoading(true);
              const scrap = Math.min(10000, Math.max(0, Number(newConnectionScrap) || 0));
              fetch("/api/tikfinity/connections", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name,
                  serverAction: newConnectionAction,
                  message: newConnectionMessage.trim() || undefined,
                  scrapAmount: scrap || undefined,
                  npcTemplateKey:
                    newConnectionAction === "npcmaxx"
                      ? newConnectionNpcTemplate.trim()
                      : undefined,
                }),
              })
                .then((r) => r.json().then((j) => ({ status: r.status, ...j })))
                .then((res) => {
                  if (res.id) {
                    setNewConnectionName("");
                    setNewConnectionMessage("");
                    setNewConnectionScrap(0);
                    setNewConnectionNpcTemplate("");
                    refetchData();
                  } else {
                    const msg = res.error ?? "Failed to add";
                    setConnectionError(res.debug ? `${msg}: ${res.debug}` : msg);
                  }
                })
                .catch(() => setConnectionError("Request failed"))
                .finally(() => setConnectionLoading(false));
            }}
            disabled={connectionLoading}
            className="rounded bg-rust-cyan/20 px-4 py-2 text-sm font-medium text-rust-cyan hover:bg-rust-cyan/30 disabled:opacity-50"
          >
            {connectionLoading ? "Adding…" : "Add connection"}
          </button>
        </div>
        {connectionError && (
          <p className="mt-2 text-sm text-red-400">{connectionError}</p>
        )}

        <h3 className="mt-6 text-sm font-medium text-zinc-300">Your connections</h3>
        <p className="mt-1 text-xs text-zinc-500">
          TikFinity event names you’ve mapped to server actions. Remove or add more above.
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-800/50">
                <th className="px-4 py-3 font-medium text-zinc-400">Event name</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Message</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Scrap</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Roaming template</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Server action</th>
                <th className="px-4 py-3 font-medium text-zinc-400 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {connections.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                    No connections yet. Add one above (set the name, optional message and scrap, choose an action).
                  </td>
                </tr>
              ) : (
                connections.map((c) => (
                  <tr key={c.id} className="border-b border-zinc-800/50">
                    <td className="px-4 py-3 text-zinc-300">{c.name}</td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-zinc-400" title={c.message ?? undefined}>
                      {c.message ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{c.scrap_amount ?? 0}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                      {c.server_action === "npcmaxx" && c.npc_template_key
                        ? c.npc_template_key
                        : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-rust-cyan">{c.server_action}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          setDeletingId(c.id);
                          fetch(`/api/tikfinity/connections?id=${encodeURIComponent(c.id)}`, { method: "DELETE" })
                            .then(() => refetchData())
                            .finally(() => setDeletingId(null));
                        }}
                        disabled={deletingId === c.id}
                        className="text-red-400 hover:text-red-300 disabled:opacity-50"
                      >
                        {deletingId === c.id ? "…" : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Crew subscribers registered on join (for RNPC eligibility) */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="text-lg font-medium text-zinc-200">Crew subscribers (RNPC registry)</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Viewers who hit the <code className="rounded bg-zinc-800 px-1">?event=join</code> webhook as crew/subscriber, with a stable TikTok id in the payload. First visit adds a row; repeat visits do not duplicate. Remove someone here to clear them from the registry.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-800/50">
                <th className="px-3 py-2 font-medium text-zinc-400">Registered</th>
                <th className="px-3 py-2 font-medium text-zinc-400">Display name</th>
                <th className="px-3 py-2 font-medium text-zinc-400">TikTok unique id</th>
                <th className="px-3 py-2 w-20 font-medium text-zinc-400"></th>
              </tr>
            </thead>
            <tbody>
              {crewRegistrations.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                    No crew registrations yet. Wire TikFinity “join LIVE” to the join webhook URL and ensure payloads include subscriber/crew flags + unique id.
                  </td>
                </tr>
              ) : (
                crewRegistrations.map((row) => (
                  <tr key={row.id} className="border-b border-zinc-800/50">
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-500">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-zinc-300">{row.display_name}</td>
                    <td className="max-w-[200px] truncate font-mono px-3 py-2 text-xs text-zinc-400" title={row.tiktok_unique_id}>
                      {row.tiktok_unique_id}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDeletingCrewId(row.id);
                          fetch(`/api/tikfinity/crew-rnpc?id=${encodeURIComponent(row.id)}`, { method: "DELETE" })
                            .then(() => refetchData())
                            .finally(() => setDeletingCrewId(null));
                        }}
                        disabled={deletingCrewId === row.id}
                        className="text-red-400 hover:text-red-300 disabled:opacity-50"
                      >
                        {deletingCrewId === row.id ? "…" : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Roaming NPC spawn log */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="text-lg font-medium text-zinc-200">Roaming NPC spawns (webhook log)</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Recent <code className="rounded bg-zinc-800 px-1">npcmaxx.spawn</code> attempts for this TikFinity server (<code className="rounded bg-zinc-800 px-1">TIKFINITY_SERVER_ID</code>). Viewer name is taken from the TikFinity payload when available.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-800/50">
                <th className="px-3 py-2 font-medium text-zinc-400">Time</th>
                <th className="px-3 py-2 font-medium text-zinc-400">Viewer</th>
                <th className="px-3 py-2 font-medium text-zinc-400">Template</th>
                <th className="px-3 py-2 font-medium text-zinc-400">TikFinity event</th>
                <th className="px-3 py-2 font-medium text-zinc-400">Status</th>
                <th className="px-3 py-2 font-medium text-zinc-400">Command</th>
              </tr>
            </thead>
            <tbody>
              {rnpcSpawnEvents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                    No Roaming NPC spawns logged yet. Trigger a webhook with a Roaming NPC connection or a URL with npcmaxx.
                  </td>
                </tr>
              ) : (
                rnpcSpawnEvents.map((ev) => (
                  <tr key={ev.id} className="border-b border-zinc-800/50">
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-500">
                      {new Date(ev.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-zinc-300">{ev.viewer_name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-400">{ev.template_key}</td>
                    <td className="max-w-[140px] truncate px-3 py-2 text-zinc-500" title={ev.tikfinity_event_name ?? undefined}>
                      {ev.tikfinity_event_name ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {ev.status === "success" ? (
                        <span className="text-green-400">OK</span>
                      ) : (
                        <span className="text-red-400" title={ev.error_message ?? undefined}>Failed</span>
                      )}
                    </td>
                    <td className="max-w-[280px] truncate font-mono text-xs text-zinc-500" title={ev.command}>
                      {ev.command}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Test trigger */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="text-lg font-medium text-zinc-200">Test trigger (debug)</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Simulate a webhook without TikFinity. Runs the same RCON command as a real gift. Use this to verify the server receives the trigger. Real and test triggers are logged to the audit table (actions: <code className="rounded bg-zinc-800 px-1">webhook.trigger</code>, <code className="rounded bg-zinc-800 px-1">webhook.failed</code>, <code className="rounded bg-zinc-800 px-1">webhook.skipped</code>) for debugging.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-zinc-500">Gift name (e.g. Puppy → wolf)</label>
            <select
              value={testGift}
              onChange={(e) => setTestGift(e.target.value)}
              className="mt-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-200"
            >
              {giftEntries.map(([gift]) => (
                <option key={gift} value={gift}>{gift}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-500">Viewer name (optional)</label>
            <input
              type="text"
              value={testViewer}
              onChange={(e) => setTestViewer(e.target.value)}
              placeholder="TestViewer"
              className="mt-1 w-40 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-200"
            />
          </div>
          <button
            type="button"
            onClick={runTest}
            disabled={testLoading}
            className="rounded bg-rust-cyan/20 px-4 py-2 text-sm font-medium text-rust-cyan hover:bg-rust-cyan/30 disabled:opacity-50"
          >
            {testLoading ? "Sending…" : "Run test"}
          </button>
        </div>
        {testResult && (
          <div className={`mt-4 rounded border p-3 text-sm ${testResult.ok ? "border-green-800/50 bg-green-900/20 text-green-200" : "border-red-800/50 bg-red-900/20 text-red-200"}`}>
            {testResult.ok ? (
              <>
                <p className="font-medium">Trigger sent</p>
                <p className="mt-1 text-zinc-400">Action: {testResult.action} · Command: <code className="rounded bg-zinc-800 px-1">{testResult.command}</code></p>
                {testResult.debug && <p className="mt-1 text-xs text-zinc-500">{testResult.debug}</p>}
              </>
            ) : (
              <>
                <p className="font-medium">{testResult.error ?? testResult.reason ?? "Failed"}</p>
                {testResult.debug && <p className="mt-1 text-xs opacity-90">{testResult.debug}</p>}
                {testResult.command && <p className="mt-1 text-xs">Command attempted: <code className="rounded bg-zinc-800 px-1">{testResult.command}</code></p>}
              </>
            )}
          </div>
        )}
      </section>

      {/* Available actions */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h2 className="text-lg font-medium text-zinc-200">Available actions (RustChaos)</h2>
          <p className="mt-1 text-sm text-zinc-500">
            These are the actions you can map TikTok gifts to. Set up matching triggers in TikFinity.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-800/50">
                <th className="px-4 py-3 font-medium text-zinc-400">Action</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Description</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Example gift names to map</th>
              </tr>
            </thead>
            <tbody>
              {webhookActions.map((a) => (
                <tr key={a.action} className="border-b border-zinc-800/50">
                  <td className="px-4 py-3 font-mono text-rust-cyan">{a.label ?? a.action}</td>
                  <td className="px-4 py-3 text-zinc-300">{a.description}</td>
                  <td className="px-4 py-3 text-zinc-400">
                    {a.exampleGifts.join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
