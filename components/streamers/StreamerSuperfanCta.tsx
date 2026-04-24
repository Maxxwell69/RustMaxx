"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type MeResponse = {
  site: { status: string } | null;
  streamers: { streamer_user_id: string; status: string }[];
};

function StreamerSuperfanRequestForm(props: {
  streamerId: string;
  streamerLabel: string;
  purchasedSubscription: "yes" | "no";
  setPurchasedSubscription: (value: "yes" | "no") => void;
  subscriptionPlatform: "" | "twitch" | "tiktok" | "site";
  setSubscriptionPlatform: (value: "" | "twitch" | "tiktok" | "site") => void;
  msg: string;
  setMsg: (value: string) => void;
  busy: boolean;
  submitRequest: () => void;
  buttonLabel: string;
}) {
  const {
    streamerId,
    streamerLabel,
    purchasedSubscription,
    setPurchasedSubscription,
    subscriptionPlatform,
    setSubscriptionPlatform,
    msg,
    setMsg,
    busy,
    submitRequest,
    buttonLabel,
  } = props;

  return (
    <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
      <div>
        <label className="block text-sm font-medium text-zinc-200">Did you purchase a subscription?</label>
        <div className="mt-2 flex flex-wrap gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="radio"
              name={`purchased-subscription-${streamerId}`}
              checked={purchasedSubscription === "yes"}
              onChange={() => setPurchasedSubscription("yes")}
            />
            <span>Yes</span>
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="radio"
              name={`purchased-subscription-${streamerId}`}
              checked={purchasedSubscription === "no"}
              onChange={() => {
                setPurchasedSubscription("no");
                setSubscriptionPlatform("");
              }}
            />
            <span>No</span>
          </label>
        </div>
      </div>

      {purchasedSubscription === "yes" && (
        <div>
          <label htmlFor={`subscription-platform-${streamerId}`} className="block text-sm font-medium text-zinc-200">
            If yes, on what platform?
          </label>
          <select
            id={`subscription-platform-${streamerId}`}
            value={subscriptionPlatform}
            onChange={(e) => setSubscriptionPlatform(e.target.value as "" | "twitch" | "tiktok" | "site")}
            className="mt-2 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
          >
            <option value="">Choose one</option>
            <option value="twitch">Twitch</option>
            <option value="tiktok">Tik Tok</option>
            <option value="site">From a site</option>
          </select>
        </div>
      )}

      <div>
        <label htmlFor={`superfan-notes-${streamerId}`} className="block text-sm font-medium text-zinc-200">
          Notes for {streamerLabel}
        </label>
        <textarea
          id={`superfan-notes-${streamerId}`}
          className="mt-2 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
          rows={2}
          placeholder="Optional note"
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
        />
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={submitRequest}
        className="rounded bg-rust-cyan px-4 py-2 text-sm font-medium text-rust-panel shadow-rust-glow hover:opacity-95 disabled:opacity-50"
      >
        {busy ? "…" : buttonLabel}
      </button>
    </div>
  );
}

