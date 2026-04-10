import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RustMaxx Streamer Interaction – TikTok Live & TikFinity to Rust",
  description:
    "Connect TikTok Live to your Rust server via TikFinity webhooks: gifts, goals, and custom triggers to in-game actions. Cooldowns, crew rules, patrol anchors, and full audit.",
  openGraph: {
    title: "RustMaxx Streamer Interaction – TikTok Live & TikFinity to Rust",
    description:
      "Map TikFinity events to live Rust server actions. Controlled chaos, cooldowns, anti-abuse, Steam anchor for spawns.",
    type: "website",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "RustMaxx Streamer Interaction",
  applicationCategory: "GameApplication",
  description:
    "Stream-to-Rust interaction for TikTok Live: TikFinity webhooks, viewer-tied rewards, in-game events, cooldowns and anti-abuse.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

export default function StreamerInteractionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {children}
    </>
  );
}
