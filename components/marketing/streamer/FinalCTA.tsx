import Link from "next/link";

export function FinalCTA() {
  return (
    <section className="border-b border-rust-border bg-rust-surface/50 px-4 py-16 sm:px-6 sm:py-24" aria-labelledby="final-cta-heading">
      <div className="mx-auto max-w-2xl text-center">
        <h2 id="final-cta-heading" className="text-2xl font-bold text-zinc-100 sm:text-3xl">Let Your Community Play With You. Not Just Watch.</h2>
        <Link
          href="/early-access"
          className="mt-8 inline-block rounded-lg bg-rust-cyan px-6 py-3 text-base font-medium text-rust-panel shadow-rust-glow transition-opacity hover:opacity-90 hover:shadow-rust-glow-lg focus:outline-none focus:ring-2 focus:ring-rust-cyan focus:ring-offset-2 focus:ring-offset-rust-panel"
          aria-label="Start streaming with RustMaxx"
        >
          Start Streaming With RustMaxx
        </Link>
      </div>
    </section>
  );
}