export function StreamerSuperfanCta(props: {
  streamerId: string;
  streamerLabel: string;
  hideForSelf: boolean;
}) {
  const { streamerId, streamerLabel, hideForSelf } = props;
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined);
  const [msg, setMsg] = useState("");
  const [purchasedSubscription, setPurchasedSubscription] = useState<"yes" | "no">("no");
  const [subscriptionPlatform, setSubscriptionPlatform] = useState<"" | "twitch" | "tiktok" | "site">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => {
        if (!cancelled) setLoggedIn(r.ok);
        if (!r.ok) {
          if (!cancelled) setMe(null);
          return;
        }
        return fetch("/api/viewer/superfan/me").then((r2) => (r2.ok ? r2.json() : null));
      })
      .then((data) => {
        if (cancelled) return;
        setMe(data ? (data as MeResponse) : null);
      })
      .catch(() => {
        if (!cancelled) {
          setLoggedIn(false);
          setMe(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (hideForSelf) return null;

  const row = me?.streamers?.find((s) => s.streamer_user_id === streamerId);
  const siteStatus = me?.site?.status;

  function buildRequestMessage() {
    const lines = [
      `Purchased subscription: ${purchasedSubscription === "yes" ? "Yes" : "No"}`,
    ];
    if (purchasedSubscription === "yes") {
      lines.push(`Platform: ${subscriptionPlatform || "Not provided"}`);
    }
    if (msg.trim()) {
      lines.push("", `Notes: ${msg.trim()}`);
    }
    return lines.join("\n");
  }

  async function submitRequest() {
    setError("");
    if (purchasedSubscription === "yes" && !subscriptionPlatform) {
      setError("Choose where you purchased the subscription.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/viewer/superfan/streamer-request", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamer_id: streamerId, message: buildRequestMessage() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Request failed");
        return;
      }
      const r2 = await fetch("/api/viewer/superfan/me").then((r) => r.json());
      setMe(r2 as MeResponse);
      setMsg("");
      setPurchasedSubscription("no");
      setSubscriptionPlatform("");
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 border-t border-zinc-800 pt-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Superfans</h2>
      <h3 className="mt-2 text-lg font-semibold text-zinc-100">Become a Super fan of {streamerLabel}</h3>
      <p className="mt-2 text-sm text-zinc-400">
        Send your request here. Once {streamerLabel} approves you, you can use their{" "}
        <Link href={`/viewer/interact/${streamerId}`} className="text-rust-cyan hover:underline">
          fan boards
        </Link>
        .
      </p>

      {loggedIn === false && (
        <p className="mt-3 text-sm text-zinc-500">
          <Link href="/login" className="text-rust-cyan hover:underline">
            Log in
          </Link>{" "}
          to request access.
        </p>
      )}

      {loggedIn && me === undefined && <p className="mt-3 text-sm text-zinc-500">Loading…</p>}

      {loggedIn && me !== undefined && me !== null && (
        <div className="mt-4 space-y-3">
          {!siteStatus || siteStatus === "rejected" ? (
            <p className="text-sm text-amber-200/90">
              Become a RustMaxx super fan first:{" "}
              <Link href="/viewer/superfan" className="text-rust-cyan hover:underline">
                Open superfan setup
              </Link>
            </p>
          ) : siteStatus === "pending" ? (
            <div className="rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-3 text-sm text-zinc-300">
              <p className="font-medium text-zinc-200">Finish your RustMaxx superfan setup</p>
              <p className="mt-2 text-zinc-400">
                Open{" "}
                <Link href="/viewer/superfan" className="text-rust-cyan hover:underline">
                  Viewer superfans
                </Link>{" "}
                and complete the one-time activation, then return here to request {streamerLabel}.
              </p>
            </div>
          ) : siteStatus === "approved" && row?.status === "approved" ? (
            <p className="text-sm text-emerald-400">
              You have superfan access.{" "}
              <Link
                href={`/viewer/interact/${streamerId}`}
                className="font-medium text-rust-cyan hover:underline"
              >
                Open interaction page
              </Link>
            </p>
          ) : siteStatus === "approved" && row?.status === "pending" ? (
            <p className="text-sm text-zinc-400">Your request to {streamerLabel} is pending.</p>
          ) : siteStatus === "approved" && row?.status === "rejected" ? (
            <div className="space-y-2">
              <p className="text-sm text-zinc-500">This streamer declined a previous request. You can send another.</p>
              <StreamerSuperfanRequestForm
                streamerId={streamerId}
                streamerLabel={streamerLabel}
                purchasedSubscription={purchasedSubscription}
                setPurchasedSubscription={setPurchasedSubscription}
                subscriptionPlatform={subscriptionPlatform}
                setSubscriptionPlatform={setSubscriptionPlatform}
                msg={msg}
                setMsg={setMsg}
                busy={busy}
                submitRequest={submitRequest}
                buttonLabel="Request again"
              />
            </div>
          ) : siteStatus === "approved" && !row ? (
            <StreamerSuperfanRequestForm
              streamerId={streamerId}
              streamerLabel={streamerLabel}
              purchasedSubscription={purchasedSubscription}
              setPurchasedSubscription={setPurchasedSubscription}
              subscriptionPlatform={subscriptionPlatform}
              setSubscriptionPlatform={setSubscriptionPlatform}
              msg={msg}
              setMsg={setMsg}
              busy={busy}
              submitRequest={submitRequest}
              buttonLabel="Request superfan access"
            />
          ) : null}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      )}

      {loggedIn && me === null && (
        <p className="mt-3 text-sm text-amber-400">Could not load superfan status. Try refreshing.</p>
      )}
    </div>
  );
}
