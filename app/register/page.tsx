"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/marketing/Logo";

function RegisterForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
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
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Registration failed");
        return;
      }
      router.push("/servers");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-xl">
        <div className="mb-6 flex justify-center">
          <Logo
            className="h-36 w-auto"
            width={720}
            height={144}
            fallbackClassName="text-3xl font-bold text-rust-cyan"
          />
        </div>
        <p className="mb-6 text-sm text-zinc-400">Create an account</p>
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
