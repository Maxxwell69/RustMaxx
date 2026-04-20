"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PirateMaxxCredit } from "@/components/layout/PirateMaxxCredit";
import { Logo } from "@/components/marketing/Logo";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/servers";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }
      router.push(from);
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
        <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-xl">
        <div className="mb-6 flex justify-center">
          <Logo
            className="h-36 w-auto"
            width={720}
            height={144}
            fallbackClassName="text-3xl font-bold text-rust-cyan"
          />
        </div>
        <p className="mb-6 text-sm text-zinc-400">Sign in with your email</p>
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
              htmlFor="password"
              className="mb-1 block text-sm text-zinc-400"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-rust-cyan focus:outline-none focus:ring-1 focus:ring-rust-cyan"
              placeholder="Password"
              required
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-rust-cyan px-4 py-2 font-medium text-rust-panel shadow-rust-glow hover:shadow-rust-glow-lg disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-zinc-500">
          No account?{" "}
          <Link
            href="/register"
            className="text-rust-cyan hover:underline"
          >
            Sign up
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

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-zinc-500">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
