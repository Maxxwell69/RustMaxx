import { SiteHeader } from "@/components/layout/SiteHeader";
import { DashboardFooter } from "@/components/layout/DashboardFooter";

export default function ViewerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <DashboardFooter />
    </div>
  );
}
