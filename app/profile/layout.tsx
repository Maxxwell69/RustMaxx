import { PirateMaxxCredit } from "@/components/layout/PirateMaxxCredit";
import { SiteHeader } from "@/components/layout/SiteHeader";

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <footer className="mt-auto border-t border-rust-border bg-[#050607]/90">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <PirateMaxxCredit variant="dashboard" />
        </div>
      </footer>
    </div>
  );
}
