"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ActionMeta = {
  action: string;
  description: string;
  exampleGifts: string[];
};

type ActionMapsResponse = {
  webhookUrl: string | null;
  availableActions: ActionMeta[];
  giftToActionMap: Record<string, string>;
};

export default function AdminStreamerInteractionsPage() {
  const [data, setData] = useState<ActionMapsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/tikfinity/action-maps")
      .then((r) => {
        if (r.status === 403) {
          setAccessDenied(true);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (d) setData(d);
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

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="text-zinc-500">Loading…</p>
      </div>
    );
  }

  if (accessDenied || !data) {
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

  const giftEntries = Object.entries(data.giftToActionMap).sort(
    ([a], [b]) => a.localeCompare(b)
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
              {data.availableActions.map((a) => (
                <tr key={a.action} className="border-b border-zinc-800/50">
                  <td className="px-4 py-3 font-mono text-rust-cyan">{a.action}</td>
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
