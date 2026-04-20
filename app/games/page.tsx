import Link from "next/link";
import type { Metadata } from "next";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

export const metadata: Metadata = {
  title: "Games | RustMaxx",
  description:
    "Games RustMaxx is built for. Rust is live today; Minecraft, ARK, GTA, Red Dead Redemption, and more are on the roadmap.",
  openGraph: {
    title: "Games | RustMaxx",
    description: "Rust today — more survival and live games on the roadmap.",
  },
};

const COMING_SOON_GAMES = [
  { name: "Minecraft", blurb: "Java / Bedrock communities & modded stacks." },
  { name: "ARK: Survival Evolved", blurb: "Clusters, tribes, and live server drama." },
  { name: "Grand Theft Auto", blurb: "FiveM-style communities and roleplay servers." },
  { name: "Red Dead Redemption", blurb: "Frontier RP and persistent worlds." },
] as const;

export default function GamesPage() {
  return (
    <MarketingLayout>
      <div className="marketing-section-spotlight border-b-0">
        <div className="marketing-container-narrow">
          <h1 className="marketing-h1">Games</h1>
          <p className="marketing-lead mt-3 max-w-2xl">
            RustMaxx started with <strong className="font-semibold text-amber-200/95">Rust</strong> — server
            control, stream hooks, and community tools in one place. We&apos;re expanding the same ideas to
            other games you love. Here&apos;s what&apos;s live and what&apos;s next.
          </p>
        </div>
      </div>

      <div className="marketing-section border-t-0 pt-0">
        <div className="marketing-container">
          <section aria-labelledby="games-live-heading">
            <h2 id="games-live-heading" className="text-xl font-semibold text-zinc-100">
              Available now
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-400">
              Full product: RCON, streamer rewards, public listings, and everything you see across the site.
            </p>
            <div className="mt-8 max-w-xl">
              <div className="rounded-xl border border-orange-500/35 bg-gradient-to-br from-orange-950/40 to-zinc-950/80 p-6 shadow-rust-glow-subtle ring-1 ring-orange-400/20">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-amber-100">Rust</h3>
                    <p className="mt-1 text-sm text-zinc-400">
                      Facepunch&apos;s survival sandbox — our flagship. Admins, streamers, and fans in one loop.
                    </p>
                  </div>
                  <Link
                    href="/"
                    className="inline-flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-amber-200 via-orange-400 to-orange-600 px-6 py-3 text-center text-sm font-semibold text-rust-panel shadow-rust-glow transition-opacity hover:opacity-95 hover:shadow-rust-glow-lg"
                  >
                    Open Rust home
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-16" aria-labelledby="games-roadmap-heading">
            <h2 id="games-roadmap-heading" className="text-xl font-semibold text-zinc-100">
              More games to come
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-400">
              No dates yet — we&apos;ll announce each title when we&apos;re ready to ship real tooling, not just a
              landing page.
            </p>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2">
              {COMING_SOON_GAMES.map((g) => (
                <li
                  key={g.name}
                  className="rounded-xl border border-rust-border bg-rust-surface/60 px-5 py-4 opacity-90"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-zinc-200">{g.name}</h3>
                      <p className="mt-1 text-sm text-zinc-500">{g.blurb}</p>
                    </div>
                    <span className="shrink-0 rounded-md border border-zinc-600 bg-zinc-900/80 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Coming soon
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </MarketingLayout>
  );
}
