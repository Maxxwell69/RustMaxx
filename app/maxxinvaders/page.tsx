import Link from "next/link";

import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { MaxxInvaderCharacterCard } from "@/components/marketing/MaxxInvaderCharacterCard";
import {
  MAXXINVADER_MAIN_CHARACTERS,
  MAXXINVADER_SPECIAL_CHARACTERS,
  MAXXINVADERS_PLUGIN_DOC_HREF,
  MAXXINVADERS_PLUGIN_README_HREF,
} from "@/lib/maxxinvaders-characters";

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
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href={MAXXINVADERS_PLUGIN_DOC_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-rust-cyan px-5 py-2.5 text-sm font-semibold text-rust-panel shadow-rust-glow transition-opacity hover:opacity-95"
            >
              What the plugin does (full doc)
            </Link>
            <Link
              href={MAXXINVADERS_PLUGIN_README_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-zinc-600 px-5 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-rust-cyan/60 hover:text-zinc-100"
            >
              Plugin README & config
            </Link>
            <Link
              href="/streamer"
              className="rounded-lg border border-transparent px-5 py-2.5 text-sm font-medium text-rust-cyan underline-offset-4 hover:underline"
            >
              Streamer dashboard
            </Link>
          </div>
          <p className="mt-6 text-xs text-zinc-500">
            Links open the RustMaxx GitHub repo (install Oxide plugin, RoamingNPCs bridge, TikFinity
            URLs).
          </p>
        </header>

        <section className="mx-auto mt-20 max-w-6xl">
          <h2 className="text-center text-2xl font-semibold text-zinc-100">Main characters</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-zinc-400">
            Core Roaming templates for everyday streams—each box is ready for your artwork. Match the
            template key in TikFinity (<code className="rounded bg-zinc-800 px-1 text-zinc-300">template=…</code>
            ).
          </p>
          <div className="mt-10 grid justify-items-center gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {MAXXINVADER_MAIN_CHARACTERS.map((c) => (
              <MaxxInvaderCharacterCard key={c.slug} character={c} />
            ))}
          </div>
        </section>

        <section className="mx-auto mt-24 max-w-6xl">
          <h2 className="text-center text-2xl font-semibold text-zinc-100">Special event characters</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-zinc-400">
            Outfit presets and themed Roaming templates—great for seasons, raids, or meme redeploys.
          </p>
          <div className="mt-10 grid justify-items-center gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {MAXXINVADER_SPECIAL_CHARACTERS.map((c) => (
              <MaxxInvaderCharacterCard key={c.slug} character={c} />
            ))}
          </div>
        </section>

        <footer className="mx-auto mt-20 max-w-3xl rounded-xl border border-rust-border bg-rust-surface/40 p-6 text-center">
          <p className="text-sm text-zinc-400">
            Need server-side setup? Install <strong className="text-zinc-200">MaxxInvaders</strong> and{" "}
            <strong className="text-zinc-200">RoamingNPCs</strong> on your host, then connect TikFinity
            webhooks from your RustMaxx streamer profile.
          </p>
          <Link
            href="/features"
            className="mt-4 inline-block text-sm font-medium text-rust-cyan hover:underline"
          >
            Platform features overview
          </Link>
        </footer>
      </div>
    </MarketingLayout>
  );
}
