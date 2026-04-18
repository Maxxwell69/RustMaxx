"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AuthMePayload } from "@/lib/auth-me-payload";
import { filterDashboardFooterLinksForUser } from "@/components/layout/nav-persona";

export function DashboardFooter() {
  const [me, setMe] = useState<AuthMePayload | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AuthMePayload | null) => {
        if (data && typeof data === "object" && "email" in data) setMe(data);
        else setMe(null);
      })
      .catch(() => setMe(null));
  }, []);

  const footerLinks = useMemo(() => filterDashboardFooterLinksForUser(me), [me]);

  const isSuperAdmin = me?.role === "super_admin";

  return (
    <footer className="border-t border-rust-border bg-rust-panel">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-zinc-500">
            RustMaxx dashboard. Tools match what you signed up for — server admin, streamer, and fan
            sections stay separate unless you chose more than one.
          </p>
          <nav className="flex flex-wrap gap-4 text-xs" aria-label="Dashboard footer">
            {footerLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-rust-cyan opacity-90 transition-colors hover:opacity-100"
              >
                {label}
              </Link>
            ))}
            {isSuperAdmin && (
              <Link
                href="/admin"
                className="font-medium text-rust-cyan transition-colors hover:opacity-100"
              >
                Super Admin dashboard
              </Link>
            )}
          </nav>
        </div>
      </div>
    </footer>
  );
}

