import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { FeatureCard } from "@/components/marketing/FeatureCard";

const ADMIN_FEATURES = [
  {
    title: "Live RCON console",
    description: "Run commands and see output in real time.",
    bullets: ["WebRCON-based", "Command history", "Multi-server support"],
    available: true,
  },
  {
    title: "Command presets",
    description: "Quick buttons for status, players, env, and events.",
    bullets: ["Custom presets", "One-click actions"],
    available: true,
  },
  {
    title: "Staff roles & permissions",
    description: "Control who can do what.",
    bullets: ["Role-based access", "Per-server permissions"],
    available: true,
  },
  {
    title: "Audit logs",
    description: "Track who ran which command and when.",
    bullets: ["Command audit trail", "Export-friendly"],
    available: true,
  },
  {
    title: "Scheduled commands",
    description: "Automate restarts, broadcasts, and more.",
    bullets: ["Cron-style scheduling", "Recurring tasks"],
    available: false,
  },
  {
    title: "Rust mod plugins (uMod/Oxide)",
    description:
      "First-class support for the standard Rust modding stack: Oxide/uMod plugins on your server, surfaced in RustMaxx.",
    bullets: ["Plugin inventory & status", "Safe load/unload roadmap", "No proprietary server DLLs required"],
    available: false,
  },
];

const STREAM_FEATURES = [
  {
    title: "Rewards mapping",
    description: "Map stream events to in-game rewards.",
    bullets: ["Points, follows, subs", "Configurable rewards"],
    available: true,
  },
  {
    title: "Cooldowns & anti-abuse",
    description: "Rate limits and safe defaults.",
    bullets: ["Per-user cooldowns", "Spam protection"],
    available: true,
  },
  {
    title: "Overlays",
    description: "OBS-ready overlays for alerts and queue.",
    bullets: ["Browser source", "Customizable layout"],
    available: false,
  },
  {
    title: "Twitch adapter",
    description: "First-class Twitch integration.",
    bullets: ["Events API", "Auth flow"],
    available: true,
  },
  {
    title: "TikTok Live (TikFinity)",
    description:
      "Map TikTok Live gifts, likes, shares, and goals to in-game actions. TikFinity sends webhooks to RustMaxx; you define event→action rules and RCON.",
    bullets: ["Per-streamer webhook URLs", "Gift & social event mapping", "Cooldowns tied to your rules"],
    available: true,
  },
  {
    title: "Kick adapter",
    description: "Planned support for Kick live events with the same reward model as Twitch/TikTok.",
    bullets: ["On the roadmap", "Same mapping ideas"],
    available: false,
  },
];

const MAP_FEATURES = [
  {
    title: "Live map",
    description: "Optional plugin for real-time map view.",
    bullets: ["Requires plugin", "Server-side component"],
    available: true,
  },
  {
    title: "Heatmaps & event markers",
    description: "See hotspots and events on the map.",
    bullets: ["Deaths, raids, spawns", "Configurable layers"],
    available: true,
  },
  {
    title: "Raid alerts",
    description: "Get notified when structures take damage.",
    bullets: ["Threshold-based", "Discord/webhook roadmap"],
    available: true,
  },
  {
    title: "Movement trails",
    description: "Optional player trail visualization.",
    bullets: ["Privacy-conscious", "Opt-in"],
    available: false,
  },
];

export const metadata = {
  title: "Features | RustMaxx",
  description:
    "Admin tools, stream interaction, and live map intel for Rust servers. RCON, rewards, heatmaps, and more.",
  openGraph: { title: "Features | RustMaxx", description: "Admin tools, stream interaction, and live map intel." },
};

export default function FeaturesPage() {
  return (
    <MarketingLayout>
      <div className="relative px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-3xl font-bold text-zinc-100">Features</h1>
          <p className="mt-2 text-zinc-400">
            What you get with RustMaxx. We clearly mark what&apos;s available now vs. on the roadmap.
          </p>
        </div>

        <section className="mx-auto mt-14 max-w-4xl" id="admin">
          <h2 className="text-xl font-semibold text-zinc-100">Admin & Server Tools</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Run your server from one place. Roles, audit trail, and automation.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {ADMIN_FEATURES.map((f) => (
              <FeatureCard
                key={f.title}
                title={f.title}
                description={f.description}
                bullets={f.bullets}
                available={f.available}
              />
            ))}
          </div>
        </section>

        <section className="mx-auto mt-16 max-w-4xl" id="stream">
          <h2 className="text-xl font-semibold text-zinc-100">Streamer–Viewer Interaction</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Twitch EventSub and TikTok Live via TikFinity webhooks. Kick planned. Rewards, cooldowns, anti-abuse.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {STREAM_FEATURES.map((f) => (
              <FeatureCard
                key={f.title}
                title={f.title}
                description={f.description}
                bullets={f.bullets}
                available={f.available}
              />
            ))}
          </div>
        </section>

        <section className="mx-auto mt-16 max-w-4xl" id="map">
          <h2 className="text-xl font-semibold text-zinc-100">Map Monitor / Live Intel</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Live map requires an optional plugin. Heatmaps, events, and raid awareness.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {MAP_FEATURES.map((f) => (
              <FeatureCard
                key={f.title}
                title={f.title}
                description={f.description}
                bullets={f.bullets}
                available={f.available}
              />
            ))}
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}
