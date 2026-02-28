import Link from "next/link";
import type { Metadata } from "next";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

export const metadata: Metadata = {
  title: "RustMaxx – One command center for Rust servers",
  description:
    "Admin tools, streamer-viewer interaction, and live map intel for Rust. RCON, rewards, heatmaps. Works with Oxide/uMod.",
  openGraph: {
    title: "RustMaxx – One command center for Rust servers",
    description: "Admin tools, stream interaction, and live map intel for Rust servers.",
  },
};
import { TerminalCard } from "@/components/marketing/TerminalCard";
import { LiveConsole } from "@/components/marketing/LiveConsole";
import { DashboardFrame } from "@/components/marketing/placeholders/DashboardFrame";

function HeroSection() {
  return (
    <section className="border-b border-rust-border bg-rust-panel/50 px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-center text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl md:text-5xl">
          One command center for Rust servers
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-zinc-400">
          Admin tools, streamer–viewer interaction, and live map intel. Less juggling, more control.
        </p>
        <div className="mt-10 flex justify-center">
          <PillarTabsClient />
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

function PillarTabsClient() {
  // Server component can't use useState; use a client wrapper for tabs or keep static for hero
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <Link
        href="/#admin"
        className="rounded-lg border border-rust-border bg-rust-surface px-4 py-3 text-left transition-colors hover:border-rust-cyan"
      >
        <span className="block font-medium text-zinc-200">Admin Tools</span>
        <span className="block text-xs text-zinc-500">RCON, presets, roles, audit logs</span>
      </Link>
      <Link
        href="/#stream"
        className="rounded-lg border border-rust-border bg-rust-surface px-4 py-3 text-left transition-colors hover:border-rust-cyan"
      >
        <span className="block font-medium text-zinc-200">Stream Interaction</span>
        <span className="block text-xs text-zinc-500">Rewards, cooldowns, overlays</span>
      </Link>
      <Link
        href="/#map"
        className="rounded-lg border border-rust-border bg-rust-surface px-4 py-3 text-left transition-colors hover:border-rust-cyan"
      >
        <span className="block font-medium text-zinc-200">Live Map Intel</span>
        <span className="block text-xs text-zinc-500">Heatmaps, events, raid awareness</span>
      </Link>
    </div>
  );
}

function HeroScreenshotPlaceholder() {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center justify-center bg-rust-surface">
        <DashboardFrame className="h-auto w-full max-h-[320px]" />
      </div>
      <div className="absolute bottom-2 right-2 rounded bg-rust-panel/90 px-2 py-1 font-mono text-xs text-zinc-500">
        Dashboard preview
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

function PillarsSection() {
  const pillars: { id: string; title: string; tagline: string; benefits: string[]; href: string }[] = [
    {
      id: "admin",
      title: "Admin & Server Tools",
      tagline: "One place for RCON, roles, and audit.",
      benefits: [
        "Live RCON console and command presets",
        "Staff roles and permissions",
        "Audit logs and scheduled commands",
        "Plugin management roadmap",
      ],
      href: "/features#admin",
    },
    {
      id: "stream",
      title: "Streamer–Viewer Interaction",
      tagline: "Engage viewers without the chaos.",
      benefits: [
        "Rewards mapping and cooldowns",
        "Anti-abuse and rate limits",
        "Overlays and Twitch integration",
        "TikTok & Kick adapters (planned)",
      ],
      href: "/features#stream",
    },
    {
      id: "map",
      title: "Map Monitor / Live Intel",
      tagline: "See the map, not just the chat.",
      benefits: [
        "Live map (optional plugin)",
        "Heatmaps and event markers",
        "Raid alerts and movement trails",
        "Roadmap: deeper intel features",
      ],
      href: "/features#map",
    },
  ];

  return (
    <section className="px-4 py-16 sm:px-6 sm:py-24" id="pillars">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-center text-2xl font-bold text-zinc-100 sm:text-3xl">
          Three pillars. One dashboard.
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-zinc-400">
          Built for server owners, admins, and streamers who want less tool sprawl.
        </p>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {pillars.map((p) => (
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
                Learn more →
              </Link>
            </div>
          ))}
        </div>
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
        <h2 className="text-center text-2xl font-bold text-zinc-100">What admins are saying</h2>
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
          Join the beta. Get early access.
        </h2>
        <p className="mt-3 text-zinc-400">
          Be the first to try RustMaxx. No credit card required.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link
            href="/login"
            className="rounded-lg bg-rust-cyan px-6 py-3 font-medium text-rust-panel hover:opacity-90"
          >
            Get early access
          </Link>
          <Link
            href="/contact"
            className="rounded-lg border border-rust-border bg-rust-surface px-6 py-3 font-medium text-zinc-200 hover:border-rust-mute"
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
      <PillarsSection />
      <IntegrationsRow />
      <TestimonialsSection />
      <CTASection />
    </MarketingLayout>
  );
}
