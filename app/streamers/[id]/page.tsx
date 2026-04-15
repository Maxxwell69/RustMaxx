"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

type PublicSocial = {
  key: string;
  label: string;
  type: "link" | "text";
  value: string;
};

type PublicServer = { id: string; name: string };

type PublicProfile = {
  id: string;
  display_name: string | null;
  stream_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  directory_visible: boolean;
  application_approved: boolean;
  is_self: boolean;
  socials: PublicSocial[];
  servers: PublicServer[];
  show_servers_on_profile: boolean;
};

export default function StreamerPublicProfilePage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  /** `undefined` while loading, `null` if missing or error, otherwise the public row. */
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);

  useEffect(() => {
    if (!id) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    setProfile(undefined);
    fetch(`/api/streamers/${id}`)
      .then(async (r) => {
        if (r.status === 404) {
          if (!cancelled) setProfile(null);
          return;
        }
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.profile) {
          if (!cancelled) setProfile(null);
          return;
        }
        if (!cancelled) setProfile(data.profile as PublicProfile);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <MarketingLayout>
      <div className="relative px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-2xl">
          <p className="mb-6 text-sm">
            <Link href="/streamers" className="text-rust-cyan hover:underline">
              ← Streamers
            </Link>
          </p>

          {profile === undefined ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : profile === null ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
              <h1 className="text-xl font-semibold text-zinc-200">Profile not available</h1>
              <p className="mt-2 text-sm text-zinc-500">
                This page is hidden or does not exist. Streamers can preview their own profile from account settings even
                when hidden from the directory.
              </p>
              <Link href="/streamers" className="mt-4 inline-block text-sm text-rust-cyan hover:underline">
                Back to directory
              </Link>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-8">
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                {profile.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.avatar_url}
                    alt=""
                    width={96}
                    height={96}
                    className="h-24 w-24 shrink-0 rounded-full object-cover ring-2 ring-zinc-700"
                  />
                ) : (
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-2xl font-bold text-zinc-500 ring-2 ring-zinc-700">
                    {(profile.stream_name || profile.display_name || "?")[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="min-w-0 flex-1 text-center sm:text-left">
                  <h1 className="text-2xl font-bold text-zinc-100">
                    {profile.stream_name || profile.display_name || "Streamer"}
                  </h1>
                  {profile.display_name && profile.stream_name && profile.display_name !== profile.stream_name ? (
                    <p className="mt-1 text-sm text-zinc-500">{profile.display_name}</p>
                  ) : null}
                  {profile.is_self && !profile.directory_visible ? (
                    <p className="mt-2 text-xs text-amber-400/90">
                      Only you can see this preview. Turn on &quot;Show my profile&quot; in your RustMaxx profile to
                      appear in the public directory.
                    </p>
                  ) : null}
                </div>
              </div>

              {profile.socials.length > 0 ? (
                <div className="mt-8 border-t border-zinc-800 pt-6">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Links</h2>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {profile.socials.map((s) => (
                      <li key={s.key} className={s.key === "other_socials" ? "w-full basis-full" : ""}>
                        {s.type === "link" ? (
                          <a
                            href={s.value}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex rounded-full border border-zinc-600 bg-zinc-800/80 px-3 py-1 text-sm text-rust-cyan hover:border-rust-cyan/50 hover:bg-zinc-800"
                          >
                            {s.label}
                          </a>
                        ) : s.key === "other_socials" ? (
                          <div className="w-full rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-sm text-zinc-300">
                            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{s.label}</span>
                            <p className="mt-1 whitespace-pre-wrap text-zinc-300">{s.value}</p>
                          </div>
                        ) : (
                          <span className="inline-flex max-w-full rounded-full border border-zinc-700 bg-zinc-800/60 px-3 py-1 text-sm text-zinc-300">
                            <span className="shrink-0 text-zinc-500">{s.label}:</span>
                            <span className="ml-1 min-w-0 truncate" title={s.value}>
                              {s.value}
                            </span>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {profile.bio ? (
                <div className="mt-8 border-t border-zinc-800 pt-6">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">About</h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{profile.bio}</p>
                </div>
              ) : (
                <p className="mt-8 text-sm text-zinc-500">No public bio yet.</p>
              )}

              {profile.show_servers_on_profile && profile.servers.length > 0 ? (
                <div className="mt-8 border-t border-zinc-800 pt-6">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Servers on RustMaxx</h2>
                  <ul className="mt-3 space-y-2">
                    {profile.servers.map((s) => (
                      <li key={s.id}>
                        <Link
                          href={`/server-list/${s.id}`}
                          className="text-sm text-rust-cyan hover:underline"
                        >
                          {s.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : profile.is_self && profile.show_servers_on_profile && profile.servers.length === 0 ? (
                <div className="mt-8 border-t border-zinc-800 pt-6">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Servers on RustMaxx</h2>
                  <p className="mt-2 text-sm text-zinc-500">
                    You enabled this section, but you have no listed servers with approved streamer access yet. Get
                    approved on a server that appears on the{" "}
                    <Link href="/server-list" className="text-rust-cyan hover:underline">
                      server list
                    </Link>
                    .
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </MarketingLayout>
  );
}
