"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Me = {
  role: string;
};

export function DashboardFooter() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.role === "string") {
          setMe(data);
        } else {
          setMe(null);
        }
      })
      .catch(() => setMe(null));
  }, []);

  const isSuperAdmin = me?.role === "super_admin";

  return (
    <footer className="border-t border-rust-border bg-rust-panel">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-zinc-500">
            RustMaxx dashboard. Manage your Rust servers from one place.
          </p>
          <nav className="flex flex-wrap gap-4 text-xs" aria-label="Dashboard footer">
            <Link
              href="/servers"
              className="text-rust-cyan opacity-90 transition-colors hover:opacity-100"
            >
              Servers dashboard
            </Link>
            <Link
              href="/server-list"
              className="text-rust-cyan opacity-90 transition-colors hover:opacity-100"
            >
              Public server list
            </Link>
            <Link
              href="/streamer-interaction"
              className="text-rust-cyan opacity-90 transition-colors hover:opacity-100"
            >
              Streamer interaction
            </Link>
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

