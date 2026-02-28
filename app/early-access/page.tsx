"use client";

import { useState } from "react";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

export default function EarlyAccessPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setDone(true);
      setName("");
      setEmail("");
      setMessage("");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <MarketingLayout>
      <div className="px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-md">
          <h1 className="text-3xl font-bold text-zinc-100">Get early access</h1>
          <p className="mt-2 text-zinc-400">
            Sign up and we&apos;ll notify you when RustMaxx is ready for you.
          </p>

          {done ? (
            <p className="mt-8 text-lg text-rust-cyan">
              Thanks! We&apos;ll be in touch soon.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div>
                <label htmlFor="ea-name" className="block text-sm font-medium text-zinc-300">
                  Name
                </label>
                <input
                  id="ea-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-rust-border bg-rust-surface px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
                  placeholder="Your name"
                />
              </div>
              <div>
                <label htmlFor="ea-email" className="block text-sm font-medium text-zinc-300">
                  Email <span className="text-zinc-500">*</span>
                </label>
                <input
                  id="ea-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-rust-border bg-rust-surface px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label htmlFor="ea-message" className="block text-sm font-medium text-zinc-300">
                  Message (optional)
                </label>
                <textarea
                  id="ea-message"
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-rust-border bg-rust-surface px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
                  placeholder="Tell us a bit about your server or use case"
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-rust-cyan px-4 py-2 text-sm font-medium text-rust-panel shadow-rust-glow hover:shadow-rust-glow-lg disabled:opacity-50"
              >
                {loading ? "Sending…" : "Submit"}
              </button>
            </form>
          )}
        </div>
      </div>
    </MarketingLayout>
  );
}
