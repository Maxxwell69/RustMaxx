"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/marketing/Logo";

type ApplicationJson = {
  id: string;
  legal_name: string;
  preferred_stream_name: string;
  tiktok_url: string | null;
  twitch_url: string | null;
  kick_url: string | null;
  youtube_url: string | null;
  twitter_url: string | null;
  instagram_url: string | null;
  discord_username: string | null;
  other_socials: string | null;
  avg_live_viewers: string | null;
  stream_schedule: string | null;
  content_summary: string;
  why_rustmaxx: string;
  status: string;
  admin_notes: string | null;
  updated_at: string;
};

const empty = {
  legal_name: "",
  preferred_stream_name: "",
  tiktok_url: "",
  twitch_url: "",
  kick_url: "",
  youtube_url: "",
  twitter_url: "",
  instagram_url: "",
  discord_username: "",
  other_socials: "",
  avg_live_viewers: "",
  stream_schedule: "",
  content_summary: "",
  why_rustmaxx: "",
};

export default function StreamerRegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [rejectionNote, setRejectionNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (!me.ok) {
        if (!cancelled) {
          setForbidden(true);
          router.push("/login?from=/streamer/register");
          setLoading(false);
        }
        return;
      }
      const appRes = await fetch("/api/streamer-application", { credentials: "same-origin" });
      const data: { application: ApplicationJson | null } = appRes.ok
        ? await appRes.json()
        : { application: null };
      if (cancelled) return;
      const a = data?.application;
      if (a) {
        setStatus(a.status);
        setRejectionNote(a.status === "rejected" ? a.admin_notes : null);
        setForm({
          legal_name: a.legal_name,
          preferred_stream_name: a.preferred_stream_name,
          tiktok_url: a.tiktok_url ?? "",
          twitch_url: a.twitch_url ?? "",
          kick_url: a.kick_url ?? "",
          youtube_url: a.youtube_url ?? "",
          twitter_url: a.twitter_url ?? "",
          instagram_url: a.instagram_url ?? "",
          discord_username: a.discord_username ?? "",
          other_socials: a.other_socials ?? "",
          avg_live_viewers: a.avg_live_viewers ?? "",
          stream_schedule: a.stream_schedule ?? "",
          content_summary: a.content_summary,
          why_rustmaxx: a.why_rustmaxx,
        });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  function set<K extends keyof typeof empty>(key: K, value: (typeof empty)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const res = await fetch("/api/streamer-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          legal_name: form.legal_name,
          preferred_stream_name: form.preferred_stream_name,
          tiktok_url: form.tiktok_url || undefined,
          twitch_url: form.twitch_url || undefined,
          kick_url: form.kick_url || undefined,
          youtube_url: form.youtube_url || undefined,
          twitter_url: form.twitter_url || undefined,
          instagram_url: form.instagram_url || undefined,
          discord_username: form.discord_username || undefined,
          other_socials: form.other_socials || undefined,
          avg_live_viewers: form.avg_live_viewers || undefined,
          stream_schedule: form.stream_schedule || undefined,
          content_summary: form.content_summary,
          why_rustmaxx: form.why_rustmaxx,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not save");
        return;
      }
      setStatus("pending");
      setSuccess("Application submitted. We’ll review your socials and message and get back to you.");
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-zinc-500">
        Loading…
      </div>
    );
  }

  if (forbidden) {
    return null;
  }

  const readOnlyApproved = status === "approved";

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex justify-center">
          <Logo
            className="h-28 w-auto"
            width={720}
            height={144}
            fallbackClassName="text-2xl font-bold text-rust-cyan"
          />
        </div>
        <Link href="/profile" className="text-sm text-rust-cyan hover:underline">
          ← Profile
        </Link>
        <h1 className="mt-4 text-2xl font-semibold text-zinc-100">Streamer application</h1>
        <p className="mt-2 text-sm text-zinc-400">
          We use this to verify who you are on TikTok and elsewhere, and whether RustMaxx is a good fit. Submissions are
          reviewed manually.
        </p>

        {status === "pending" && !readOnlyApproved && (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Your application is <strong>pending review</strong>. You can update the details below until a decision is made.
          </div>
        )}
        {status === "approved" && (
          <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            You&apos;re <strong>approved</strong>. No further edits here. Use Profile for TikFinity and server setup.
          </div>
        )}
        {status === "rejected" && (
          <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <p>Last decision: <strong>not approved</strong>. You can revise and resubmit below.</p>
            {rejectionNote && (
              <p className="mt-2 text-zinc-300">
                <span className="text-zinc-500">Note:</span> {rejectionNote}
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Identity</h2>
            <div>
              <label htmlFor="legal_name" className="mb-1 block text-sm text-zinc-400">
                Full legal name <span className="text-red-400">*</span>
              </label>
              <input
                id="legal_name"
                value={form.legal_name}
                onChange={(e) => set("legal_name", e.target.value)}
                disabled={readOnlyApproved}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 disabled:opacity-60"
                required
                autoComplete="name"
              />
            </div>
            <div>
              <label htmlFor="preferred_stream_name" className="mb-1 block text-sm text-zinc-400">
                Name / brand you use on stream <span className="text-red-400">*</span>
              </label>
              <input
                id="preferred_stream_name"
                value={form.preferred_stream_name}
                onChange={(e) => set("preferred_stream_name", e.target.value)}
                disabled={readOnlyApproved}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 disabled:opacity-60"
                required
              />
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Social &amp; audience</h2>
            <p className="text-xs text-zinc-500">
              Provide at least one full profile URL (TikTok recommended) or describe your presence in &quot;Other socials&quot;.
            </p>
            {(
              [
                ["tiktok_url", "TikTok profile URL"],
                ["twitch_url", "Twitch channel URL"],
                ["kick_url", "Kick channel URL"],
                ["youtube_url", "YouTube channel URL"],
                ["twitter_url", "X (Twitter) profile URL"],
                ["instagram_url", "Instagram profile URL"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label htmlFor={key} className="mb-1 block text-sm text-zinc-400">
                  {label}
                </label>
                <input
                  id={key}
                  type="url"
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                  disabled={readOnlyApproved}
                  placeholder="https://"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 placeholder-zinc-600 disabled:opacity-60"
                />
              </div>
            ))}
            <div>
              <label htmlFor="discord_username" className="mb-1 block text-sm text-zinc-400">
                Discord username
              </label>
              <input
                id="discord_username"
                value={form.discord_username}
                onChange={(e) => set("discord_username", e.target.value)}
                disabled={readOnlyApproved}
                placeholder="e.g. name or name#0000"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 disabled:opacity-60"
              />
            </div>
            <div>
              <label htmlFor="other_socials" className="mb-1 block text-sm text-zinc-400">
                Other socials / links
              </label>
              <textarea
                id="other_socials"
                value={form.other_socials}
                onChange={(e) => set("other_socials", e.target.value)}
                disabled={readOnlyApproved}
                rows={3}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 disabled:opacity-60"
                placeholder="Anything else we should look at (Linktree, Discord server invite page, etc.)"
              />
            </div>
            <div>
              <label htmlFor="avg_live_viewers" className="mb-1 block text-sm text-zinc-400">
                Typical concurrent viewers (approximate)
              </label>
              <input
                id="avg_live_viewers"
                value={form.avg_live_viewers}
                onChange={(e) => set("avg_live_viewers", e.target.value)}
                disabled={readOnlyApproved}
                placeholder="e.g. 5–20, or N/A if just starting"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 disabled:opacity-60"
              />
            </div>
            <div>
              <label htmlFor="stream_schedule" className="mb-1 block text-sm text-zinc-400">
                Usual stream schedule / timezone
              </label>
              <textarea
                id="stream_schedule"
                value={form.stream_schedule}
                onChange={(e) => set("stream_schedule", e.target.value)}
                disabled={readOnlyApproved}
                rows={2}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 disabled:opacity-60"
              />
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Fit</h2>
            <div>
              <label htmlFor="content_summary" className="mb-1 block text-sm text-zinc-400">
                What do you stream? (Rust focus, tone, community) <span className="text-red-400">*</span>
              </label>
              <textarea
                id="content_summary"
                value={form.content_summary}
                onChange={(e) => set("content_summary", e.target.value)}
                disabled={readOnlyApproved}
                required
                rows={5}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 disabled:opacity-60"
              />
            </div>
            <div>
              <label htmlFor="why_rustmaxx" className="mb-1 block text-sm text-zinc-400">
                Why RustMaxx? What do you want to do with TikFinity / in-game integration?{" "}
                <span className="text-red-400">*</span>
              </label>
              <textarea
                id="why_rustmaxx"
                value={form.why_rustmaxx}
                onChange={(e) => set("why_rustmaxx", e.target.value)}
                disabled={readOnlyApproved}
                required
                rows={5}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 disabled:opacity-60"
              />
            </div>
          </section>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {success && <p className="text-sm text-emerald-400">{success}</p>}

          {!readOnlyApproved && (
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-rust-cyan px-4 py-3 font-medium text-rust-panel shadow-rust-glow hover:shadow-rust-glow-lg disabled:opacity-50"
            >
              {saving ? "Saving…" : status === "pending" ? "Update application" : "Submit application"}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
