import Link from "next/link";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

const TIERS = [
  {
    name: "Starter",
    servers: "1 server",
    price: "$X",
    period: "/mo",
    placeholder: true,
    features: ["Live RCON", "Command presets", "Audit log", "Email support"],
  },
  {
    name: "Community",
    servers: "Up to 5 servers",
    price: "$X",
    period: "/mo",
    placeholder: true,
    features: ["Everything in Starter", "Stream interaction", "Map intel (plugin)", "Discord support"],
    highlighted: true,
  },
  {
    name: "Network",
    servers: "Unlimited servers",
    price: "$X",
    period: "/mo",
    placeholder: true,
    features: ["Everything in Community", "Priority support", "API access", "Custom integrations"],
  },
];

const FAQ = [
  {
    q: "Do I need a plugin?",
    a: "For live RCON, admin tools, and stream rewards you don't. For the live map and some intel features, an optional server-side plugin is required. We'll provide install steps and config examples.",
  },
  {
    q: "Does it work on shared hosts?",
    a: "Yes. RustMaxx connects outbound to your server via WebRCON. You don't need to open inbound ports. Works with most hosts that expose RCON (or WebRCON); check your host's docs.",
  },
  {
    q: "How do you secure RCON?",
    a: "Credentials are stored encrypted. We use signed requests and audit every command. We never log your RCON password in plain text. See the Docs for our security model overview.",
  },
];

export const metadata = {
  title: "Pricing | RustMaxx",
  description: "Plans for every size: from single-server to network. Pricing placeholder.",
  openGraph: { title: "Pricing | RustMaxx", description: "Plans for every size." },
};

export default function PricingPage() {
  return (
    <MarketingLayout>
      <div className="relative px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-center text-3xl font-bold text-zinc-100">Pricing</h1>
          <p className="mx-auto mt-2 max-w-xl text-center text-zinc-400">
            Simple per-server pricing. Replace placeholders with real numbers when you&apos;re ready.
          </p>

          <div className="mt-14 grid gap-8 md:grid-cols-3">
            {TIERS.map((t) => (
              <div
                key={t.name}
                className={`rounded-xl border bg-rust-surface p-6 ${
                  t.highlighted ? "border-rust-cyan ring-1 ring-rust-cyan/20" : "border-rust-border"
                }`}
              >
                {t.placeholder && (
                  <span className="mb-2 inline-block rounded bg-rust-amber/15 px-2 py-0.5 text-xs text-rust-amber">
                    Pricing placeholder
                  </span>
                )}
                <h2 className="text-lg font-semibold text-zinc-100">{t.name}</h2>
                <p className="mt-1 text-sm text-zinc-400">{t.servers}</p>
                <p className="mt-4 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-zinc-100">{t.price}</span>
                  <span className="text-zinc-500">{t.period}</span>
                </p>
                <ul className="mt-6 space-y-3">
                  {t.features.map((f) => (
                    <li key={f} className="flex gap-2 text-sm text-zinc-400">
                      <span className="text-rust-green">✓</span> {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/login"
                  className={`mt-6 block w-full rounded-lg py-2.5 text-center text-sm font-medium ${
                    t.highlighted
                      ? "bg-rust-cyan text-rust-panel shadow-rust-glow hover:opacity-90 hover:shadow-rust-glow-lg"
                      : "border border-rust-border text-zinc-200 hover:border-rust-mute"
                  }`}
                >
                  Get started
                </Link>
              </div>
            ))}
          </div>

          <section className="mt-20 border-t border-rust-border pt-16">
            <h2 className="text-xl font-semibold text-zinc-100">FAQ</h2>
            <dl className="mt-6 space-y-6">
              {FAQ.map((item) => (
                <div key={item.q}>
                  <dt className="font-medium text-zinc-200">{item.q}</dt>
                  <dd className="mt-2 text-sm text-zinc-400">{item.a}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </MarketingLayout>
  );
}
