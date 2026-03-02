import { SiteHeader } from "@/components/layout/SiteHeader";
import { DashboardFooter } from "@/components/layout/DashboardFooter";

export default function ServersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 p-4">{children}</main>
      <DashboardFooter />
    </div>
  );
}
