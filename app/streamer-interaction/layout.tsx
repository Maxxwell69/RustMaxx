import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RustMaxx Streamer Interaction – Viewer Rewards to In-Game Actions",
  description:
    "Connect Twitch to your Rust server. Map viewer rewards, bits, and channel points to live in-game events. Cooldowns, anti-abuse, and full audit. TikTok & Kick planned.",
  openGraph: {
    title: "RustMaxx Streamer Interaction – Viewer Rewards to In-Game Actions",
    description:
      "Connect Twitch to your Rust server. Map viewer rewards to live in-game events. Controlled chaos, cooldowns, anti-abuse.",
    type: "website",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "RustMaxx Streamer Interaction",
  applicationCategory: "GameApplication",
  description:
    "Stream-to-Rust interaction: connect Twitch, map viewer rewards to in-game events, with cooldowns and anti-abuse.",
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
