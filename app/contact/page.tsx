"use client";

import { useState } from "react";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

const MAILTO = "mailto:support@example.com?subject=RustMaxx%20inquiry";

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false);

  return (
    <MarketingLayout>
      <div className="relative px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-xl">
          <h1 className="text-3xl font-bold text-zinc-100">Contact</h1>
          <p className="mt-2 text-zinc-400">
            No backend is connected. Use the form to prepare your message, or email us directly.
          </p>

          <form
            className="mt-8 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(true);
            }}
          >
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-zinc-300">
                Name
              </label>
              <input
                id="name"
                type="text"
                name="name"
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
                className="mt-1 w-full rounded-lg border border-rust-border bg-rust-surface px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="message" className="block text-sm font-medium text-zinc-300">
                Message
              </label>
              <textarea
                id="message"
                name="message"
                rows={4}
                className="mt-1 w-full rounded-lg border border-rust-border bg-rust-surface px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
                placeholder="Your message"
              />
            </div>
            <div className="flex flex-wrap gap-4">
              <button
                type="submit"
                className="rounded-lg bg-rust-cyan px-4 py-2 font-medium text-rust-panel hover:opacity-90"
              >
                Submit (placeholder)
              </button>
              <a
                href={MAILTO}
                className="rounded-lg border border-rust-border px-4 py-2 font-medium text-zinc-200 hover:border-rust-mute"
              >
                Email us instead
              </a>
            </div>
          </form>

          {submitted && (
            <p className="mt-4 text-sm text-rust-cyan">
              Form submitted (no backend). For now, use the mailto link to email us.
            </p>
          )}

          <p className="mt-6 text-xs text-zinc-500">
            Replace the mailto address with your real support email when you&apos;re ready.
          </p>
        </div>
      </div>
    </MarketingLayout>
  );
}
