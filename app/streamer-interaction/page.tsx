import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { PillarHero } from "@/components/marketing/streamer/PillarHero";
import { HowItWorksSteps } from "@/components/marketing/streamer/HowItWorksSteps";
import { FeatureCardGrid } from "@/components/marketing/streamer/FeatureCardGrid";
import { ModeCards } from "@/components/marketing/streamer/ModeCards";
import { UseCaseStories } from "@/components/marketing/streamer/UseCaseStories";
import { SecurityCallout } from "@/components/marketing/streamer/SecurityCallout";
import { PlatformBadges } from "@/components/marketing/streamer/PlatformBadges";
import { TechStrip } from "@/components/marketing/streamer/TechStrip";
import { FinalCTA } from "@/components/marketing/streamer/FinalCTA";
import { LiveConsoleDemo } from "@/components/marketing/streamer/LiveConsoleDemo";
import { EventTriggerDemo } from "@/components/marketing/streamer/EventTriggerDemo";

export default function StreamerInteractionPage() {
  return (
    <MarketingLayout>
      <div className="relative min-h-screen">
        <div className="absolute inset-0 bg-grid-subtle opacity-50" aria-hidden />
        <div className="relative">
          <PillarHero />

          <HowItWorksSteps />

          <section
            id="demo"
            className="border-b border-rust-border bg-rust-panel/50 px-4 py-12 sm:px-6 sm:py-16"
            aria-labelledby="demo-heading"
          >
            <div className="mx-auto max-w-6xl">
              <h2 id="demo-heading" className="text-center text-2xl font-bold text-zinc-100 sm:text-3xl">
                Live Demo
              </h2>
              <div className="mt-8 grid gap-6 lg:grid-cols-2">
                <EventTriggerDemo />
                <LiveConsoleDemo />
              </div>
            </div>
          </section>

          <FeatureCardGrid />
          <ModeCards />
          <UseCaseStories />
          <SecurityCallout />
          <PlatformBadges />
          <TechStrip />
          <FinalCTA />
        </div>
      </div>
    </MarketingLayout>
  );
}
