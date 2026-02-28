"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-rust-border bg-rust-panel/95 backdrop-blur supports-[backdrop-filter]:bg-rust-panel/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-zinc-100">
          <span className="font-mono text-rust-cyan">$</span>
          <span>RustMaxx</span>
        </Link>
        <nav className="hidden items-center gap-6 md:flex" aria-label="Main">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`text-sm font-medium transition-colors hover:text-rust-cyan ${
                pathname === href ? "text-rust-cyan" : "text-zinc-400"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-lg border border-rust-border bg-rust-surface px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-rust-mute hover:text-white"
          >
            Log in
          </Link>
          <Link
            href="/login"
            className="rounded-lg bg-rust-cyan px-4 py-2 text-sm font-medium text-rust-panel transition-opacity hover:opacity-90"
          >
            Get early access
          </Link>
        </div>
      </div>
      {/* Mobile nav: simple dropdown or hamburger could be added later */}
      <div className="flex gap-2 overflow-x-auto border-t border-rust-border px-4 py-2 md:hidden">
        {NAV.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`shrink-0 rounded px-3 py-1.5 text-sm ${
              pathname === href ? "bg-rust-surface text-rust-cyan" : "text-zinc-400 hover:text-white"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
    </header>
  );
}
