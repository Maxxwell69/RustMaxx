import Link from "next/link";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { PricingSections } from "@/components/pricing/PricingSections";
import { getPublishedPricingPageData } from "@/lib/pricing-packages";

const FAQ = [
  {
    q: "What is billed per server vs per account?",
    a: "Server plans apply to each Rust server you add in RustMaxx (public list, then optional Pro for TikFinity on that server, then Analytics). Streamer plans are one subscription per login and set how many different servers you can attach TikFinity webhooks to.",
  },
  {
    q: "Do I need a plugin?",
    a: "For live RCON, admin tools, and stream rewards you don't. For the live map and some intel features, an optional server-side plugin is required. We'll provide install steps and config examples.",
  },
  {
    q: "How do you secure RCON?",
    a: "Credentials are stored encrypted. We use signed requests and audit every command. We never log your RCON password in plain text. See the Docs for our security model overview.",
  },
];

export const metadata = {
  title: "Pricing | RustMaxx",
  description: "Server and streamer plans: list your server, enable TikFinity, and scale webhooks.",
  openGraph: { title: "Pricing | RustMaxx", description: "Server and streamer plans for RustMaxx." },
};

/** Always reflect latest rows from admin-edited `pricing_packages`. */
export const revalidate = 0;

export default async function PricingPage() {
  const { server: serverTiers, streamer: streamerTiers, combo: comboTiers } = await getPublishedPricingPageData();

  return (
    <MarketingLayout>
      <div className="relative px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-center text-3xl font-bold text-zinc-100">Pricing</h1>
          <p className="mx-auto mt-2 max-w-2xl text-center text-zinc-400">
            Choose a plan for each server you run, and a separate plan for your streamer account (webhook limits).
          </p>

          <PricingSections
            serverTiers={serverTiers}
            streamerTiers={streamerTiers}
            comboTiers={comboTiers}
          />

          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link
              href="/login"
              className="rounded-lg bg-rust-cyan px-5 py-2.5 text-sm font-medium text-rust-panel shadow-rust-glow hover:opacity-90"
            >
              Log in to upgrade
            </Link>
            <Link
              href="/streamer"
              className="rounded-lg border border-rust-border px-5 py-2.5 text-sm font-medium text-zinc-200 hover:border-rust-mute"
            >
              Streamer dashboard
            </Link>
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
