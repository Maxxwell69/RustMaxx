"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
  created_at: string;
};

type ActionMapsResponse = {
  webhookUrl: string | null;
  availableActions: ActionMeta[];
  giftToActionMap: Record<string, string>;
  connections?: ConnectionRow[];
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
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
  }, []);

  function copyWebhook() {
    if (!data?.webhookUrl) return;
    navigator.clipboard.writeText(data.webhookUrl);
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
        Use this URL in TikFinity when creating an action: choose <strong>Trigger WebHook</strong> and
        set the webhook URL below. Gifts are mapped to RustMaxxTikTrigger actions as shown in the tables.
      </p>

      {/* Webhook URL */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="text-lg font-medium text-zinc-200">Webhook URL (for TikFinity)</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Paste this in TikFinity → New Action → Trigger WebHook → URL
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="flex-1 break-all rounded bg-zinc-800 px-3 py-2 text-sm text-zinc-300">
            {data.webhookUrl ?? "Set APP_URL to see webhook URL"}
          </code>
          {data.webhookUrl && (
            <button
              type="button"
              onClick={copyWebhook}
              className="rounded bg-rust-cyan/20 px-3 py-2 text-sm font-medium text-rust-cyan hover:bg-rust-cyan/30"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Ensure <code className="rounded bg-zinc-800 px-1">TIKFINITY_SERVER_ID</code> is set in your
          server environment so the webhook knows which Rust server to send commands to.
        </p>
        {data.webhookUrl && (
          <>
            <h3 className="mt-4 text-sm font-medium text-zinc-300">Per-action URLs (by event name)</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Use a dedicated URL so the server runs the right trigger. Add <code className="rounded bg-zinc-800 px-1">?action=scientist</code>, <code className="rounded bg-zinc-800 px-1">?action=wolf</code>, <code className="rounded bg-zinc-800 px-1">?action=bear</code>, etc.
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {webhookActions.map((a) => (
                <li key={a.action}>
                  <button
                    type="button"
                    onClick={() => {
                      const url = `${data!.webhookUrl!}?action=${a.action}`;
                      navigator.clipboard.writeText(url);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
                    title={`Copy ${data!.webhookUrl!}?action=${a.action}`}
                  >
                    {a.label ?? a.action}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
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
          Set the name (as in TikFinity), optional message and scrap, then choose the server action.
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
                onChange={(e) => setNewConnectionAction(e.target.value)}
                className="mt-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-200"
              >
                {webhookActions.map((a) => (
                  <option key={a.action} value={a.action}>{a.label ?? a.action}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const name = newConnectionName.trim();
              if (!name) { setConnectionError("Enter a name"); return; }
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
                }),
              })
                .then((r) => r.json().then((j) => ({ status: r.status, ...j })))
                .then((res) => {
                  if (res.id) {
                    setNewConnectionName("");
                    setNewConnectionMessage("");
                    setNewConnectionScrap(0);
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
                <th className="px-4 py-3 font-medium text-zinc-400">Server action</th>
                <th className="px-4 py-3 font-medium text-zinc-400 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {connections.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
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
          <h2 className="text-lg font-medium text-zinc-200">Available actions (RustMaxxTikTrigger)</h2>
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

      {/* Gift → action map */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h2 className="text-lg font-medium text-zinc-200">Gift → action map (current)</h2>
          <p className="mt-1 text-sm text-zinc-500">
            When TikFinity sends a gift with one of these names, the corresponding action runs on the server.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-800/50">
                <th className="px-4 py-3 font-medium text-zinc-400">TikTok gift name</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Action</th>
              </tr>
            </thead>
            <tbody>
              {giftEntries.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-6 text-center text-zinc-500">
                    No mappings.
                  </td>
                </tr>
              ) : (
                giftEntries.map(([gift, action]) => (
                  <tr key={gift} className="border-b border-zinc-800/50">
                    <td className="px-4 py-3 text-zinc-300">{gift}</td>
                    <td className="px-4 py-3 font-mono text-rust-cyan">{action}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
