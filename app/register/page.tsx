"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PirateMaxxCredit } from "@/components/layout/PirateMaxxCredit";
import { Logo } from "@/components/marketing/Logo";

function RegisterForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [interestedServerOwner, setInterestedServerOwner] = useState(false);
  const [interestedStreamer, setInterestedStreamer] = useState(false);
  const [interestedFan, setInterestedFan] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function togglePersona(
    key: "owner" | "streamer" | "fan",
    next: boolean
  ) {
    if (key === "owner") setInterestedServerOwner(next);
    if (key === "streamer") setInterestedStreamer(next);
    if (key === "fan") setInterestedFan(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!interestedServerOwner && !interestedStreamer && !interestedFan) {
      setError("Choose at least one: Server admin, Streamer, or Fan.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          display_name: displayName || undefined,
          interested_server_owner: interestedServerOwner,
          interested_streamer: interestedStreamer,
          interested_fan: interestedFan,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Registration failed");
        return;
      }
      // Land everyone on the dashboard first; persona blocks and profile link from there.
      router.push("/servers");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-[33.6rem] rounded-xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-xl">
        <div className="mb-6 flex justify-center">
          <Logo
            className="h-[16.2rem] w-auto"
            width={1080}
            height={216}
            fallbackClassName="text-5xl font-bold text-rust-cyan"
          />
        </div>
        <p className="mb-6 text-sm text-zinc-400">
          Create an account. Choose how you&apos;ll use RustMaxx — you can pick more than one (e.g. server admin +
          streamer).
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm text-zinc-400"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>
          <div>
            <label
              htmlFor="display_name"
              className="mb-1 block text-sm text-zinc-400"
            >
              Display name (optional)
            </label>
            <input
              id="display_name"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
              placeholder="Your name"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm text-zinc-400"
            >
              Password (min 8 characters)
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
              placeholder="Password"
              required
              minLength={8}
            />
          </div>
          <fieldset className="rounded-lg border border-zinc-700/80 bg-zinc-800/40 p-4">
            <legend className="px-1 text-xs font-medium text-zinc-500">I am signing up as…</legend>
            <p className="mt-1 text-xs text-zinc-600">Tap to select — combine roles if you need more than one area.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => togglePersona("owner", !interestedServerOwner)}
                className={`rounded-xl border-2 px-3 py-3 text-left transition-colors ${
                  interestedServerOwner
                    ? "border-orange-400 bg-orange-500/15 text-zinc-100 shadow-rust-glow-subtle"
                    : "border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                <span className="block text-sm font-semibold text-zinc-100">Server admin</span>
                <span className="mt-1 block text-xs leading-snug text-zinc-500">
                  Dashboard, RCON, and server hooks.
                </span>
              </button>
              <button
                type="button"
                onClick={() => togglePersona("streamer", !interestedStreamer)}
                className={`rounded-xl border-2 px-3 py-3 text-left transition-colors ${
                  interestedStreamer
                    ? "border-orange-400 bg-orange-500/15 text-zinc-100 shadow-rust-glow-subtle"
                    : "border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                <span className="block text-sm font-semibold text-zinc-100">Streamer</span>
                <span className="mt-1 block text-xs leading-snug text-zinc-500">
                  TikTok / TikFinity, Twitch tools, streamer application.
                </span>
              </button>
              <button
                type="button"
                onClick={() => togglePersona("fan", !interestedFan)}
                className={`rounded-xl border-2 px-3 py-3 text-left transition-colors sm:col-span-1 ${
                  interestedFan
                    ? "border-orange-400 bg-orange-500/15 text-zinc-100 shadow-rust-glow-subtle"
                    : "border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                <span className="block text-sm font-semibold text-zinc-100">Fan</span>
                <span className="mt-1 block text-xs leading-snug text-zinc-500">
                  Superfan &amp; viewer tools — request streamers per channel.
                </span>
              </button>
            </div>
          </fieldset>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-gradient-to-b from-amber-200 via-orange-400 to-orange-600 px-4 py-2 font-medium text-rust-panel shadow-rust-glow hover:shadow-rust-glow-lg disabled:opacity-50"
          >
            {loading ? "Creating account…" : "Sign up"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-zinc-500">
          Already have an account?{" "}
          <Link href="/login" className="text-rust-cyan hover:underline">
            Sign in
          </Link>
        </p>
        </div>
      </div>
      <footer className="border-t border-zinc-800/80 bg-zinc-950 py-5">
        <PirateMaxxCredit variant="compact" />
      </footer>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-zinc-500">
          Loading…
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}
