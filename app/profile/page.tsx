"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type Profile = {
  id: string;
  email: string;
  role: string;
  display_name: string | null;
  created_at: string;
};

type TwitchStatus = {
  linked: boolean;
  twitch_login?: string;
  twitch_display_name?: string;
  linked_at?: string;
};

function formatRole(role: string): string {
  return role.replace(/_/g, " ");
}

type ServerOption = { id: string; name: string };

function TwitchLinkServerBlock({ onLinked }: { onLinked?: () => void }) {
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [serverId, setServerId] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkMsg, setLinkMsg] = useState<"ok" | "err" | null>(null);
  const [testBroadcast, setTestBroadcast] = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [testChat, setTestChat] = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [testChatError, setTestChatError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/servers")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { id: string; name: string }[]) => setServers(Array.isArray(list) ? list : []));
  }, []);

  function linkServer() {
    if (!serverId) return;
    setLinking(true);
    setLinkMsg(null);
    fetch("/api/twitch/link-server", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server_id: serverId, add_follow_broadcast_rule: true }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, ...d })))
      .then((d) => {
        setLinkMsg(d.ok ? "ok" : "err");
        if (d.ok) onLinked?.();
      })
      .finally(() => setLinking(false));
  }

  function runTestBroadcast() {
    setTestBroadcast("sending");
    setTestError(null);
    fetch("/api/twitch/test-broadcast", { method: "POST" })
      .then((r) => r.json().then((d) => ({ ok: r.ok, error: d.error })))
      .then((d) => {
        setTestBroadcast(d.ok ? "ok" : "err");
        if (!d.ok) setTestError(d.error ?? "Request failed");
      })
      .catch(() => {
        setTestBroadcast("err");
        setTestError("Network error");
      });
  }

  function runTestChat() {
    setTestChat("sending");
    setTestChatError(null);
    fetch("/api/twitch/test-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
      .then((r) => r.json().then((d) => ({ ok: r.ok, error: d.error })))
      .then((d) => {
        setTestChat(d.ok ? "ok" : "err");
        if (!d.ok) setTestChatError(d.error ?? "Request failed");
      })
      .catch(() => {
        setTestChat("err");
        setTestChatError("Network error");
      });
  }

  if (servers.length === 0) return null;

  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/50 p-3 space-y-3">
      <p className="mb-2 text-xs font-medium text-zinc-400">Follow → in-game broadcast</p>
      <p className="mb-2 text-xs text-zinc-500">
        Link a server to send &quot;New follower: username!&quot; to in-game chat when someone follows your channel.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={serverId}
          onChange={(e) => setServerId(e.target.value)}
          className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
        >
          <option value="">Select server</option>
          {servers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={linkServer}
          disabled={linking || !serverId}
          className="rounded bg-rust-cyan/20 px-3 py-1.5 text-sm font-medium text-rust-cyan hover:bg-rust-cyan/30 disabled:opacity-50"
        >
          {linking ? "Linking…" : "Link server"}
        </button>
      </div>
      {linkMsg === "ok" && <p className="text-xs text-green-400">Server linked. Follow events will trigger in-game broadcast.</p>}
      {linkMsg === "err" && <p className="text-xs text-amber-400">Link failed. Check you have access to that server.</p>}

      <div className="border-t border-zinc-700 pt-2">
        <p className="mb-1.5 text-xs text-zinc-500">In your Twitch chat, type <code className="rounded bg-zinc-700 px-1">!rust your message</code> (only you, the broadcaster) to send that message to the linked server&apos;s in-game chat. <code className="rounded bg-zinc-700 px-1">irust</code> also works. Rate limited to once per 10 seconds.</p>
        <p className="mb-1.5 text-xs text-zinc-500">If chat or follow events stop working, use &quot;Refresh event subscriptions&quot; above—no need to revoke.</p>
        <button
          type="button"
          onClick={runTestChat}
          disabled={testChat === "sending"}
          className="mt-1 rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
        >
          {testChat === "sending" ? "Sending…" : "Test !rust (sends to game now)"}
        </button>
        {testChat === "ok" && <p className="mt-1.5 text-xs text-green-400">Sent. If you see it in-game, the pipeline works. If Twitch chat still doesn&apos;t trigger it, Twitch events may not be reaching the webhook—reconnect Twitch and check server logs.</p>}
        {testChat === "err" && testChatError && <p className="mt-1.5 text-xs text-amber-400">{testChatError}</p>}
      </div>
      <div className="border-t border-zinc-700 pt-2">
        <p className="mb-1.5 text-xs text-zinc-500">Verify connection without a real follow:</p>
        <button
          type="button"
          onClick={runTestBroadcast}
          disabled={testBroadcast === "sending"}
          className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
        >
          {testBroadcast === "sending" ? "Sending…" : "Test follow broadcast"}
        </button>
        {testBroadcast === "ok" && <p className="mt-1.5 text-xs text-green-400">Sent. Check in-game chat and the server live console.</p>}
        {testBroadcast === "err" && testError && <p className="mt-1.5 text-xs text-amber-400">{testError}</p>}
      </div>
    </div>
  );
}

function ProfilePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [twitch, setTwitch] = useState<TwitchStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshSubs, setRefreshSubs] = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [refreshSubsMsg, setRefreshSubsMsg] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [setupStatus, setSetupStatus] = useState<{
    linked: boolean;
    linkedServerCount: number;
    followSubscriptionActive: boolean;
    chatSubscriptionActive: boolean;
  } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (!r.ok) {
          router.push("/login?from=/profile");
          return null;
        }
        return r.json();
      })
      .then(setProfile)
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!profile) return;
    fetch("/api/twitch/status")
      .then((r) => (r.ok ? r.json() : { linked: false }))
      .then(setTwitch);
  }, [profile]);

  useEffect(() => {
    if (!twitch?.linked) {
      setSetupStatus(null);
      return;
    }
    fetch("/api/twitch/setup-status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setSetupStatus)
      .catch(() => setSetupStatus(null));
  }, [twitch?.linked, refreshSubs]);

  function runRefreshSubscriptions() {
    setRefreshSubs("sending");
    setRefreshSubsMsg(null);
    // Clear stale EventSub error from URL so only the refresh result is shown
    if (searchParams.get("eventsub") || searchParams.get("eventsub_error")) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("eventsub");
      params.delete("eventsub_error");
      const q = params.toString();
      router.replace(q ? `/profile?${q}` : "/profile");
    }
    fetch("/api/twitch/refresh-subscriptions", { method: "POST" })
      .then((r) => r.json().then((d) => ({ ok: r.ok, ...d })))
      .then((d) => {
        setRefreshSubs(d.ok ? "ok" : "err");
        setRefreshSubsMsg(d.ok ? (d.message ?? "Subscriptions refreshed.") : [d.error ?? "Request failed", d.detail].filter(Boolean).join(" — "));
        if (d.ok) {
          const params = new URLSearchParams(searchParams.toString());
          params.delete("eventsub");
          params.delete("eventsub_error");
          const q = params.toString();
          router.replace(q ? `/profile?${q}` : "/profile");
        }
      })
      .catch(() => {
        setRefreshSubs("err");
        setRefreshSubsMsg("Network error");
      });
  }

  function runDisconnectTwitch() {
    if (disconnecting) return;
    setDisconnecting(true);
    fetch("/api/twitch/disconnect", { method: "POST" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed"))))
      .then(() => {
        setTwitch({ linked: false });
      })
      .catch(() => {
        setDisconnecting(false);
      })
      .finally(() => {
        setDisconnecting(false);
      });
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-zinc-500">
        Loading…
      </div>
    );
  }
  if (!profile) {
    return null;
  }
  return (
    <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-6">
          <h1 className="mb-6 text-2xl font-bold text-zinc-100">Your profile</h1>
          <dl className="space-y-4">
            <div>
              <dt className="text-sm text-zinc-500">Email</dt>
              <dd className="mt-0.5 font-medium text-zinc-100">{profile.email}</dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500">Display name</dt>
              <dd className="mt-0.5 font-medium text-zinc-100">
                {profile.display_name || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500">Role</dt>
              <dd className="mt-0.5">
                <span className="rounded bg-zinc-800 px-2 py-1 text-sm font-medium text-rust-cyan">
                  {formatRole(profile.role)}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500">Member since</dt>
              <dd className="mt-0.5 text-zinc-300">
                {new Date(profile.created_at).toLocaleDateString()}
              </dd>
            </div>
          </dl>
          <p className="mt-6 text-sm text-zinc-500">
            Role permissions:{" "}
            {profile.role === "super_admin" && "Can promote users to admin and remove admins."}
            {profile.role === "admin" && "Can create and manage servers."}
            {profile.role === "moderator" && "Can create server users."}
            {["support", "streamer", "player", "guest"].includes(profile.role) &&
              "Access to dashboard and server list."}
          </p>
          {profile.role === "super_admin" && (
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/admin"
                className="rounded bg-rust-cyan/20 px-3 py-2 text-sm font-medium text-rust-cyan hover:bg-rust-cyan/30"
              >
                Super Admin Dashboard →
              </Link>
              <Link
                href="/admin/users"
                className="rounded bg-zinc-700 px-3 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-600"
              >
                Manage users & roles →
              </Link>
            </div>
          )}

          <div className="mt-8 border-t border-zinc-800 pt-6">
            <h2 className="mb-3 text-lg font-semibold text-zinc-100">Twitch</h2>
            {twitch?.linked ? (
              <div className="space-y-4">
                <p className="text-sm text-zinc-300">
                  Connected as <strong className="text-rust-cyan">{twitch.twitch_display_name ?? twitch.twitch_login ?? "Twitch"}</strong>
                  {twitch.linked_at && (
                    <span className="ml-2 text-zinc-500">
                      (linked {new Date(twitch.linked_at).toLocaleDateString()})
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={runRefreshSubscriptions}
                    disabled={refreshSubs === "sending"}
                    className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
                  >
                    {refreshSubs === "sending" ? "Refreshing…" : "Refresh event subscriptions"}
                  </button>
                  <button
                    type="button"
                    onClick={runDisconnectTwitch}
                    disabled={disconnecting}
                    className="rounded border border-amber-600/60 bg-amber-900/20 px-3 py-1.5 text-sm font-medium text-amber-400 hover:bg-amber-900/40 disabled:opacity-50"
                  >
                    {disconnecting ? "Disconnecting…" : "Disconnect Twitch"}
                  </button>
                  {refreshSubs === "ok" && refreshSubsMsg && <span className="text-sm text-green-400">{refreshSubsMsg}</span>}
                  {refreshSubs === "err" && refreshSubsMsg && <span className="text-sm text-amber-400">{refreshSubsMsg}</span>}
                </div>
                {setupStatus?.linked && (
                  <div className="rounded border border-zinc-700 bg-zinc-800/40 px-3 py-2 text-sm">
                    <p className="mb-1.5 font-medium text-zinc-300">Follow notifications setup</p>
                    <ul className="space-y-1 text-zinc-400">
                      <li>
                        {setupStatus.followSubscriptionActive ? (
                          <span className="text-green-400">✓ Follow subscription active</span>
                        ) : (
                          <span className="text-amber-400">✗ Follow subscription missing — click &quot;Refresh event subscriptions&quot; above</span>
                        )}
                      </li>
                      <li>
                        {setupStatus.linkedServerCount > 0 ? (
                          <span className="text-green-400">✓ Server linked for in-game broadcast</span>
                        ) : (
                          <span className="text-amber-400">✗ No server linked — link a server below so follows trigger in-game</span>
                        )}
                      </li>
                      <li className="text-zinc-500">Use &quot;Test follow broadcast&quot; below to verify the pipeline.</li>
                    </ul>
                  </div>
                )}
                <Link
                  href="/streamer-interaction"
                  className="inline-block text-sm text-rust-cyan hover:underline"
                >
                  Streamer interaction & events →
                </Link>
                <TwitchLinkServerBlock
                  onLinked={() => {
                    fetch("/api/twitch/setup-status")
                      .then((r) => (r.ok ? r.json() : null))
                      .then((s) => s && setSetupStatus(s))
                      .catch(() => {});
                  }}
                />
              </div>
            ) : (
              <div>
                <p className="mb-2 text-sm text-zinc-500">Connect Twitch to enable follow events and in-game broadcasts.</p>
                <a
                  href="/api/twitch/connect"
                  className="inline-block rounded bg-[#9146ff] px-3 py-2 text-sm font-medium text-white hover:bg-[#7c3aed]"
                >
                  Connect Twitch
                </a>
              </div>
            )}
            {searchParams.get("twitch") === "linked" && (
              <p className="mt-2 text-sm text-green-400">Twitch account linked successfully.</p>
            )}
            {searchParams.get("twitch") === "linked" && searchParams.get("eventsub") === "failed" && (
              <div className="mt-2 flex flex-wrap items-start gap-2 text-sm text-amber-400">
                <p className="min-w-0 flex-1">
                  Follow notifications could not be enabled (Twitch EventSub failed).{" "}
                  {searchParams.get("eventsub_error") ? (
                    <>Twitch said: <span className="font-mono text-xs">{(() => { try { return decodeURIComponent(searchParams.get("eventsub_error") ?? ""); } catch { return searchParams.get("eventsub_error") ?? ""; } })()}</span></>
                  ) : (
                    "Check that TWITCH_WEBHOOK_CALLBACK_URL and TWITCH_EVENTSUB_SECRET are set and the webhook URL is reachable."
                  )}{" "}
                  Ensure /api/twitch/webhook is publicly reachable (no auth). Try &quot;Refresh event subscriptions&quot; or disconnect and reconnect Twitch.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const params = new URLSearchParams(searchParams.toString());
                    params.delete("eventsub");
                    params.delete("eventsub_error");
                    const q = params.toString();
                    router.replace(q ? `/profile?${q}` : "/profile");
                  }}
                  className="shrink-0 rounded border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-xs text-amber-400 hover:bg-amber-500/20"
                >
                  Dismiss
                </button>
              </div>
            )}
            {searchParams.get("twitch") === "state_invalid" && (
              <p className="mt-2 text-sm text-amber-400">Link expired or invalid. Try connecting again.</p>
            )}
            {searchParams.get("twitch") === "already_linked" && (
              <p className="mt-2 text-sm text-amber-400">
                This Twitch account is already linked to another RustMaxx user. Use a different Twitch account, or ask that user to disconnect Twitch in their Profile first.
              </p>
            )}
            {searchParams.get("twitch") === "exchange_failed" && (
              <p className="mt-2 text-sm text-amber-400">Twitch connection failed. Try again or check server logs.</p>
            )}
          </div>
        </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-zinc-500">Loading…</div>}>
      <ProfilePageContent />
    </Suspense>
  );
}
