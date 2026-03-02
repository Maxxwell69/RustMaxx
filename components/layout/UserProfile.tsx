"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Profile = {
  id: string;
  email: string;
  role: string;
  display_name: string | null;
  created_at: string;
};

function formatRole(role: string): string {
  return role.replace(/_/g, " ");
}

export default function UserProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setProfile)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <span className="text-sm text-zinc-500">Loading…</span>
    );
  }
  if (!profile) {
    return null;
  }
  return (
    <div className="flex items-center gap-3">
      <Link
        href="/profile"
        className="rounded px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-rust-cyan"
        title="View profile"
      >
        {profile.display_name || profile.email}
      </Link>
      <span
        className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400"
        title="Your role"
      >
        {formatRole(profile.role)}
      </span>
    </div>
  );
}
