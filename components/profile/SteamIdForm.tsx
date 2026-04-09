"use client";

import { useEffect, useState } from "react";
import type { AuthMePayload } from "@/lib/auth-me-payload";

type Props = {
  /** Current Steam64 from profile (null if unset). */
  initialSteamId: string | null;
  /** Called with full /api/auth/me payload after successful save. */
  onSaved: (payload: AuthMePayload) => void;
  /** Optional class on the outer wrapper. */
  className?: string;
};

export function SteamIdForm({ initialSteamId, onSaved, className = "" }: Props) {
  const [value, setValue] = useState(initialSteamId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setValue(initialSteamId ?? "");
  }, [initialSteamId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/profile/steam-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ steamId: value.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Save failed");
        return;
      }
      onSaved(data as AuthMePayload);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function clearSteam() {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/profile/steam-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ steamId: "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Clear failed");
        return;
      }
      setValue("");
      onSaved(data as AuthMePayload);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={className}>
      <form onSubmit={submit} className="space-y-2">
        <label className="block text-xs text-zinc-500">
          Steam64 ID (17 digits)
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="76561198…"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 17))}
            className="min-w-0 flex-1 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-100 placeholder-zinc-600"
          />
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-rust-cyan px-4 py-2 text-sm font-medium text-zinc-950 hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        <p className="text-xs text-zinc-600">
          Find it in Steam → your profile URL, or use a Steam ID lookup. Must be exactly 17 digits.
        </p>
        {error ? <p className="text-sm text-amber-400">{error}</p> : null}
      </form>
      {initialSteamId ? (
        <button
          type="button"
          onClick={() => void clearSteam()}
          disabled={saving}
          className="mt-2 text-xs text-zinc-500 underline hover:text-zinc-400 disabled:opacity-50"
        >
          Clear Steam ID
        </button>
      ) : null}
    </div>
  );
}
