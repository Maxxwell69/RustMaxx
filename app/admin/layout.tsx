import { SiteHeader } from "@/components/layout/SiteHeader";
import { DashboardFooter } from "@/components/layout/DashboardFooter";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-zinc-950">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <DashboardFooter />
    </div>
  );
}
