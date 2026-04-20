import Image from "next/image";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { MaxxInvaderCharacterCard } from "@/components/marketing/MaxxInvaderCharacterCard";
import {
  MAXXINVADER_MAIN_CHARACTERS,
  MAXXINVADER_SPECIAL_CHARACTERS,
} from "@/lib/maxxinvaders-characters";

export const metadata = {
  title: "MaxxInvaders | RustMaxx",
  description:
    "Tie your TikTok crew's names to WorkingNPCs on Rust: patrol, gather, fight, heal, loot — RustMaxx webhooks and optional MaxxInvaders HUD tasks.",
  openGraph: {
    title: "MaxxInvaders | RustMaxx",
    description:
      "Tie your TikTok crew's names to WorkingNPCs on Rust — webhooks and optional MaxxInvaders HUD tasks.",
  },
};

export default function MaxxInvadersPage() {
  return (
    <MarketingLayout>
      <div className="marketing-container px-4 py-14 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="relative overflow-hidden rounded-2xl border border-rust-border bg-zinc-950 shadow-xl shadow-black/40 ring-1 ring-orange-500/30">
            <div className="relative aspect-[1024/682] w-full">
              <Image
                src="/marketing/maxxinvaders/hero.png?v=20260420"
                alt="MaxxInvaders — viewer-named NPC crew, stream raid tags, and fiery battlefield art"
                fill
                priority
                className="object-cover object-center"
                sizes="(max-width: 1280px) 100vw, 896px"
              />
            </div>
          </div>
        </div>

        <header className="mx-auto mt-10 max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wider text-rust-cyan">Streamer NPCs</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl">
            MaxxInvaders
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-zinc-400">
            Tie your TikTok crew&apos;s names to full WorkingNPCs on your Rust server. These loyal hands patrol
            your waters, gather resources, fight enemies, patch you up, and drop loot along the way. All
            commanded through RustMaxx webhooks and powered by optional MaxxInvaders HUD tasks.
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
      </div>
    </MarketingLayout>
  );
}
