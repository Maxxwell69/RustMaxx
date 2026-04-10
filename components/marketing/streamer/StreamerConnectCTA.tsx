"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function StreamerConnectCTA() {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => setLoggedIn(r.ok))
      .catch(() => setLoggedIn(false));
  }, []);

  return (
    <section
      className="border-b border-rust-border bg-rust-cyan/10 px-4 py-6 sm:px-6 sm:py-8"
      aria-labelledby="streamer-connect-heading"
    >
      <div className="mx-auto max-w-3xl">
        <h2 id="streamer-connect-heading" className="text-center text-lg font-semibold text-zinc-100 sm:text-xl">
          Set up TikTok + TikFinity
        </h2>
        <p className="mt-2 text-center text-sm text-zinc-400">
          {loggedIn ? (
            <>
              You&apos;re logged in. Open <strong className="text-rust-cyan">Profile</strong> for your Steam id and TikFinity
              links, then use <strong className="text-rust-cyan">Admin → Streamer interactions</strong> to copy webhook URLs
              into TikFinity Actions.
            </>
          ) : (
            <>
              Create an account or log in, add your Steam id on Profile, then wire TikFinity Trigger WebHooks to the URLs
              from Admin → Streamer interactions.
            </>
          )}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {loggedIn ? (
            <Link
              href="/profile"
              className="inline-flex items-center gap-2 rounded-lg bg-rust-cyan px-5 py-3 text-base font-medium text-rust-panel shadow-rust-glow transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-rust-cyan focus:ring-offset-2 focus:ring-offset-zinc-900"
              aria-label="Go to profile for TikFinity and streamer settings"
            >
              <span aria-hidden>🔗</span>
              Profile &amp; TikFinity
            </Link>
          ) : (
            <>
              <Link
                href="/login?from=/profile"
                className="inline-flex items-center gap-2 rounded-lg border-2 border-rust-cyan bg-transparent px-5 py-3 text-base font-medium text-rust-cyan transition-colors hover:bg-rust-cyan/10 focus:outline-none focus:ring-2 focus:ring-rust-cyan focus:ring-offset-2 focus:ring-offset-zinc-900"
              >
                Log in
              </Link>
              <Link
                href="/register?from=/profile"
                className="inline-flex items-center gap-2 rounded-lg bg-rust-cyan px-5 py-3 text-base font-medium text-rust-panel shadow-rust-glow transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-rust-cyan focus:ring-offset-2 focus:ring-offset-zinc-900"
              >
                Create account
              </Link>
            </>
          )}
          {loggedIn && (
            <Link
              href="/profile"
              className="inline-flex items-center rounded-lg border border-zinc-600 bg-zinc-800/80 px-5 py-3 text-base font-medium text-zinc-200 transition-colors hover:border-rust-cyan hover:text-rust-cyan"
            >
              My Profile
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
