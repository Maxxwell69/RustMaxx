import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

export const metadata: Metadata = {
  title: "Become a Superfan | RustMaxx",
  description:
    "Level up from watching to impacting the stream—TikTok or Twitch subscribers get interactive RustMaxx controls when streamers approve you.",
};

export default function SuperfansMarketingPage() {
  return (
    <MarketingLayout>
      <div className="marketing-container px-4 py-10 sm:py-14">
        <div className="mx-auto max-w-4xl">
          <div className="overflow-hidden rounded-2xl border border-rust-border bg-zinc-950 shadow-lg shadow-black/40 ring-1 ring-white/5">
            <div className="relative aspect-[21/9] w-full min-h-[200px] sm:aspect-[2/1] md:min-h-[280px]">
              <Image
                src="/marketing/superfans/hero.png"
                alt="Become a Superfan — trigger in-game events, help or hinder the streamer, fan rewards, chaos access"
                fill
                className="object-contain object-center"
                sizes="(max-width: 896px) 100vw, 896px"
                priority
              />
            </div>
          </div>

          <header className="mx-auto mt-12 max-w-3xl text-center">
            <p className="text-sm font-medium uppercase tracking-wider text-rust-cyan">For viewers</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl">
              Become a Superfan on RustMaxx
            </h1>
          </header>

          <div className="mx-auto mt-12 max-w-3xl space-y-12">
            <section className="rounded-xl border border-rust-border bg-rust-surface/90 p-6 shadow-sm sm:p-8">
              <h2 className="text-xl font-semibold text-zinc-100">
                <span className="mr-2" aria-hidden>
                  💥
                </span>
                What is a Superfan?
              </h2>
              <p className="mt-4 text-base leading-relaxed text-zinc-300">
                A Superfan is a viewer who levels up from watching… to impacting the stream in real-time.
              </p>
              <p className="mt-4 text-base leading-relaxed text-zinc-400">
                By subscribing on TikTok or Twitch and getting approved by the streamer, you unlock interactive controls
                inside RustMaxx—giving you the power to help, support, or unleash chaos during live gameplay.
              </p>
            </section>

            <section className="rounded-xl border border-rust-border bg-rust-surface/90 p-6 shadow-sm sm:p-8">
              <h2 className="text-xl font-semibold text-zinc-100">
                <span className="mr-2" aria-hidden>
                  ⚔️
                </span>
                What You Get as a Superfan
              </h2>
              <p className="mt-4 text-base leading-relaxed text-zinc-400">
                Once approved, you gain access to exclusive interaction boards built by the streamer:
              </p>
              <ul className="mt-5 space-y-3 text-base leading-relaxed text-zinc-300">
                <li className="flex gap-3">
                  <span className="shrink-0" aria-hidden>
                    🎮
                  </span>
                  <span>Trigger in-game events during live streams</span>
                </li>
                <li className="flex gap-3">
                  <span className="shrink-0" aria-hidden>
                    ❤️
                  </span>
                  <span>Help the streamer with heals, boosts, and support</span>
                </li>
                <li className="flex gap-3">
                  <span className="shrink-0" aria-hidden>
                    😈
                  </span>
                  <span>Hinder the streamer with chaos, enemies, or surprises</span>
                </li>
                <li className="flex gap-3">
                  <span className="shrink-0" aria-hidden>
                    🎁
                  </span>
                  <span>Access custom rewards and fan-only actions</span>
                </li>
                <li className="flex gap-3">
                  <span className="shrink-0" aria-hidden>
                    📊
                  </span>
                  <span>Appear on fan boards, leaderboards, and shoutouts</span>
                </li>
              </ul>
              <p className="mt-6 rounded-lg border border-rust-cyan/20 bg-rust-cyan/5 px-4 py-3 text-center text-base font-medium text-rust-cyan">
                <span className="mr-2" aria-hidden>
                  👉
                </span>
                This is not just watching… this is playing along with the stream
              </p>
            </section>

            <section className="rounded-xl border border-rust-border bg-rust-surface/90 p-6 shadow-sm sm:p-8">
              <h2 className="text-xl font-semibold text-zinc-100">
                <span className="mr-2" aria-hidden>
                  🔓
                </span>
                How to Become a Superfan
              </h2>
              <ol className="mt-5 list-decimal space-y-3 pl-5 text-base leading-relaxed text-zinc-300 marker:text-rust-cyan">
                <li>Subscribe to the streamer (TikTok or Twitch)</li>
                <li>Complete any quick server steps (if required)</li>
                <li>Request Superfan access from their profile</li>
                <li>Get approved and unlock your powers</li>
              </ol>
            </section>

            <section className="rounded-xl border border-rust-border bg-rust-surface/90 p-6 shadow-sm sm:p-8">
              <h2 className="text-xl font-semibold text-zinc-100">
                <span className="mr-2" aria-hidden>
                  🧠
                </span>
                Why It Matters
              </h2>
              <p className="mt-4 text-base leading-relaxed text-zinc-400">
                Streamers keep control by approving access—so the community stays fun, fair, and not toxic.
              </p>
              <ul className="mt-5 space-y-2 text-base leading-relaxed text-zinc-300">
                <li>Fans get deeper engagement.</li>
                <li>Streamers get stronger communities.</li>
                <li>Servers get more activity.</li>
              </ul>
              <p className="mt-6 text-center text-lg font-semibold text-zinc-200">
                <span className="mr-2 text-rust-cyan" aria-hidden>
                  👉
                </span>
                Everyone wins.
              </p>
            </section>

            <div className="flex flex-wrap justify-center gap-4 pt-2">
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
      </div>
    </MarketingLayout>
  );
}
