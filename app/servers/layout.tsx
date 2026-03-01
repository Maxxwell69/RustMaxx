import Link from "next/link";
import LogoutButton from "./logout-button";
import UserProfile from "./user-profile";
import { Logo } from "@/components/marketing/Logo";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/server-list", label: "Server list" },
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export default function ServersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-zinc-800 bg-zinc-900/80 px-3 py-1.5 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/servers" className="flex shrink-0 items-center">
              <Logo className="h-40 w-auto sm:h-48" width={960} height={192} fallbackClassName="text-2xl font-bold text-rust-cyan sm:text-3xl" />
            </Link>
            <span className="text-sm text-zinc-600">|</span>
            <nav className="flex flex-wrap items-center gap-4" aria-label="Site navigation">
              <Link
                href="/servers"
                className="rounded px-2 py-1 text-sm font-medium text-rust-cyan bg-rust-cyan/10"
              >
                Dashboard
              </Link>
              {NAV_LINKS.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded px-2 py-1 text-sm text-rust-cyan hover:bg-zinc-800 opacity-90 hover:opacity-100"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <UserProfile />
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
