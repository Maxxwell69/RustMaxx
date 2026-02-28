"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";

const NAV = [
  { href: "/server-list", label: "Servers" },
  { href: "/streamer-interaction", label: "Streamer Interaction" },
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 overflow-visible border-b border-rust-border bg-rust-panel/95 backdrop-blur supports-[backdrop-filter]:bg-rust-panel/80">
      <div className="mx-auto flex min-h-48 max-w-7xl items-center justify-between gap-4 overflow-visible px-3 py-1.5 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center">
          <Logo className="h-40 w-auto sm:h-48" width={960} height={192} fallbackClassName="text-2xl font-bold text-rust-cyan sm:text-3xl" />
        </Link>
        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-6 md:flex md:flex-nowrap md:overflow-x-auto md:justify-center" aria-label="Main">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`shrink-0 whitespace-nowrap text-sm font-medium text-rust-cyan transition-colors hover:opacity-100 ${
                pathname === href ? "opacity-100" : "opacity-85"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/login"
            className="rounded-lg border border-rust-cyan/60 bg-rust-surface px-3 py-1.5 text-sm font-medium text-rust-cyan transition-colors hover:border-rust-cyan hover:shadow-rust-glow-subtle"
          >
            Log in
          </Link>
          <Link
            href="/early-access"
            className="rounded-lg bg-rust-cyan px-3 py-1.5 text-sm font-medium text-rust-panel shadow-rust-glow transition-opacity hover:opacity-90 hover:shadow-rust-glow-lg"
          >
            Get early access
          </Link>
        </div>
      </div>
      {/* Mobile nav: simple dropdown or hamburger could be added later */}
      <div className="flex gap-2 overflow-x-auto border-t border-rust-border px-3 py-1.5 md:hidden">
        {NAV.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`shrink-0 rounded px-3 py-1.5 text-sm text-rust-cyan ${
              pathname === href ? "bg-rust-surface opacity-100" : "opacity-85 hover:opacity-100"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
    </header>
  );
}
