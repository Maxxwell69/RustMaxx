import { MarketingLayout } from "@/components/marketing/MarketingLayout";

export const metadata = {
  title: "About | RustMaxx",
  description: "Mission and who RustMaxx is for: server admins, owners, streamers, and players.",
  openGraph: { title: "About | RustMaxx", description: "Mission and who it's for." },
};

export default function AboutPage() {
  return (
    <MarketingLayout>
      <div className="relative px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold text-zinc-100">About RustMaxx</h1>
          <p className="mt-4 text-zinc-400">
            RustMaxx is a command center for Rust servers. We built it because managing servers,
            stream rewards, and map intel usually means juggling multiple tools and logins. Our goal
            is one place: admin tools, viewer interaction, and live intel, with clear roles and an
            audit trail.
          </p>

          <section className="mt-10">
            <h2 className="text-xl font-semibold text-zinc-100">Who it&apos;s for</h2>
            <ul className="mt-4 space-y-3 text-zinc-300">
              <li>
                <strong className="text-zinc-100">Server owners & admins</strong> — Run RCON,
                presets, and scheduled commands without hopping between panels. See who did what,
                when.
              </li>
              <li>
                <strong className="text-zinc-100">Streamers</strong> — Connect Twitch (and later
                TikTok/Kick) to in-game rewards. Cooldowns and anti-abuse keep things fair.
              </li>
              <li>
                <strong className="text-zinc-100">Communities</strong> — Live map and event intel
                (with the optional plugin) so staff can stay on top of raids and hotspots.
              </li>
            </ul>
          </section>

          <section className="mt-10 rounded-lg border border-rust-border bg-rust-surface/50 p-6">
            <h2 className="text-lg font-semibold text-zinc-100">Disclaimer</h2>
            <p className="mt-2 text-sm text-zinc-400">
              RustMaxx is not affiliated with, endorsed by, or connected with Facepunch Studios or
              the official Rust game. &quot;Rust&quot; is a trademark of Facepunch Studios. We
              support Oxide/uMod and common hosting setups; we do not claim official endorsement by
              Oxide or uMod.
            </p>
          </section>
        </div>
      </div>
    </MarketingLayout>
  );
}
