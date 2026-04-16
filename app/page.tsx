import Link from "next/link";
import type { Metadata } from "next";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { TerminalCard } from "@/components/marketing/TerminalCard";
import { LiveConsole } from "@/components/marketing/LiveConsole";
import { DashboardFrame } from "@/components/marketing/placeholders/DashboardFrame";

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

function HeroSection() {
  return (
    <section className="border-b border-rust-border bg-rust-panel/50 px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-center text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl md:text-5xl">
          Built for server admins, streamers, and fans
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-zinc-400">
          Admins invite streamers. Streamers invite viewers. RustMaxx connects the chain — so your server, your channel,
          and your community can grow together.
        </p>
        <div className="mt-10 flex justify-center">
          <AudienceTabs />
        </div>
        <div className="mt-12 grid gap-8 lg:grid-cols-2">
          <TerminalCard title="rcon — live">
            <LiveConsole />
          </TerminalCard>
          <div className="rounded-lg border border-rust-border bg-rust-surface overflow-hidden">
            <HeroScreenshotPlaceholder />
          </div>
        </div>
      </div>
    </section>
  );
}

function AudienceTabs() {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <Link
        href="/#server-admins"
        className="rounded-lg border border-rust-border bg-rust-surface px-4 py-3 text-left transition-colors hover:border-rust-cyan"
      >
        <span className="block font-medium text-zinc-200">Server admins</span>
        <span className="block text-xs text-zinc-500">Invite streamers · RCON &amp; control</span>
      </Link>
      <Link
        href="/#streamers"
        className="rounded-lg border border-rust-border bg-rust-surface px-4 py-3 text-left transition-colors hover:border-rust-cyan"
      >
        <span className="block font-medium text-zinc-200">Streamers</span>
        <span className="block text-xs text-zinc-500">Invite viewers · TikFinity &amp; hooks</span>
      </Link>
      <Link
        href="/#fans"
        className="rounded-lg border border-rust-border bg-rust-surface px-4 py-3 text-left transition-colors hover:border-rust-cyan"
      >
        <span className="block font-medium text-zinc-200">Fans</span>
        <span className="block text-xs text-zinc-500">Follow streamers · superfan access</span>
      </Link>
    </div>
  );
}

function HeroScreenshotPlaceholder() {
  return (
    <div
      className="relative min-h-[280px] sm:min-h-[320px] rounded-lg border border-rust-border overflow-hidden bg-rust-surface"
      aria-label="Dashboard preview placeholder"
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4">
        <DashboardFrame className="h-auto w-full max-h-[200px] sm:max-h-[240px] flex-shrink-0" />
        <p className="text-center text-sm text-zinc-500 font-medium">
          Dashboard preview — sign in to use the full command center
        </p>
      </div>
      <div className="absolute bottom-2 right-2 rounded bg-rust-panel/90 px-2 py-1 font-mono text-xs text-zinc-500">
        Preview
      </div>
    </div>
  );
}

function TrustStrip() {
  return (
    <section className="border-b border-rust-border bg-rust-surface/50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <p className="text-center text-sm text-zinc-400">
          Works with <strong className="text-zinc-300">Oxide / uMod</strong> and common hosts. No
          inbound ports required—connect outbound via WebRCON. Use at your own discretion; we do not
          claim official endorsement.
        </p>
      </div>
    </section>
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
    },
  ];

  return (
    <section className="px-4 py-16 sm:px-6 sm:py-24" id="audiences">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-center text-2xl font-bold text-zinc-100 sm:text-3xl">
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
              className="rounded-lg border border-rust-border bg-rust-surface p-6"
            >
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
    <section className="border-t border-rust-border px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-6xl">
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
    <section className="border-t border-rust-border bg-rust-panel/50 px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-center text-2xl font-bold text-zinc-100">What the community is saying</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <blockquote
              key={i}
              className="rounded-lg border border-rust-border bg-rust-surface p-5 text-sm text-zinc-400"
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
    <section className="border-t border-rust-border px-4 py-16 sm:px-6 sm:py-24">
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
            className="rounded-lg bg-rust-cyan px-6 py-3 font-medium text-rust-panel shadow-rust-glow hover:opacity-90 hover:shadow-rust-glow-lg"
          >
            Get started
          </Link>
          <Link
            href="/contact"
            className="rounded-lg border border-rust-cyan/50 bg-rust-surface px-6 py-3 font-medium text-rust-cyan hover:border-rust-cyan hover:shadow-rust-glow-subtle"
          >
            Contact us
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <MarketingLayout>
      <HeroSection />
      <TrustStrip />
      <AudiencesSection />
      <IntegrationsRow />
      <TestimonialsSection />
      <CTASection />
    </MarketingLayout>
  );
}
