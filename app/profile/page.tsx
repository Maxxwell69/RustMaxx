"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  MEMBERSHIP_LEVEL_LABELS,
  type MembershipLevel,
} from "@/lib/membership-level";
import { SteamIdForm } from "@/components/profile/SteamIdForm";
import type { AuthMePayload } from "@/lib/auth-me-payload";
import { LogoUpload } from "@/app/servers/logo-upload";
import {
  DIRECTORY_SOCIAL_KEYS,
  DIRECTORY_SOCIAL_LABELS,
  type DirectorySocialKey,
} from "@/lib/streamer-directory-socials";

type Profile = AuthMePayload;

type StreamerApplicationRecord = {
  status: string;
  admin_notes: string | null;
  tiktok_url?: string | null;
  twitch_url?: string | null;
  kick_url?: string | null;
  youtube_url?: string | null;
  twitter_url?: string | null;
  instagram_url?: string | null;
  discord_username?: string | null;
  other_socials?: string | null;
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

function socialDraftFromAuthPayload(s: Record<string, string> | undefined): Record<string, string> {
  const src = s ?? {};
  const out: Record<string, string> = {};
  for (const k of DIRECTORY_SOCIAL_KEYS) {
    out[k] = src[k] ?? "";
  }
  return out;
}

function applicationSocialHint(
  app: StreamerApplicationRecord | null | undefined,
  key: DirectorySocialKey
): string | null {
  if (!app) return null;
  const v = app[key];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
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

  const [streamerApp, setStreamerApp] = useState<undefined | null | StreamerApplicationRecord>(undefined);

  const [dirDraft, setDirDraft] = useState({
    visible: false,
    bio: "",
    avatar: "",
    showServers: false,
    socials: {} as Record<string, string>,
  });
  const [dirSaveMsg, setDirSaveMsg] = useState<string | null>(null);
  const [dirSaving, setDirSaving] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (!r.ok) {
          router.push("/login?from=/profile");
          return null;
        }
        return r.json();
      })
      .then((p) => {
        setProfile(p);
      })
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!profile) return;
    fetch("/api/twitch/status")
      .then((r) => (r.ok ? r.json() : { linked: false }))
      .then(setTwitch);
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    setDirDraft({
      visible: Boolean(profile.streamer_directory_visible),
      bio: profile.streamer_directory_bio ?? "",
      avatar: profile.streamer_directory_avatar_url ?? "",
      showServers: Boolean(profile.streamer_directory_show_servers),
      socials: socialDraftFromAuthPayload(profile.streamer_directory_socials),
    });
  }, [
    profile?.id,
    profile?.streamer_directory_visible,
    profile?.streamer_directory_bio,
    profile?.streamer_directory_avatar_url,
    profile?.streamer_directory_show_servers,
    profile?.streamer_directory_socials,
  ]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    fetch("/api/streamer-application")
      .then((r) => (r.ok ? r.json() : { application: null }))
      .then((d: { application: StreamerApplicationRecord | null }) => {
        if (!cancelled) setStreamerApp(d.application ?? null);
      });
    return () => {
      cancelled = true;
    };
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

  async function saveDirectorySettings() {
    if (!profile) return;
    const canDirectoryOptIn =
      profile.role === "super_admin" || streamerApp?.status === "approved";
    if (!canDirectoryOptIn && dirDraft.visible) {
      setDirSaveMsg("Your RustMaxx streamer application must be approved before you can appear in the directory.");
      return;
    }
    setDirSaving(true);
    setDirSaveMsg(null);
    try {
      const res = await fetch("/api/user/streamer-directory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          streamer_directory_visible: dirDraft.visible,
          streamer_directory_bio: dirDraft.bio.trim() || null,
          streamer_directory_avatar_url: dirDraft.avatar.trim() || null,
          streamer_directory_show_servers: dirDraft.showServers,
          streamer_directory_socials: Object.fromEntries(
            DIRECTORY_SOCIAL_KEYS.map((k) => [k, dirDraft.socials[k] ?? ""])
          ) as Record<string, string>,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDirSaveMsg(typeof data.error === "string" ? data.error : "Save failed");
        return;
      }
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              streamer_directory_visible: Boolean(data.streamer_directory_visible),
              streamer_directory_avatar_url: data.streamer_directory_avatar_url ?? null,
              streamer_directory_bio: data.streamer_directory_bio ?? null,
              streamer_directory_socials: socialDraftFromAuthPayload(
                data.streamer_directory_socials as Record<string, string> | undefined
              ),
              streamer_directory_show_servers: Boolean(data.streamer_directory_show_servers),
            }
          : prev
      );
      setDirDraft((d) => ({
        ...d,
        visible: Boolean(data.streamer_directory_visible),
        bio: data.streamer_directory_bio ?? "",
        avatar: data.streamer_directory_avatar_url ?? "",
        showServers: Boolean(data.streamer_directory_show_servers),
        socials: socialDraftFromAuthPayload(data.streamer_directory_socials as Record<string, string> | undefined),
      }));
      setDirSaveMsg("Saved.");
    } catch {
      setDirSaveMsg("Network error");
    } finally {
      setDirSaving(false);
    }
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

  const wantsOwner = profile.signup_interested_server_owner === true;
  const wantsStreamer = profile.signup_interested_streamer === true;
  const showSignupOnboarding = wantsOwner || wantsStreamer;
  const canApplyStreamer =
    profile.role === "guest" || profile.role === "player";
  const streamerPitchAtTop =
    showSignupOnboarding &&
    canApplyStreamer &&
    streamerApp === null &&
    (wantsStreamer || wantsOwner);

  const canDirectoryOptIn =
    profile.role === "super_admin" || streamerApp?.status === "approved";

  return (
    <div className="mx-auto max-w-2xl p-6">
        {showSignupOnboarding && (
          <div className="mb-6 rounded-xl border-2 border-rust-cyan/40 bg-gradient-to-b from-rust-cyan/15 to-zinc-900/80 p-5 shadow-lg ring-1 ring-rust-cyan/20">
            <h2 className="text-lg font-semibold text-zinc-100">Welcome — finish your setup</h2>
            <p className="mt-1 text-sm text-zinc-400">
              {wantsOwner && wantsStreamer && (
                <>
                  You chose <strong className="text-zinc-300">server owner</strong> and{" "}
                  <strong className="text-zinc-300">streamer</strong>. Open the dashboard for your servers, then complete
                  the streamer application for TikTok / TikFinity tooling.
                </>
              )}
              {wantsOwner && !wantsStreamer && (
                <>
                  You chose <strong className="text-zinc-300">Rust server owner</strong>. Head to the dashboard to add
                  servers. TikTok / streamer integrations use the streamer application — we surface it here so you
                  don&apos;t miss it.
                </>
              )}
              {!wantsOwner && wantsStreamer && (
                <>
                  You chose <strong className="text-zinc-300">streamer</strong>. Complete the streamer application below
                  so we can approve TikFinity hooks and stream tools for your account.
                </>
              )}
            </p>
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start">
              {wantsOwner && (
                <Link
                  href="/servers"
                  className="inline-flex shrink-0 items-center justify-center rounded-lg bg-rust-cyan px-4 py-2.5 text-sm font-semibold text-zinc-950 shadow-rust-glow hover:opacity-95"
                >
                  Open dashboard →
                </Link>
              )}
              {streamerPitchAtTop && (
                <div className="min-w-0 flex-1 rounded-lg border border-zinc-600/80 bg-zinc-900/60 p-4">
                  <h3 className="text-sm font-semibold text-zinc-100">Streamer application</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Apply with your legal name, TikTok and other social links, and a short pitch so we can confirm
                    you&apos;re a good fit for RustMaxx streamer tools.
                  </p>
                  <Link
                    href="/streamer/register"
                    className="mt-3 inline-flex rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
                  >
                    Start streamer application →
                  </Link>
                </div>
              )}
            </div>
            {streamerApp !== null && streamerApp !== undefined && canApplyStreamer && (
              <p className="mt-4 text-xs text-zinc-400">
                Streamer application:{" "}
                <span className="font-medium text-zinc-200">
                  {streamerApp.status === "pending" && "Pending review"}
                  {streamerApp.status === "approved" && "Approved"}
                  {streamerApp.status === "rejected" && "Not approved (you can update and resubmit)"}
                </span>
                .{" "}
                <Link href="/streamer/register" className="text-rust-cyan hover:underline">
                  Open application →
                </Link>
              </p>
            )}
            {!canApplyStreamer && (wantsStreamer || wantsOwner) && (
              <p className="mt-4 text-xs text-zinc-500">
                Your role already has elevated access; use the sections below for Twitch, Steam, and streamer tools.
              </p>
            )}
          </div>
        )}

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
            <div>
              <dt className="text-sm text-zinc-500">Last password sign-in</dt>
              <dd className="mt-0.5 text-zinc-300">
                {profile.last_login_at
                  ? new Date(profile.last_login_at).toLocaleString()
                  : "Not recorded yet"}
              </dd>
            </div>
            {profile.membership_level && (
              <div>
                <dt className="text-sm text-zinc-500">Membership level</dt>
                <dd className="mt-0.5">
                  <span className="rounded bg-emerald-950/80 px-2 py-1 text-sm text-emerald-300">
                    {MEMBERSHIP_LEVEL_LABELS[profile.membership_level as MembershipLevel] ??
                      profile.membership_level}
                  </span>
                </dd>
              </div>
            )}
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

          {streamerApp !== undefined && !streamerPitchAtTop && (
            <div className="mt-8 rounded-lg border border-zinc-700 bg-zinc-800/40 p-4">
              <h2 className="mb-2 text-sm font-semibold text-zinc-100">Streamer application</h2>
              {streamerApp === null && (profile.role === "guest" || profile.role === "player") && (
                <>
                  <p className="text-xs text-zinc-500">
                    Apply with your legal name, TikTok and other social links, and a short pitch so we can confirm you&apos;re
                    a good fit for RustMaxx streamer tools.
                  </p>
                  <Link
                    href="/streamer/register"
                    className="mt-3 inline-flex rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-600"
                  >
                    Start streamer application →
                  </Link>
                </>
              )}
              {streamerApp === null && profile.role !== "guest" && profile.role !== "player" && (
                <p className="text-xs text-zinc-500">No application on file (role already elevated).</p>
              )}
              {streamerApp !== null && (
                <div className="space-y-2 text-xs">
                  <p className="text-zinc-400">
                    Status:{" "}
                    <span className="font-medium text-zinc-200">
                      {streamerApp.status === "pending" && "Pending review"}
                      {streamerApp.status === "approved" && "Approved"}
                      {streamerApp.status === "rejected" && "Not approved (you can update and resubmit)"}
                    </span>
                  </p>
                  {streamerApp.status === "rejected" && streamerApp.admin_notes && (
                    <p className="text-zinc-500">
                      <span className="text-zinc-600">Note:</span> {streamerApp.admin_notes}
                    </p>
                  )}
                  <Link href="/streamer/register" className="inline-block text-rust-cyan hover:underline">
                    {streamerApp.status === "approved"
                      ? "View submitted details"
                      : "Open application form →"}
                  </Link>
                </div>
              )}
            </div>
          )}

          <div className="mt-8 rounded-lg border border-rust-cyan/25 bg-rust-cyan/5 p-4">
            <h2 className="mb-2 text-sm font-semibold text-zinc-100">Streamer interactions</h2>
            <p className="mb-3 text-xs text-zinc-500">
              Connect TikFinity to your Rust server: webhook URL, event rules, and Steam anchor for in-game actions.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Link
                href="/streamer"
                className="inline-flex items-center justify-center rounded-lg bg-rust-cyan px-4 py-2 text-sm font-medium text-zinc-950 hover:opacity-90"
              >
                Streamer setup →
              </Link>
              <Link
                href="/streamer-interaction"
                className="inline-flex items-center justify-center rounded-lg border border-zinc-600 bg-zinc-800/80 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
              >
                About streamer interaction →
              </Link>
            </div>
          </div>

          <div id="public-streamer" className="mt-8 border-t border-zinc-800 pt-6">
            <h2 className="mb-3 text-lg font-semibold text-zinc-100">Public streamer page</h2>
            <p className="mb-4 text-sm text-zinc-500">
              Control whether you appear on the{" "}
              <Link href="/streamers" className="text-rust-cyan hover:underline">
                RustMaxx streamers
              </Link>{" "}
              directory. Social links merge with your approved streamer application: anything you leave empty here still
              uses the application value on your public page. Avatar and bio are separate from your Steam card above.
            </p>
            {streamerApp === undefined ? (
              <p className="text-xs text-zinc-500">Loading application status…</p>
            ) : (
              <div className="space-y-4 rounded-lg border border-zinc-700 bg-zinc-800/40 p-4">
                <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    className="mt-1 rounded border-zinc-600"
                    checked={dirDraft.visible}
                    onChange={(e) => setDirDraft((d) => ({ ...d, visible: e.target.checked }))}
                    disabled={!canDirectoryOptIn}
                  />
                  <span>
                    Show my profile on the public streamers directory
                    {!canDirectoryOptIn ? (
                      <span className="mt-1 block text-xs text-amber-400/90">
                        Your RustMaxx streamer application must be approved by staff before you can enable this (super
                        admins excepted).
                      </span>
                    ) : null}
                  </span>
                </label>
                <div>
                  <p className="mb-1 text-xs font-medium text-zinc-500">Directory profile picture</p>
                  <LogoUpload
                    value={dirDraft.avatar}
                    onChange={(url) => setDirDraft((d) => ({ ...d, avatar: url }))}
                    disabled={dirSaving}
                  />
                </div>
                <div>
                  <label htmlFor="dir-bio" className="mb-1 block text-xs font-medium text-zinc-500">
                    Public bio
                  </label>
                  <textarea
                    id="dir-bio"
                    rows={4}
                    value={dirDraft.bio}
                    onChange={(e) => setDirDraft((d) => ({ ...d, bio: e.target.value }))}
                    disabled={dirSaving}
                    className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 disabled:opacity-50"
                    placeholder="Short intro for visitors…"
                  />
                </div>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    className="mt-1 rounded border-zinc-600"
                    checked={dirDraft.showServers}
                    onChange={(e) => setDirDraft((d) => ({ ...d, showServers: e.target.checked }))}
                    disabled={dirSaving}
                  />
                  <span>
                    Show listed RustMaxx servers I have approved streamer access on
                    <span className="mt-1 block text-xs text-zinc-500">
                      Only servers that appear on the public server list are shown, so private servers stay off your
                      page.
                    </span>
                  </span>
                </label>
                <div className="border-t border-zinc-700 pt-3">
                  <p className="mb-2 text-xs font-medium text-zinc-400">Social links (public page)</p>
                  <p className="mb-3 text-xs text-zinc-500">
                    Override a link for visitors, or leave a field empty to keep using your streamer application value
                    (shown in small text when present).
                  </p>
                  <div className="space-y-3">
                    {DIRECTORY_SOCIAL_KEYS.map((key) => {
                      const hint = applicationSocialHint(streamerApp, key);
                      const isTextarea = key === "other_socials";
                      const isDiscord = key === "discord_username";
                      return (
                        <div key={key}>
                          <label className="mb-0.5 block text-xs font-medium text-zinc-500">
                            {DIRECTORY_SOCIAL_LABELS[key]}
                          </label>
                          {isTextarea ? (
                            <textarea
                              rows={2}
                              value={dirDraft.socials[key] ?? ""}
                              onChange={(e) =>
                                setDirDraft((d) => ({
                                  ...d,
                                  socials: { ...d.socials, [key]: e.target.value },
                                }))
                              }
                              disabled={dirSaving}
                              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 disabled:opacity-50"
                              placeholder="Extra links or notes (plain text)…"
                            />
                          ) : (
                            <input
                              type={isDiscord ? "text" : "url"}
                              value={dirDraft.socials[key] ?? ""}
                              onChange={(e) =>
                                setDirDraft((d) => ({
                                  ...d,
                                  socials: { ...d.socials, [key]: e.target.value },
                                }))
                              }
                              disabled={dirSaving}
                              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 disabled:opacity-50"
                              placeholder="https://… (leave empty to use application)"
                            />
                          )}
                          {hint ? (
                            <p className="mt-0.5 text-[11px] text-zinc-600">
                              From application: <span className="break-all text-zinc-500">{hint}</span>
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void saveDirectorySettings()}
                    disabled={dirSaving}
                    className="rounded bg-rust-cyan px-4 py-2 text-sm font-medium text-zinc-950 hover:opacity-90 disabled:opacity-50"
                  >
                    {dirSaving ? "Saving…" : "Save directory profile"}
                  </button>
                  <Link
                    href={`/streamers/${profile.id}`}
                    className="text-sm text-rust-cyan hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    View public page ↗
                  </Link>
                </div>
                {dirSaveMsg ? (
                  <p
                    className={`text-xs ${dirSaveMsg === "Saved." ? "text-emerald-400/90" : "text-amber-400/90"}`}
                  >
                    {dirSaveMsg}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <div id="steam" className="mt-8 border-t border-zinc-800 pt-6">
            <h2 className="mb-3 text-lg font-semibold text-zinc-100">Steam</h2>
            <p className="mb-4 text-sm text-zinc-500">
              Enter your Steam64 ID so RustMaxx can tie in-game actions to you (TikFinity, patrol anchor, MaxxInvaders).
            </p>
            {profile.steam ? (
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start">
                {profile.steam.avatarUrl ? (
                  <img
                    src={profile.steam.avatarUrl}
                    alt=""
                    width={64}
                    height={64}
                    className="h-16 w-16 shrink-0 rounded border border-zinc-600"
                  />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-zinc-600 bg-zinc-800 text-2xl text-zinc-500">
                    S
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium text-zinc-100">
                    {profile.steam.personaName ?? "Steam"}
                  </p>
                  <p className="font-mono text-xs text-zinc-500">
                    {profile.steam.steamId}
                  </p>
                  {profile.steam.linkedAt && (
                    <p className="text-xs text-zinc-500">
                      Saved {new Date(profile.steam.linkedAt).toLocaleString()}
                    </p>
                  )}
                  <a
                    href={profile.steam.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-sm text-rust-cyan hover:underline"
                  >
                    View Steam profile ↗
                  </a>
                  {!profile.steam.personaName && (
                    <p className="text-xs text-zinc-600">
                      Set{" "}
                      <code className="rounded bg-zinc-800 px-1">STEAM_WEB_API_KEY</code> on the server to load your
                      Steam name and avatar here.
                    </p>
                  )}
                </div>
              </div>
            ) : null}
            <SteamIdForm
              initialSteamId={profile.steam?.steamId ?? null}
              onSaved={(p) => setProfile(p)}
            />
          </div>

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
                <p className="text-xs text-zinc-500">
                  Rust + TikFinity webhooks: use{" "}
                  <Link href="/streamer" className="text-rust-cyan hover:underline">
                    Streamer setup
                  </Link>
                  . Overview:{" "}
                  <Link href="/streamer-interaction" className="text-rust-cyan hover:underline">
                    Streamer interaction
                  </Link>
                  .
                </p>
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
