const MODES = [
  {
    title: "Chaos Mode",
    description: "Audience controls everything.",
  },
  {
    title: "Competitive Mode",
    description: "Viewers vote between events.",
  },
  {
    title: "Survival Mode",
    description: "Rewards scale with stream activity.",
  },
];

export function ModeCards() {
  return (
    <section
      className="border-b border-rust-border bg-rust-surface/50 px-4 py-12 sm:px-6 sm:py-16"
      aria-labelledby="modes-heading"
    >
      <div className="mx-auto max-w-6xl">
        <h2
          id="modes-heading"
          className="text-center text-2xl font-bold text-zinc-100 sm:text-3xl"
        >
          Advanced Modes
        </h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {MODES.map(({ title, description }) => (
            <div
              key={title}
              className="rounded-lg border border-rust-border bg-rust-panel p-6 text-center"
            >
              <h3 className="text-lg font-semibold text-rust-cyan">{title}</h3>
              <p className="mt-2 text-sm text-zinc-400">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
