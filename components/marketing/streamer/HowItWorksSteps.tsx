const STEPS = [
  {
    step: 1,
    title: "Account + Steam",
    description:
      "Log in to RustMaxx and set your Steam64 on Profile so patrol anchors and in-game actions resolve to you.",
  },
  {
    step: 2,
    title: "Map TikFinity → server",
    description:
      "In Admin → Streamer interactions, copy webhook URLs and connection rules. In TikFinity, add Actions (Trigger WebHook) that POST to those URLs.",
  },
  {
    step: 3,
    title: "Go live on TikTok",
    description:
      "When gifts or goals fire, TikFinity hits RustMaxx; RCON/plugin runs the mapped action and the run is logged.",
  },
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
