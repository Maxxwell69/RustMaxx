const ITEMS = [
  "Streamer authentication + entitlements",
  "TikFinity HTTPS webhooks → RustMaxx API",
  "Railway backend execution engine",
  "Oxide/uMod plugin integration",
  "Cooldowns, crew registry, audit logs",
];

export function TechStrip() {
  return (
    <section className="border-b border-rust-border bg-rust-panel px-4 py-8 sm:px-6" aria-label="Tech stack">
      <div className="mx-auto max-w-6xl">
        <ul className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm text-zinc-400">
          {ITEMS.map((item, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-rust-cyan" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
