import Link from "next/link";

export function PillarHero() {
  return (
    <section
      className="relative border-b border-rust-border bg-rust-panel/50 px-4 py-16 sm:px-6 sm:py-24"
      aria-labelledby="streamer-hero-heading"
    >
      <div className="absolute inset-0 bg-grid-subtle opacity-50" aria-hidden />
      <div className="relative mx-auto max-w-4xl text-center">
        <h1
          id="streamer-hero-heading"
          className="text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl md:text-5xl"
        >
          Your Rust Stream. Now Controlled by Your Audience.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-400">
          Connect Twitch. Map viewer rewards. Trigger live in-game events. Protected by cooldowns
          and anti-abuse controls.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <Link
            href="/early-access"
            className="rounded-lg bg-rust-cyan px-5 py-3 text-base font-medium text-rust-panel shadow-rust-glow transition-opacity hover:opacity-90 hover:shadow-rust-glow-lg focus:outline-none focus:ring-2 focus:ring-rust-cyan focus:ring-offset-2 focus:ring-offset-rust-panel"
            aria-label="Connect your channel to RustMaxx"
          >
            Connect Your Channel
          </Link>
          <a
            href="#demo"
            className="rounded-lg border border-rust-border bg-rust-surface px-5 py-3 text-base font-medium text-zinc-200 transition-colors hover:border-rust-cyan hover:text-rust-cyan focus:outline-none focus:ring-2 focus:ring-rust-cyan focus:ring-offset-2 focus:ring-offset-rust-panel"
            aria-label="Scroll to live demo section"
          >
            See It In Action
          </a>
        </div>
      </div>
    </section>
  );
}
