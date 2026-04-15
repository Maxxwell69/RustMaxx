"use client";

import { useMemo, useState } from "react";

type TierCard = {
  id: string;
  name: string;
  price: string;
  priceUsd: number | null;
  period: string;
  note: string;
  features: string[];
  highlighted: boolean;
};

type Props = {
  serverTiers: TierCard[];
  streamerTiers: TierCard[];
  comboTiers: TierCard[];
};

function displayPrice(tier: TierCard, yearly: boolean): { price: string; period: string } {
  if (!yearly) return { price: tier.price, period: tier.period };
  if (tier.priceUsd == null || tier.priceUsd <= 0) return { price: tier.price, period: tier.period };
  return { price: `$${(tier.priceUsd * 11).toFixed(2)}`, period: "/yr" };
}

function TierGrid({ tiers, yearly }: { tiers: TierCard[]; yearly: boolean }) {
  return (
    <div className="mt-6 grid gap-8 md:grid-cols-3">
      {tiers.map((t) => {
        const shown = displayPrice(t, yearly);
        return (
          <div
            key={t.id}
            className={`rounded-xl border bg-rust-surface p-6 ${
              t.highlighted ? "border-rust-cyan ring-1 ring-rust-cyan/20" : "border-rust-border"
            }`}
          >
            <h3 className="text-lg font-semibold text-zinc-100">{t.name}</h3>
            {t.note ? <p className="mt-1 text-sm text-zinc-400">{t.note}</p> : null}
            <p className="mt-4 flex flex-wrap items-baseline gap-1">
              <span className="text-2xl font-bold text-zinc-100">{shown.price}</span>
              {shown.period ? <span className="text-zinc-500">{shown.period}</span> : null}
            </p>
            {yearly && t.priceUsd != null && t.priceUsd > 0 ? (
              <p className="mt-1 text-xs text-emerald-300/90">Yearly billed at 11 months (1 month free).</p>
            ) : null}
            <ul className="mt-6 space-y-3">
              {t.features.map((f) => (
                <li key={f} className="flex gap-2 text-sm text-zinc-400">
                  <span className="text-rust-green">✓</span> {f}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function PricingSections({ serverTiers, streamerTiers, comboTiers }: Props) {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const yearly = billingCycle === "yearly";
  const hasCombo = useMemo(() => comboTiers.length > 0, [comboTiers.length]);

  return (
    <>
      <div className="mt-8 flex justify-center">
        <div className="inline-flex rounded-lg border border-rust-border bg-zinc-900 p-1">
          <button
            type="button"
            onClick={() => setBillingCycle("monthly")}
            className={`rounded-md px-4 py-1.5 text-sm ${
              !yearly ? "bg-rust-cyan text-zinc-950" : "text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setBillingCycle("yearly")}
            className={`rounded-md px-4 py-1.5 text-sm ${
              yearly ? "bg-rust-cyan text-zinc-950" : "text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            Yearly (11x)
          </button>
        </div>
      </div>

      <section className="mt-14">
        <h2 className="text-lg font-semibold text-zinc-100">Server admins</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Billed per server in RustMaxx. Upgrade from your server&apos;s settings after you log in.
        </p>
        <TierGrid tiers={serverTiers} yearly={yearly} />
      </section>

      <section className="mt-16 border-t border-rust-border pt-14">
        <h2 className="text-lg font-semibold text-zinc-100">Streamers</h2>
        <p className="mt-1 text-sm text-zinc-500">
          One plan per RustMaxx account. Controls how many servers you can connect with TikFinity webhooks.
        </p>
        <TierGrid tiers={streamerTiers} yearly={yearly} />
      </section>

      {hasCombo ? (
        <section className="mt-16 border-t border-rust-border pt-14">
          <h2 className="text-lg font-semibold text-zinc-100">Combo package</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Combined server owner + streamer package for teams that want one plan for both.
          </p>
          <TierGrid tiers={comboTiers} yearly={yearly} />
        </section>
      ) : null}
    </>
  );
}
