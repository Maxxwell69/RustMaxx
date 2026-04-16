"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
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
      const goProfile = interestedServerOwner || interestedStreamer;
      const goFanOnly = interestedFan && !goProfile;
      router.push(goProfile ? "/profile" : goFanOnly ? "/viewer/superfan" : "/servers");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-xl">
        <div className="mb-6 flex justify-center">
          <Logo
            className="h-36 w-auto"
            width={720}
            height={144}
            fallbackClassName="text-3xl font-bold text-rust-cyan"
          />
        </div>
        <p className="mb-6 text-sm text-zinc-400">Create an account — tell us how you&apos;ll use RustMaxx (optional).</p>
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
          <fieldset className="rounded-lg border border-zinc-700/80 bg-zinc-800/40 p-3">
            <legend className="px-1 text-xs font-medium text-zinc-500">I am signing up as…</legend>
            <div className="mt-2 space-y-2">
              <label className="flex cursor-pointer items-start gap-3 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={interestedServerOwner}
                  onChange={(e) => setInterestedServerOwner(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-600 bg-zinc-800 text-rust-cyan focus:ring-rust-cyan"
                />
                <span>
                  <span className="font-medium text-zinc-200">Rust server owner</span>
                  <span className="mt-0.5 block text-xs text-zinc-500">
                    Add and manage servers, RCON, and stream hooks from the dashboard.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={interestedStreamer}
                  onChange={(e) => setInterestedStreamer(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-600 bg-zinc-800 text-rust-cyan focus:ring-rust-cyan"
                />
                <span>
                  <span className="font-medium text-zinc-200">Streamer</span>
                  <span className="mt-0.5 block text-xs text-zinc-500">
                    TikTok / TikFinity or Twitch tools — we&apos;ll highlight the streamer application on your profile.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={interestedFan}
                  onChange={(e) => setInterestedFan(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-600 bg-zinc-800 text-rust-cyan focus:ring-rust-cyan"
                />
                <span>
                  <span className="font-medium text-zinc-200">Fan / viewer</span>
                  <span className="mt-0.5 block text-xs text-zinc-500">
                    Superfan tools — connect with streamers you follow and interact when they approve you.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-rust-cyan px-4 py-2 font-medium text-rust-panel shadow-rust-glow hover:shadow-rust-glow-lg disabled:opacity-50"
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
        <p className="mt-3 text-center text-sm text-zinc-600">
          Already know you need streamer approval? You can still open the{" "}
          <Link href="/streamer/register" className="text-rust-cyan hover:underline">
            streamer application
          </Link>{" "}
          after you sign in.
        </p>
      </div>
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
