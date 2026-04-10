const FEATURES = [
  {
    title: "TikFinity → Rust pipeline",
    bullets: [
      "HTTPS webhooks from TikFinity Trigger WebHook to RustMaxx",
      "Gift names, goals, and custom connection events → mapped actions",
      "TikTok viewer fields (nickname, userId) for NPC labels and crew checks",
      "Per-action URLs and Admin connection tables",
      "RCON / uMod execution on the target server",
    ],
  },
  { title: "Smart Cooldown Control", bullets: ["Global cooldowns", "Per-user limits", "Per-reward timers", "Max triggers per minute", "Emergency pause"] },
  { title: "Anti-Abuse Protection", bullets: ["Rate limiting", "Reward caps", "Permission-based actions", "Admin overrides", "Full audit logging"] },
  { title: "Dynamic Event Actions", bullets: ["Give items", "Spawn supply drops", "Spawn animals/NPCs", "Spawn minicopters", "Start raid events", "Server announcements", "Run custom console commands"] },
  {
    title: "Stream analytics",
    bullets: [
      "Event history log",
      "Viewer-tied trigger history",
      "Reward usage tracking",
      "Engagement metrics",
      "Gift / goal mapping visibility",
    ],
  },
  { title: "Multi-Server Support", bullets: ["One streamer → multiple servers", "Server-specific TikFinity maps", "Network-wide broadcasts"] },
];

export function FeatureCardGrid() {
  return (
    <section className="border-b border-rust-border bg-rust-panel/50 px-4 py-12 sm:px-6 sm:py-16" aria-labelledby="features-heading">
      <div className="mx-auto max-w-6xl">
        <h2 id="features-heading" className="text-center text-2xl font-bold text-zinc-100 sm:text-3xl">Feature Grid</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ title, bullets }) => (
            <div key={title} className="rounded-lg border border-rust-border bg-rust-surface p-5 transition-colors hover:border-rust-cyan/50">
              <h3 className="font-semibold text-zinc-100">{title}</h3>
              <ul className="mt-3 space-y-2">
                {bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-zinc-400">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rust-cyan" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
