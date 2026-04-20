import Link from "next/link";
import type { Metadata } from "next";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

export const metadata: Metadata = {
  title: "Fans & superfans | RustMaxx",
  description:
    "What being a RustMaxx fan means: superfan access, streamer approvals, fan boards, and interacting with live Rust servers.",
};

export default function SuperfansMarketingPage() {
  return (
    <MarketingLayout>
      <div className="marketing-container px-4 py-14 sm:py-20">
        <header className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wider text-rust-cyan">For viewers</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl">
            Fans &amp; superfans on RustMaxx
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-zinc-400">
            RustMaxx connects people who watch streams with the Rust servers those streamers play on — when everyone opts
            in.
          </p>
        </header>

        <div className="mx-auto mt-14 max-w-3xl space-y-10">
          <section className="rounded-xl border border-rust-border bg-rust-surface/90 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-100">What being a fan means</h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Signing up as a fan tells us you&apos;re mainly here to follow streamers and communities — not to run a
              server yourself. You get access to fan-facing tools (like streamer discovery and superfan flows) instead of
              server admin dashboards.
            </p>
          </section>

          <section className="rounded-xl border border-rust-border bg-rust-surface/90 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-100">Superfan access</h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              A <strong className="text-zinc-300">superfan</strong> is a viewer who asked to engage more closely with a
              streamer&apos;s channel on RustMaxx — for example fan boards, rewards, or server-side hooks that streamers
              enable. The streamer still approves who gets access so your community stays healthy.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Complete any one-time viewer steps your server requires, then request access from the streamer&apos;s
              public profile. Once approved, you can use the interactions they&apos;ve turned on for their audience.
            </p>
          </section>

          <section className="rounded-xl border border-rust-border bg-rust-surface/90 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-100">Fan boards &amp; live hooks</h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              When a streamer and server owner set it up, approved fans can participate in channel-specific boards and
              live hooks (TikFinity, Twitch tools, etc.) that affect or celebrate what happens on the Rust server — always
              within cooldowns and rules the streamer chooses.
            </p>
          </section>

          <div className="flex flex-wrap justify-center gap-4 pt-4">
            <Link
              href="/register"
              className="rounded-xl bg-rust-cyan px-6 py-3 text-sm font-semibold text-rust-panel shadow-rust-glow hover:opacity-90"
            >
              Create an account
            </Link>
            <Link
              href="/login"
              className="rounded-xl border border-rust-border px-6 py-3 text-sm font-medium text-rust-cyan hover:border-rust-cyan/50"
            >
              Log in
            </Link>
            <Link
              href="/viewer/superfan"
              className="rounded-xl border border-rust-cyan/40 bg-zinc-900/80 px-6 py-3 text-sm font-medium text-rust-cyan hover:bg-zinc-800"
            >
              Open fan / superfan tools
            </Link>
          </div>
          <p className="text-center text-xs text-zinc-600">
            Fan tools require a logged-in account. You&apos;ll be asked to sign in if you aren&apos;t already.
          </p>

          <p className="text-center text-sm text-zinc-500">
            <Link href="/streamers" className="text-rust-cyan hover:underline">
              Browse streamers
            </Link>
            {" · "}
            <Link href="/server-list" className="text-rust-cyan hover:underline">
              Public server list
            </Link>
          </p>
        </div>
      </div>
    </MarketingLayout>
  );
}
