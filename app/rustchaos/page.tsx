import Image from "next/image";
import Link from "next/link";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

export const metadata = {
  title: "RustChaos | RustMaxx",
  description:
    "Rust Oxide plugin: layered chaos, survival pressure, and stream-ready moments — pairs with RustMaxx gifts and webhooks.",
  openGraph: {
    title: "RustChaos | RustMaxx",
    description:
      "Controlled mayhem on your Rust server. Residents, events, and tension built for creators and crews.",
  },
};

export default function RustChaosPage() {
  return (
    <MarketingLayout>
      <div className="marketing-container px-4 py-14 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="relative overflow-hidden rounded-2xl border border-rust-border bg-zinc-950 shadow-xl shadow-black/40 ring-1 ring-orange-500/35">
            <div className="relative aspect-[1024/682] w-full">
              <Image
                src="/marketing/games/rust/hazmat-orange-ak.png"
                alt="Rust combat — hazmat and rifle, chaotic server energy"
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
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl">RustChaos</h1>
          <p className="mt-4 text-lg leading-relaxed text-zinc-400">
            Turn the map into a living pressure cooker. RustChaos throws weight behind survival fantasy: the world pushes
            back, residents get dangerous, and memorable fights find you — especially when your stack ties in TikFinity and
            streamer rules.
          </p>
        </header>

        <section className="mx-auto mt-16 max-w-2xl">
          <h2 className="text-xl font-semibold text-zinc-100">Why servers run it</h2>
          <ul className="mt-6 space-y-3 text-sm leading-relaxed text-zinc-400">
            <li className="flex gap-3">
              <span className="text-rust-cyan">▸</span>
              <span>Mayhem with intent — spectacle your chat can feel, not random noise.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-rust-cyan">▸</span>
              <span>Designed to complement RustMaxx streamer actions and server-side chaos triggers.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-rust-cyan">▸</span>
              <span>Same Oxide stack you already trust; RustMaxx builds and ships updates alongside our other plugins.</span>
            </li>
          </ul>
        </section>

        <nav className="mx-auto mt-16 flex max-w-2xl flex-col gap-3 border-t border-zinc-800 pt-10 text-sm sm:flex-row sm:items-center sm:justify-between">
          <Link href="/plugins/rustchaos" className="text-rust-cyan hover:underline">
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
