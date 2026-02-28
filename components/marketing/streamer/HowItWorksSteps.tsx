const STEPS = [
  { step: 1, title: "Link Your Stream", description: "Secure OAuth connection to Twitch (TikTok & Kick planned)." },
  { step: 2, title: "Map Rewards", description: "Choose what happens for bits, channel points, subs, and custom triggers." },
  { step: 3, title: "Watch It Trigger Live", description: "RustMaxx executes on the server instantly and logs everything." },
];

export function HowItWorksSteps() {
  return (
    <section className="border-b border-rust-border bg-rust-surface/50 px-4 py-12 sm:px-6 sm:py-16" aria-labelledby="how-it-works-heading">
      <div className="mx-auto max-w-6xl">
        <h2 id="how-it-works-heading" className="text-center text-2xl font-bold text-zinc-100 sm:text-3xl">How It Works</h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          {STEPS.map((item) => (
            <div key={item.step} className="rounded-lg border border-rust-border bg-rust-panel p-6">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded border border-rust-cyan bg-rust-cyan/10 font-mono text-lg font-bold text-rust-cyan" aria-hidden>{item.step}</span>
              <h3 className="mt-4 text-lg font-semibold text-zinc-100">{item.title}</h3>
              <p className="mt-2 text-sm text-zinc-400">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
