import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { MarketingPartnersBand } from "@/components/marketing/MarketingPartnersBand";

export const metadata: Metadata = {
  title: "RustMaxx – For server admins, streamers & fans",
  description:
    "Server admins invite streamers. Streamers invite viewers. One place to run Rust servers, power live interactions, and grow your community.",
  openGraph: {
    title: "RustMaxx – For server admins, streamers & fans",
    description:
      "Invite streamers, invite viewers, and grow — RCON, TikFinity hooks, and superfan tools in one command center.",
  },
};

const HOME_HERO_BANNERS: { src: string; alt: string }[] = [
  {
    src: "/marketing/hero/server-admins.png",
    alt:
      "RustMaxx for server owners — level up your Rust server: boost player count, customize events, earn more",
  },
  {
    src: "/marketing/hero/streamers.png",
    alt:
      "RustMaxx for streamers — level up your stream with interactive gifts, engagement, and income",
  },
  {
    src: "/marketing/hero/fans.png",
    alt: "RustMaxx for fans — send gifts, control the game, watch mayhem",
  },
];

function HeroBannerStrip() {
  return (
    <div className="mt-12 grid gap-4 sm:gap-6 md:grid-cols-3">
      {HOME_HERO_BANNERS.map((banner, i) => (
        <div
          key={banner.src}
          className="overflow-hidden rounded-xl border border-rust-border bg-zinc-950 shadow-lg shadow-black/30 ring-1 ring-white/5"
        >
          {/* object-contain shows full artwork; object-cover + a short aspect box cropped top/bottom */}
          <div className="relative aspect-video w-full">
            <Image
              src={banner.src}
              alt={banner.alt}
              fill
              className="object-contain object-center"
              sizes="(max-width: 768px) 100vw, 33vw"
              priority={i === 0}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function HeroSection() {
  return (
    <section className="marketing-section-spotlight">
      <div className="marketing-container">
        <h1 className="marketing-h1 text-center">
          Built for server admins, streamers, and fans
        </h1>
        <p className="marketing-lead mx-auto mt-5 max-w-2xl text-center">
          Admins invite streamers. Streamers invite viewers. RustMaxx connects the chain — so your server, your channel,
          and your community can grow together.
        </p>
        <div className="mt-10 flex justify-center">
          <AudienceTabs />
        </div>
        <HeroBannerStrip />
      </div>
    </section>
  );
}

function AudienceTabs() {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <Link
        href="/#server-admins"
        className="rounded-xl border border-rust-border bg-rust-surface/90 px-4 py-3 text-left shadow-sm transition-all hover:border-rust-cyan/50 hover:shadow-rust-glow-subtle"
      >
        <span className="block font-medium text-zinc-200">Server admins</span>
        <span className="block text-xs text-zinc-500">Invite streamers · RCON &amp; control</span>
      </Link>
      <Link
        href="/#streamers"
        className="rounded-xl border border-rust-border bg-rust-surface/90 px-4 py-3 text-left shadow-sm transition-all hover:border-rust-cyan/50 hover:shadow-rust-glow-subtle"
      >
        <span className="block font-medium text-zinc-200">Streamers</span>
        <span className="block text-xs text-zinc-500">Invite viewers · TikFinity &amp; hooks</span>
      </Link>
      <Link
        href="/#fans"
        className="rounded-xl border border-rust-border bg-rust-surface/90 px-4 py-3 text-left shadow-sm transition-all hover:border-rust-cyan/50 hover:shadow-rust-glow-subtle"
      >
        <span className="block font-medium text-zinc-200">Fans</span>
        <span className="block text-xs text-zinc-500">Follow streamers · superfan access</span>
      </Link>
    </div>
  );
}

function AudiencesSection() {
  const blocks: {
    id: string;
    title: string;
    tagline: string;
    benefits: string[];
    href: string;
    cta: string;
    imageSrc: string;
    imageAlt: string;
  }[] = [
    {
      id: "server-admins",
      title: "Server admins",
      tagline: "Bring streamers onto your server and give them the tools to shine.",
      benefits: [
        "Invite streamers to link their channel and use TikFinity / webhooks on your Rust server",
        "Live RCON, roles, audit — one dashboard instead of scattered tools",
        "Help the server grow when streamers bring their audience in-game",
      ],
      href: "/features#admin",
      cta: "Admin & server features →",
      imageSrc: "/marketing/audiences/server-admins.png",
      imageAlt: "Rust server admins at the controls",
    },
    {
      id: "streamers",
      title: "Streamers",
      tagline: "Invite viewers in and turn watch-time into moments on the server.",
      benefits: [
        "Connect TikFinity, Twitch, and rewards with clear cooldowns and anti-abuse",
        "Invite fans to request superfan access — you approve who interacts",
        "Grow your channel while admins help you plug into the right Rust stack",
      ],
      href: "/streamer-interaction",
      cta: "Streamer interaction →",
      imageSrc: "/marketing/audiences/streamers.png",
      imageAlt: "Streamer live with RustMaxx",
    },
    {
      id: "fans",
      title: "Fans of streamers",
      tagline: "Get closer to the channels you love — when the streamer says yes.",
      benefits: [
        "Find streamers in the directory and request superfan access per channel",
        "Interact with live hooks when you are approved — built for viewers, not noise",
        "Support streamers and servers as the community grows together",
      ],
      href: "/streamers",
      cta: "Browse streamers →",
      imageSrc: "/marketing/audiences/fans.png",
      imageAlt: "Fans cheering and engaging with live streams",
    },
  ];

  return (
    <section className="marketing-section-muted" id="audiences">
      <div className="marketing-container">
        <h2 className="text-center text-2xl font-bold text-zinc-100 sm:text-3xl md:text-4xl">
          Three audiences. One loop that helps everyone grow.
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-zinc-400">
          RustMaxx is the link between your server, your stream, and your viewers — invitations go both ways, and the
          product is built to scale engagement without losing control.
        </p>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {blocks.map((p) => (
            <div
              key={p.id}
              id={p.id}
              className="overflow-hidden rounded-xl border border-rust-border bg-rust-surface/90 shadow-lg shadow-black/15"
            >
              <div className="relative aspect-[3/4] max-h-[min(420px,55vh)] w-full border-b border-rust-border bg-zinc-950">
                <Image
                  src={p.imageSrc}
                  alt={p.imageAlt}
                  fill
                  className="object-contain object-center"
                  sizes="(max-width: 768px) 100vw, 33vw"
                />
              </div>
              <div className="p-6 pt-5">
                <h3 className="font-semibold text-zinc-100">{p.title}</h3>
                <p className="mt-1 text-sm text-zinc-400">{p.tagline}</p>
                <ul className="mt-4 space-y-2">
                  {p.benefits.map((b, i) => (
                    <li key={i} className="flex gap-2 text-sm text-zinc-400">
                      <span className="text-rust-cyan">›</span> {b}
                    </li>
                  ))}
                </ul>
                <Link
                  href={p.href}
                  className="mt-4 inline-block text-sm font-medium text-rust-cyan hover:underline"
                >
                  {p.cta}
                </Link>
              </div>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-zinc-500">
          Map intel, heatmaps, and deeper analytics stay on the roadmap — the core story is admins ↔ streamers ↔ fans,
          growing together.
        </p>
      </div>
    </section>
  );
}

function IntegrationsRow() {
  const items = ["Discord", "Oxide / uMod", "Carbon", "WebRCON"];
  return (
    <section className="border-b border-rust-border py-12 sm:py-14">
      <div className="marketing-container">
        <p className="text-center text-xs uppercase tracking-wider text-zinc-500">
          Integrations
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          {items.map((name) => (
            <span
              key={name}
              className="rounded border border-rust-border bg-rust-surface px-4 py-2 font-mono text-sm text-zinc-400"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function TestimonialsSection() {
  return (
    <section className="marketing-section-muted">
      <div className="marketing-container">
        <h2 className="text-center text-2xl font-bold text-zinc-100">What the community is saying</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <blockquote
              key={i}
              className="rounded-xl border border-rust-border bg-rust-surface/80 p-5 text-sm text-zinc-400 shadow-sm"
            >
              <p>Placeholder testimonial {i}. Replace with real quotes when available.</p>
              <footer className="mt-3 text-xs text-zinc-500">— Placeholder</footer>
            </blockquote>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap justify-center gap-8 text-center">
          <div>
            <p className="text-2xl font-bold text-rust-cyan">500+</p>
            <p className="text-xs text-zinc-500">Placeholder metric</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-rust-cyan">99.9%</p>
            <p className="text-xs text-zinc-500">Placeholder metric</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-rust-cyan">24/7</p>
            <p className="text-xs text-zinc-500">Placeholder metric</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="marketing-section border-t-0">
      <div className="marketing-container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold text-zinc-100 sm:text-3xl">
            Grow your server, your stream, and your viewers
          </h2>
          <p className="mt-3 text-zinc-400">
            Join RustMaxx — whether you run the box, go live, or show up as a fan.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href="/register"
              className="rounded-xl bg-gradient-to-b from-amber-200 via-orange-400 to-orange-600 px-6 py-3 font-semibold text-rust-panel shadow-rust-glow hover:opacity-90 hover:shadow-rust-glow-lg"
            >
              Get started
            </Link>
            <Link
              href="/contact"
              className="rounded-xl border border-rust-cyan/50 bg-rust-surface px-6 py-3 font-medium text-rust-cyan hover:border-rust-cyan hover:shadow-rust-glow-subtle"
            >
              Contact us
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <MarketingLayout>
      <HeroSection />
      <AudiencesSection />
      <MarketingPartnersBand />
      <IntegrationsRow />
      <TestimonialsSection />
      <CTASection />
    </MarketingLayout>
  );
}
