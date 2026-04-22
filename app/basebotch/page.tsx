import Image from "next/image";
import Link from "next/link";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

export const metadata = {
  title: "BaseBotch | RustMaxx",
  description:
    "Rust Oxide plugin: friendly NPCs handle cooking, meds, and bench work at your base so your crew can stay in the fight.",
  openGraph: {
    title: "BaseBotch | RustMaxx",
    description:
      "Put NPCs to work at your base — cooking, crafting, meds, and more. A RustMaxx Oxide plugin.",
  },
};

export default function BaseBotchPage() {
  return (
    <MarketingLayout>
      <div className="marketing-container px-4 py-14 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="relative overflow-hidden rounded-2xl border border-rust-border bg-zinc-950 shadow-xl shadow-black/40 ring-1 ring-cyan-500/25">
            <div className="relative aspect-[1024/682] w-full">
              <Image
                src="/marketing/games/rust/hazmat-blue.png"
                alt="Rust survivor in blue hazmat — base production and crafting vibe"
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
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl">BaseBotch</h1>
          <p className="mt-4 text-lg leading-relaxed text-zinc-400">
            Assign friendly NPCs to keep your compound running. They can cover the chores that eat your wipe — cooking,
            medical crafting, and other bench workflows — while you roam, farm, and defend.
          </p>
        </header>

        <section className="mx-auto mt-16 max-w-2xl">
          <h2 className="text-xl font-semibold text-zinc-100">What you get</h2>
          <ul className="mt-6 space-y-3 text-sm leading-relaxed text-zinc-400">
            <li className="flex gap-3">
              <span className="text-rust-cyan">▸</span>
              <span>Hands-off production loops: meals, meds, and crafted essentials without parking at the workbench.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-rust-cyan">▸</span>
              <span>Built for squad play — your base keeps moving when the team is out on monuments or repelling visitors.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-rust-cyan">▸</span>
              <span>Oxide / uMod plugin maintained by RustMaxx for servers that want depth without admin babysitting.</span>
            </li>
          </ul>
        </section>

        <nav className="mx-auto mt-16 flex max-w-2xl flex-col gap-3 border-t border-zinc-800 pt-10 text-sm sm:flex-row sm:items-center sm:justify-between">
          <Link href="/plugins/basebotch" className="text-rust-cyan hover:underline">
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
