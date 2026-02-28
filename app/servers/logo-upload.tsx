"use client";

import { useRef, useState } from "react";

export function LogoUpload({
  value,
  onChange,
  disabled,
  className = "",
}: {
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Upload failed");
        return;
      }
      if (data.url) onChange(data.url);
    } catch {
      setError("Network error");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="url"
          value={value}
          onChange={(e) => { setError(""); onChange(e.target.value); }}
          placeholder="https://… or upload below"
          disabled={disabled}
          className="flex-1 min-w-0 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 disabled:opacity-50"
        />
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          onChange={handleChange}
          disabled={disabled || uploading}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
          className="shrink-0 rounded border border-rust-cyan/50 bg-zinc-700 px-3 py-1.5 text-sm text-rust-cyan hover:border-rust-cyan hover:shadow-rust-glow-subtle disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Upload image"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {value && (
        <p className="mt-1 text-xs text-zinc-500">
          Preview: <img src={value} alt="" className="inline-block h-6 w-6 rounded object-cover align-middle" onError={() => {}} />
        </p>
      )}
    </div>
  );
}
