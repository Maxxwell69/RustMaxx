import { SiteHeader } from "@/components/layout/SiteHeader";
import { Footer } from "./Footer";

/**
 * Sitewide marketing shell: ambient gradient, subtle grid, header + main + footer.
 * Polished marketing pages (Crowd Control–style depth) without requiring image assets.
 */
export function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing-shell">
      <div className="marketing-ambient" aria-hidden />
      <div className="marketing-grid-bg" aria-hidden />
      <div className="relative z-10 flex min-h-screen flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <Footer />
      </div>
    </div>
  );
}
