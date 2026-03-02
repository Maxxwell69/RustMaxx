"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/marketing/Logo";
import UserProfile from "./UserProfile";
import LogoutButton from "./LogoutButton";
import { useEffect, useState } from "react";

const NAV_LINKS = [
  { href: "/servers", label: "Dashboard" },
  { href: "/", label: "Home" },
  { href: "/server-list", label: "Server list" },
  { href: "/streamer-interaction", label: "Streamer Interaction" },
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setMounted(true);
    fetch("/api/auth/me")
      .then((r) => setLoggedIn(r.ok))
      .catch(() => setLoggedIn(false));
  }, []);

  const isDashboard = pathname === "/servers" || pathname?.startsWith("/servers/");

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-900/95 backdrop-blur supports-[backdrop-filter]:bg-zinc-900/80">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-3 py-1.5 sm:px-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex shrink-0 items-center" aria-label="RustMaxx home">
            <Logo
              className="h-40 w-auto sm:h-48"
              width={960}
              height={192}
              fallbackClassName="text-2xl font-bold text-rust-cyan sm:text-3xl"
            />
          </Link>
          <span className="hidden text-sm text-zinc-600 sm:inline">|</span>
          <nav className="flex flex-wrap items-center gap-2 sm:gap-4" aria-label="Site navigation">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`rounded px-2 py-1 text-sm transition-colors hover:opacity-100 ${
                  (href === "/servers" ? isDashboard : pathname === href)
                    ? "font-medium text-rust-cyan bg-rust-cyan/10"
                    : "text-rust-cyan opacity-90 hover:bg-zinc-800"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {mounted && loggedIn ? (
            <>
              <UserProfile />
              <LogoutButton />
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded border border-rust-cyan/60 bg-zinc-800/80 px-3 py-1.5 text-sm font-medium text-rust-cyan transition-colors hover:border-rust-cyan hover:shadow-rust-glow-subtle"
              >
                Log in
              </Link>
              <Link
                href="/early-access"
                className="rounded bg-rust-cyan px-3 py-1.5 text-sm font-medium text-rust-panel shadow-rust-glow transition-opacity hover:opacity-90 hover:shadow-rust-glow-lg"
              >
                Get early access
              </Link>
            </>
          )}
        </div>
      </div>
      {/* Mobile: same nav as horizontal scroll */}
      <div
        className="flex gap-2 overflow-x-auto border-t border-zinc-800 px-3 py-2 md:hidden"
        aria-label="Mobile navigation"
      >
        {NAV_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`shrink-0 rounded px-3 py-1.5 text-sm ${
              (href === "/servers" ? isDashboard : pathname === href)
                ? "bg-rust-cyan/10 font-medium text-rust-cyan"
                : "text-rust-cyan opacity-90 hover:opacity-100"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
    </header>
  );
}
