export function PlatformBadges() {
  return (
    <section className="border-b border-rust-border bg-rust-panel/50 px-4 py-12 sm:px-6 sm:py-16" aria-labelledby="platforms-heading">
      <div className="mx-auto max-w-6xl">
        <h2 id="platforms-heading" className="text-center text-2xl font-bold text-zinc-100 sm:text-3xl">
          Supported Platforms
        </h2>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <span className="rounded-lg border border-rust-green bg-rust-green/10 px-4 py-2 text-sm font-medium text-rust-green">
            Twitch (EventSub)
          </span>
          <span className="rounded-lg border border-rust-border bg-rust-surface px-4 py-2 text-sm font-medium text-zinc-500">
            TikTok Live (planned)
          </span>
          <span className="rounded-lg border border-rust-border bg-rust-surface px-4 py-2 text-sm font-medium text-zinc-500">
            Kick (planned)
          </span>
          <span className="rounded-lg border border-rust-border bg-rust-surface px-4 py-2 text-sm font-medium text-zinc-500">
            Discord triggers (planned)
          </span>
          <span className="rounded-lg border border-rust-border bg-rust-surface px-4 py-2 text-sm font-medium text-zinc-500">
            Public API (planned)
          </span>
        </div>
        <p className="mt-4 text-center text-xs text-zinc-500">
          Planned features are subject to roadmap.
        </p>
      </div>
    </section>
  );
}
