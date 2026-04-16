"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function ViewerInteractPage() {
  const params = useParams();
  const streamerId = typeof params.streamerId === "string" ? params.streamerId : "";
  const [state, setState] = useState<"load" | "deny" | "ok">("load");

  useEffect(() => {
    if (!streamerId) {
      setState("deny");
      return;
    }
    let cancelled = false;
    fetch(`/api/viewer/superfan/access?streamer_id=${encodeURIComponent(streamerId)}`)
      .then((r) => {
        if (!r.ok) {
          if (!cancelled) setState("deny");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data?.allowed === true) setState("ok");
        else setState("deny");
      })
      .catch(() => {
        if (!cancelled) setState("deny");
      });
    return () => {
      cancelled = true;
    };
  }, [streamerId]);

  if (state === "load") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <p className="text-sm text-zinc-500">Loading…</p>
      </div>
    );
  }

  if (state === "deny") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-xl font-semibold text-zinc-100">Access required</h1>
        <p className="mt-2 text-sm text-zinc-400">
          You need an approved superfan request for this streamer. Apply from the{" "}
          <Link href="/viewer/superfan" className="text-rust-cyan hover:underline">
            viewer superfan
          </Link>{" "}
          page and the streamer&apos;s public profile.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <p className="text-sm text-zinc-500">
        <Link href="/viewer/superfan" className="text-rust-cyan hover:underline">
          ← Superfan home
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold text-zinc-100">Streamer interaction</h1>
      <p className="mt-2 text-sm text-zinc-400">
        You have access. Interactive actions for this streamer will appear here in a future update.
      </p>
      <div className="mt-8 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
        Placeholder — controls coming soon
      </div>
    </div>
  );
}
