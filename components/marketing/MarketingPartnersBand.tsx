import Image from "next/image";

const WORKS_WITH_LOGOS = [
  { src: "/marketing/partners/tikfinity.png", alt: "TikFinity" },
  { src: "/marketing/partners/tiktok.png", alt: "TikTok" },
  { src: "/marketing/partners/tikfinity-alt.png", alt: "TikFinity" },
] as const;

/** Partner logos for home + features: TikFinity / TikTok under “Works with”, Shockbyte under “Some Servers powered by”. */
export function MarketingPartnersBand() {
  return (
    <section className="marketing-section-muted" aria-label="Partners">
      <div className="marketing-container">
        <h2
          id="works-with-heading"
          className="text-center text-sm font-semibold uppercase tracking-wider text-zinc-400"
        >
          Works with
        </h2>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-8 sm:gap-10">
          {WORKS_WITH_LOGOS.map((logo) => (
            <div
              key={logo.src}
              className="relative h-36 w-36 shrink-0 overflow-hidden rounded-xl bg-white p-4 shadow-md ring-1 ring-zinc-900/15 sm:h-40 sm:w-40"
            >
              <Image
                src={logo.src}
                alt={logo.alt}
                fill
                className="object-contain object-center p-2"
                sizes="160px"
              />
            </div>
          ))}
        </div>

        <div className="mt-14 border-t border-rust-border/70 pt-14">
          <h2
            id="servers-powered-heading"
            className="text-center text-sm font-semibold uppercase tracking-wider text-zinc-400"
          >
            Some Servers powered by :
          </h2>
          <div className="mt-8 flex justify-center">
            <div className="relative h-36 w-36 overflow-hidden rounded-xl bg-zinc-950/60 p-4 ring-1 ring-rust-border sm:h-40 sm:w-40">
              <Image
                src="/marketing/partners/shockbyte.png"
                alt="Shockbyte"
                fill
                className="object-contain object-center p-1"
                sizes="160px"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
