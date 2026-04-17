"use client";

import { useMemo, useState } from "react";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { getPublicSupportEmails } from "@/lib/support-emails";

type Audience = "server-admin" | "streamer" | "viewer";
type Priority = "low" | "normal" | "high";

type ApiOk = {
  ok: true;
  synced: boolean;
  warning?: string;
  contactId?: string;
};

type ApiErr = { ok: false; error?: string; code?: string };

export default function ContactPage() {
  const emails = useMemo(() => getPublicSupportEmails(), []);

  const [audience, setAudience] = useState<Audience>("viewer");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [serverId, setServerId] = useState("");
  const [streamerId, setStreamerId] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ApiOk | ApiErr | null>(null);

  const mailtoForAudience = (a: Audience): string => {
    const addr =
      a === "server-admin"
        ? emails.serverAdmins
        : a === "streamer"
          ? emails.streamers
          : emails.viewers;
    const subj = encodeURIComponent(`RustMaxx — ${a.replace("-", " ")} support`);
    return `mailto:${addr}?subject=${subj}`;
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience,
          name,
          email,
          subject,
          message,
          priority,
          serverId: serverId.trim() || undefined,
          streamerId: streamerId.trim() || undefined,
        }),
      });
      const data = (await res.json()) as ApiOk | ApiErr;
      setResult(data);
    } catch {
      setResult({ ok: false, error: "Network error. Please try again or email us directly." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <MarketingLayout>
      <div className="relative px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-xl">
          <h1 className="text-3xl font-bold text-zinc-100">Contact</h1>
          <p className="mt-2 text-zinc-400">
            Send a message through the site (synced to our CRM when configured) or email the address that matches your
            role.
          </p>

          <div className="mt-6 rounded-lg border border-rust-border bg-rust-surface/50 p-4 text-sm text-zinc-300">
            <p className="font-medium text-zinc-200">Direct email</p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-zinc-400">
              <li>
                <span className="text-zinc-300">Server admins:</span>{" "}
                <a className="text-rust-cyan hover:underline" href={`mailto:${emails.serverAdmins}`}>
                  {emails.serverAdmins}
                </a>
              </li>
              <li>
                <span className="text-zinc-300">Streamers:</span>{" "}
                <a className="text-rust-cyan hover:underline" href={`mailto:${emails.streamers}`}>
                  {emails.streamers}
                </a>
              </li>
              <li>
                <span className="text-zinc-300">Viewers:</span>{" "}
                <a className="text-rust-cyan hover:underline" href={`mailto:${emails.viewers}`}>
                  {emails.viewers}
                </a>
              </li>
            </ul>
            <p className="mt-3 text-xs text-zinc-500">
              Override defaults with <code className="rounded bg-zinc-800 px-1">NEXT_PUBLIC_SUPPORT_EMAIL_*</code> in
              env. See <code className="rounded bg-zinc-800 px-1">docs/SUPPORT_EMAILS_AND_COMMS.md</code> in the repo
              for routing and SLAs.
            </p>
          </div>

          <form className="mt-8 space-y-4" onSubmit={onSubmit}>
            <div>
              <label htmlFor="audience" className="block text-sm font-medium text-zinc-300">
                I am a
              </label>
              <select
                id="audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value as Audience)}
                className="mt-1 w-full rounded-lg border border-rust-border bg-rust-surface px-3 py-2 text-zinc-100 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
              >
                <option value="viewer">Viewer / fan</option>
                <option value="streamer">Streamer / creator</option>
                <option value="server-admin">Server admin / owner</option>
              </select>
            </div>

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-zinc-300">
                Name
              </label>
              <input
                id="name"
                type="text"
                name="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                className="mt-1 w-full rounded-lg border border-rust-border bg-rust-surface px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
                placeholder="Your name"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-zinc-300">
                Email
              </label>
              <input
                id="email"
                type="email"
                name="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-rust-border bg-rust-surface px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="subject" className="block text-sm font-medium text-zinc-300">
                Subject
              </label>
              <input
                id="subject"
                type="text"
                name="subject"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={300}
                className="mt-1 w-full rounded-lg border border-rust-border bg-rust-surface px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
                placeholder="Short summary"
              />
            </div>
            <div>
              <label htmlFor="priority" className="block text-sm font-medium text-zinc-300">
                Priority
              </label>
              <select
                id="priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="mt-1 w-full rounded-lg border border-rust-border bg-rust-surface px-3 py-2 text-zinc-100 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
              >
                <option value="low">Low — general question</option>
                <option value="normal">Normal</option>
                <option value="high">High — production issue</option>
              </select>
            </div>
            <div>
              <label htmlFor="serverId" className="block text-sm font-medium text-zinc-300">
                Server ID <span className="text-zinc-500">(optional)</span>
              </label>
              <input
                id="serverId"
                type="text"
                name="serverId"
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-rust-border bg-rust-surface px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
                placeholder="From your RustMaxx dashboard"
              />
            </div>
            <div>
              <label htmlFor="streamerId" className="block text-sm font-medium text-zinc-300">
                Streamer / account ref <span className="text-zinc-500">(optional)</span>
              </label>
              <input
                id="streamerId"
                type="text"
                name="streamerId"
                value={streamerId}
                onChange={(e) => setStreamerId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-rust-border bg-rust-surface px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
                placeholder="Username or link if relevant"
              />
            </div>
            <div>
              <label htmlFor="message" className="block text-sm font-medium text-zinc-300">
                Message
              </label>
              <textarea
                id="message"
                name="message"
                rows={5}
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="mt-1 w-full rounded-lg border border-rust-border bg-rust-surface px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
                placeholder="What do you need help with?"
              />
            </div>
            <div className="flex flex-wrap gap-4">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-rust-cyan px-4 py-2 font-medium text-rust-panel shadow-rust-glow hover:opacity-90 hover:shadow-rust-glow-lg disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Submit"}
              </button>
              <a
                href={mailtoForAudience(audience)}
                className="rounded-lg border border-rust-cyan/50 px-4 py-2 font-medium text-rust-cyan hover:border-rust-cyan hover:shadow-rust-glow-subtle"
              >
                Email for this audience
              </a>
            </div>
          </form>

          {result && (
            <div className="mt-6 space-y-2 text-sm">
              {result.ok && result.synced && (
                <p className="text-rust-cyan">
                  Thanks — we received your message and synced it to our team. We&apos;ll reply using your email address.
                </p>
              )}
              {result.ok && !result.synced && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-100">
                  <p>{result.warning ?? "Your message was not synced to our ticketing system."}</p>
                </div>
              )}
              {!result.ok && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-100">
                  <p>{result.error ?? "Something went wrong."}</p>
                  <p className="mt-2 text-zinc-300">
                    You can still reach us at{" "}
                    <a className="text-rust-cyan underline" href={mailtoForAudience(audience)}>
                      {audience === "server-admin"
                        ? emails.serverAdmins
                        : audience === "streamer"
                          ? emails.streamers
                          : emails.viewers}
                    </a>
                    .
                  </p>
                </div>
              )}
            </div>
          )}

          <p className="mt-8 text-xs text-zinc-500">
            Operational details: see the repository file <code className="rounded bg-zinc-800 px-1">docs/SUPPORT_EMAILS_AND_COMMS.md</code>{" "}
            (support inboxes, GHL tags, internal vs external boundaries).
          </p>
        </div>
      </div>
    </MarketingLayout>
  );
}
