const STORIES = [
  {
    scenario: 1,
    text: "Viewer donates 500 bits → 3 wolves spawn near streamer → chat explodes → clip goes viral.",
  },
  {
    scenario: 2,
    text: "Chat redeems 10,000 points → helicopter event starts → streamer forced into combat.",
  },
];

export function UseCaseStories() {
  return (
    <section
      className="border-b border-rust-border bg-rust-panel/50 px-4 py-12 sm:px-6 sm:py-16"
      aria-labelledby="use-cases-heading"
    >
      <div className="mx-auto max-w-6xl">
        <h2
          id="use-cases-heading"
          className="text-center text-2xl font-bold text-zinc-100 sm:text-3xl"
        >
          Use Cases
        </h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {STORIES.map(({ scenario, text }) => (
            <div
              key={scenario}
              className="rounded-lg border border-rust-border bg-rust-surface p-6"
            >
              <span className="text-xs font-medium uppercase tracking-wider text-rust-amber">
                Scenario {scenario}
              </span>
              <p className="mt-2 text-zinc-300">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
