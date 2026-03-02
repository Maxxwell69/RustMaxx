"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (!r.ok) {
          router.push("/login?from=/profile");
          return null;
        }
        return r.json();
      })
      .then(setProfile)
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-zinc-500">
        Loading…
      </div>
    );
  }
  if (!profile) {
    return null;
  }
  return (
    <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-6">
          <h1 className="mb-6 text-2xl font-bold text-zinc-100">Your profile</h1>
          <dl className="space-y-4">
            <div>
              <dt className="text-sm text-zinc-500">Email</dt>
              <dd className="mt-0.5 font-medium text-zinc-100">{profile.email}</dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500">Display name</dt>
              <dd className="mt-0.5 font-medium text-zinc-100">
                {profile.display_name || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500">Role</dt>
              <dd className="mt-0.5">
                <span className="rounded bg-zinc-800 px-2 py-1 text-sm font-medium text-rust-cyan">
                  {formatRole(profile.role)}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500">Member since</dt>
              <dd className="mt-0.5 text-zinc-300">
                {new Date(profile.created_at).toLocaleDateString()}
              </dd>
            </div>
          </dl>
          <p className="mt-6 text-sm text-zinc-500">
            Role permissions:{" "}
            {profile.role === "super_admin" && "Can promote users to admin and remove admins."}
            {profile.role === "admin" && "Can create and manage servers."}
            {profile.role === "moderator" && "Can create server users."}
            {["support", "streamer", "player", "guest"].includes(profile.role) &&
              "Access to dashboard and server list."}
          </p>
          {profile.role === "super_admin" && (
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/admin"
                className="rounded bg-rust-cyan/20 px-3 py-2 text-sm font-medium text-rust-cyan hover:bg-rust-cyan/30"
              >
                Super Admin Dashboard →
              </Link>
              <Link
                href="/admin/users"
                className="rounded bg-zinc-700 px-3 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-600"
              >
                Manage users & roles →
              </Link>
            </div>
          )}
        </div>
    </div>
  );
}
