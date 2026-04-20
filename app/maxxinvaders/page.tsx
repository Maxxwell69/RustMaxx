import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { MaxxInvaderCharacterCard } from "@/components/marketing/MaxxInvaderCharacterCard";
import {
  MAXXINVADER_MAIN_CHARACTERS,
  MAXXINVADER_SPECIAL_CHARACTERS,
} from "@/lib/maxxinvaders-characters";

/** Chat commands viewers use to spawn MaxxInvaders bots (configure on your stream / relay). */
const MAXXINVADER_CHAT_COMMANDS = [
  "!miner",
  "!snipemb",
  "!medic",
  "!jack",
  "!gingy",
  "!vamp",
  "!eggman",
  "!bunny",
] as const;

export const metadata = {
  title: "MaxxInvaders | RustMaxx",
  description:
    "Viewer-named Rust NPCs for TikFinity / webhooks: patrol, miner, medic, lumberjack, and seasonal outfits.",
  openGraph: {
    title: "MaxxInvaders | RustMaxx",
    description: "Streamer bots and seasonal characters for Rust + TikFinity.",
  },
};

export default function MaxxInvadersPage() {
  return (
    <MarketingLayout>
      <div className="marketing-container px-4 py-14 sm:py-20">
        <header className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wider text-rust-cyan">Streamer NPCs</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl">
            MaxxInvaders
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-zinc-400">
            Tie TikTok viewer names to full Roaming NPC bots on your Rust server: patrol around your
            anchor, gather, fight, heal, and drop loot—controlled from RustMaxx webhooks and optional
            MaxxInvaders HUD tasks.
          </p>
        </header>

        <section className="mx-auto mt-20 max-w-6xl">
          <h2 className="text-center text-2xl font-semibold text-zinc-100">Main characters</h2>
          <div className="mt-10 grid justify-items-center gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {MAXXINVADER_MAIN_CHARACTERS.map((c) => (
              <MaxxInvaderCharacterCard key={c.slug} character={c} />
            ))}
          </div>
        </section>

        <section className="mx-auto mt-24 max-w-6xl">
          <h2 className="text-center text-2xl font-semibold text-zinc-100">Special event characters</h2>
          <div className="mt-10 grid justify-items-center gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {MAXXINVADER_SPECIAL_CHARACTERS.map((c) => (
              <MaxxInvaderCharacterCard key={c.slug} character={c} />
            ))}
          </div>
        </section>

        <section className="mx-auto mt-20 max-w-3xl text-center">
          <h2 className="text-lg font-semibold text-zinc-200">In chat</h2>
          <p className="mt-2 text-sm text-zinc-500">Type:</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {MAXXINVADER_CHAT_COMMANDS.map((cmd) => (
              <code
                key={cmd}
                className="rounded-lg border border-zinc-700 bg-zinc-900/90 px-3 py-2 font-mono text-sm text-rust-cyan"
              >
                {cmd}
              </code>
            ))}
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}
