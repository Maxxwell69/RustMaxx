import { SiteHeader } from "@/components/layout/SiteHeader";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-zinc-950">
      <SiteHeader />
      <main className="flex-1">{children}</main>
    </div>
  );
}
