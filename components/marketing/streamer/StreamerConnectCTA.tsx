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
          Connect Twitch in 2 steps
        </h2>
        <p className="mt-2 text-center text-sm text-zinc-400">
          {loggedIn ? (
            <>You&apos;re logged in. Go to your Profile and click <strong className="text-rust-cyan">Connect Twitch</strong> to link your channel.</>
          ) : (
            <>Create an account or log in, then open your Profile and click <strong className="text-rust-cyan">Connect Twitch</strong>.</>
          )}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {loggedIn ? (
            <Link
              href="/profile"
              className="inline-flex items-center gap-2 rounded-lg bg-[#9146ff] px-5 py-3 text-base font-medium text-white shadow-lg transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#9146ff] focus:ring-offset-2 focus:ring-offset-zinc-900"
              aria-label="Go to profile to connect Twitch"
            >
              <span aria-hidden>🔗</span>
              Connect Twitch in Profile
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
