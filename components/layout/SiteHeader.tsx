"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/marketing/Logo";
import UserProfile from "./UserProfile";
import LogoutButton from "./LogoutButton";
import { useEffect, useMemo, useState } from "react";
import type { AuthMePayload } from "@/lib/auth-me-payload";
import { SITE_NAV_LINKS, filterNavLinksForUser } from "@/components/layout/nav-persona";

export function SiteHeader() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [me, setMe] = useState<AuthMePayload | null>(null);

  useEffect(() => {
    setMounted(true);
    fetch("/api/auth/me")
      .then((r) => {
        setLoggedIn(r.ok);
        if (r.ok) return r.json();
        setMe(null);
        return null;
      })
      .then((data: AuthMePayload | null) => {
        if (data && typeof data === "object" && "email" in data) setMe(data);
        else setMe(null);
      })
      .catch(() => {
        setLoggedIn(false);
        setMe(null);
      });
  }, []);

  const isDashboard = pathname === "/servers" || pathname?.startsWith("/servers/");
  const isStreamersSection = pathname === "/streamers" || pathname?.startsWith("/streamers/");
  const isStreamerSetup =
    pathname === "/streamer" || (pathname?.startsWith("/streamer/") ?? false);
  const isViewerSuperfan = pathname === "/viewer" || pathname?.startsWith("/viewer/");
  const isHome = pathname === "/";
  const isAppShell =
    pathname?.startsWith("/servers") ||
    pathname?.startsWith("/profile") ||
    pathname?.startsWith("/admin") ||
    pathname === "/streamer" ||
    (pathname?.startsWith("/streamer/") ?? false);

  const navLinks = useMemo(() => {
    if (!loggedIn) return [...SITE_NAV_LINKS];
    const forPersona = filterNavLinksForUser(me);
    return forPersona.filter((l) => l.href !== "/");
  }, [loggedIn, me]);

  function navLinkActive(href: string): boolean {
    if (href === "/servers") return isDashboard;
    if (href === "/streamer") return isStreamerSetup;
    if (href === "/streamers") return isStreamersSection;
    if (href === "/viewer/superfan") return isViewerSuperfan;
    if (href === "/maxxinvaders") return pathname === "/maxxinvaders";
    return pathname === href;
  }

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800/90 bg-zinc-950/85 backdrop-blur-md supports-[backdrop-filter]:bg-zinc-950/75">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2.5 sm:gap-4 sm:px-6">
        <div className="flex min-w-0 shrink items-center">
          <Link href="/" className="flex items-center" aria-label="RustMaxx home">
            <Logo
              className={
                isHome
                  ? "h-28 w-auto sm:h-32 md:h-[8.5rem]"
                  : isAppShell
                    ? "h-[4.5rem] w-auto sm:h-20"
                    : "h-[5.5rem] w-auto sm:h-24 md:h-28"
              }
              width={isHome ? 680 : isAppShell ? 400 : 560}
              height={isHome ? 136 : isAppShell ? 80 : 108}
              fallbackClassName={
                isHome
                  ? "text-4xl font-bold text-rust-cyan sm:text-5xl md:text-6xl"
                  : "text-3xl font-bold text-rust-cyan sm:text-4xl"
              }
            />
          </Link>
        </div>
        <nav
          className="hidden min-w-0 flex-1 flex-wrap items-center justify-center gap-1 sm:gap-2 md:flex"
          aria-label="Site navigation"
        >
          {navLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                navLinkActive(href)
                  ? "font-medium text-rust-cyan shadow-rust-glow-subtle bg-rust-cyan/10"
                  : "text-zinc-300 hover:bg-zinc-800/80 hover:text-zinc-100"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div
          className="flex shrink-0 items-center gap-3 border-l border-zinc-700 pl-3 md:gap-4 md:pl-6"
          aria-label="Account"
        >
          {mounted && loggedIn ? (
            <>
              <UserProfile />
              <LogoutButton />
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg border border-zinc-600 bg-transparent px-3 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800/80"
              >
                Log in
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-rust-cyan px-4 py-1.5 text-sm font-semibold text-rust-panel shadow-rust-glow transition-opacity hover:opacity-95 hover:shadow-rust-glow-lg"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
      {/* Mobile: nav + account links so both are always visible */}
      <div
        className="flex flex-wrap items-center gap-2 border-t border-zinc-800 px-3 py-2 md:hidden"
        aria-label="Mobile navigation"
      >
        {navLinks.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${
              navLinkActive(href)
                ? "bg-rust-cyan/10 font-medium text-rust-cyan"
                : "text-zinc-300 hover:bg-zinc-800/80 hover:text-zinc-100"
            }`}
          >
            {label}
          </Link>
        ))}
        {mounted && !loggedIn && (
          <>
            <span className="text-zinc-600">|</span>
            <Link
              href="/login"
              className="shrink-0 rounded border border-rust-cyan/60 px-3 py-1.5 text-sm font-medium text-rust-cyan"
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="shrink-0 rounded-lg bg-rust-cyan px-3 py-1.5 text-sm font-semibold text-rust-panel shadow-rust-glow"
            >
              Get started
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
