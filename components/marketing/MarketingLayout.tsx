import { Header } from "./Header";
import { Footer } from "./Footer";

export function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-[#0a0b0c] text-zinc-100">
      <div className="absolute inset-0 bg-grid-subtle opacity-50" aria-hidden />
      <div className="relative">
        <Header />
        <main>{children}</main>
        <Footer />
      </div>
    </div>
  );
}
