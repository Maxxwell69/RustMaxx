import Image from "next/image";
import Link from "next/link";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

export const metadata = {
  title: "MaxxRaiders | RustMaxx",
  description:
    "Rust Oxide plugin: chaos-linked NPCs that scout, pressure, and raid player bases — the map fights back.",
  openGraph: {
    title: "MaxxRaiders | RustMaxx",
    description:
      "When RustChaos-style systems are live, MaxxRaiders sends NPC raiders after your stronghold.",
  },
};

export default function MaxxRaidersPage() {
  return (
    <MarketingLayout>
      <div className="marketing-container px-4 py-14 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="relative overflow-hidden rounded-2xl border border-rust-border bg-zinc-950 shadow-xl shadow-black/40 ring-1 ring-red-500/25">
            <div className="relative aspect-[1024/682] w-full">
              <Image
                src="/marketing/games/rust/naval-update.png"
                alt="Rust naval and coastal raid atmosphere"
                fill
                priority
                className="object-cover object-center"
                sizes="(max-width: 1280px) 100vw, 896px"
              />
            </div>
          </div>
        </div>

        <header className="mx-auto mt-10 max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wider text-rust-cyan">RustMaxx plugin</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl">MaxxRaiders</h1>
          <p className="mt-4 text-lg leading-relaxed text-zinc-400">
            Hook into the RustChaos ecosystem and let hostile NPCs treat your base like a real objective. Scouts, pressure,
            and raid behavior erase the quiet wipe — if you want endgame tension without scheduling every online raid, this
            is the counterweight.
          </p>
        </header>

        <section className="mx-auto mt-16 max-w-2xl">
          <h2 className="text-xl font-semibold text-zinc-100">How it fits</h2>
          <ul className="mt-6 space-y-3 text-sm leading-relaxed text-zinc-400">
            <li className="flex gap-3">
              <span className="text-rust-cyan">▸</span>
              <span>Built to stack with RustChaos so &quot;the world is angry&quot; includes your compound, not just the road.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-rust-cyan">▸</span>
              <span>NPC-driven pressure — ideal for PvE-forward or hybrid servers that still want base stakes.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-rust-cyan">▸</span>
              <span>Shipped and supported as part of the RustMaxx plugin family.</span>
            </li>
          </ul>
        </section>

        <nav className="mx-auto mt-16 flex max-w-2xl flex-col gap-3 border-t border-zinc-800 pt-10 text-sm sm:flex-row sm:items-center sm:justify-between">
          <Link href="/plugins/maxxraiders" className="text-rust-cyan hover:underline">
            Directory overview →
          </Link>
          <Link href="/plugins" className="text-zinc-500 hover:text-zinc-300 hover:underline">
            ← All plugins
          </Link>
        </nav>
      </div>
    </MarketingLayout>
  );
}
