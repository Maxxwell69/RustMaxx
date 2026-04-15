"use client";

import { useEffect, useRef, useState } from "react";

function revokeBlobUrl(ref: React.MutableRefObject<string | null>) {
  if (ref.current) {
    URL.revokeObjectURL(ref.current);
    ref.current = null;
  }
}

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
  const blobUrlRef = useRef<string | null>(null);
  const [localPickPreview, setLocalPickPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [remoteBroken, setRemoteBroken] = useState(false);

  const previewSrc = localPickPreview ?? (value.trim() || null);

  useEffect(() => {
    return () => revokeBlobUrl(blobUrlRef);
  }, []);

  useEffect(() => {
    setRemoteBroken(false);
  }, [value]);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    revokeBlobUrl(blobUrlRef);
    const objectUrl = URL.createObjectURL(file);
    blobUrlRef.current = objectUrl;
    setLocalPickPreview(objectUrl);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Upload failed");
        revokeBlobUrl(blobUrlRef);
        setLocalPickPreview(null);
        return;
      }
      if (data.url) {
        revokeBlobUrl(blobUrlRef);
        setLocalPickPreview(null);
        onChange(data.url);
      }
    } catch {
      setError("Network error");
      revokeBlobUrl(blobUrlRef);
      setLocalPickPreview(null);
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
          onChange={(e) => {
            setError("");
            onChange(e.target.value);
          }}
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
      <div className="mt-3">
        <p className="mb-1.5 text-xs font-medium text-zinc-500">Preview</p>
        {previewSrc ? (
          <div className="relative inline-flex overflow-hidden rounded-lg border border-zinc-600 bg-zinc-950 shadow-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewSrc}
              alt=""
              className={`h-36 w-36 object-cover sm:h-40 sm:w-40 ${uploading ? "opacity-60" : ""}`}
              onError={() => setRemoteBroken(true)}
              onLoad={() => setRemoteBroken(false)}
            />
            {uploading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/70 text-xs font-medium text-rust-cyan">
                Uploading…
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex h-36 w-36 items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-zinc-900/80 text-center text-xs text-zinc-600 sm:h-40 sm:w-40">
            Choose a file or paste a URL to see a preview here.
          </div>
        )}
        {previewSrc && remoteBroken && !localPickPreview ? (
          <p className="mt-1.5 text-xs text-amber-400/90">
            Image could not be loaded (check the URL or that the file exists on the server).
          </p>
        ) : null}
      </div>
    </div>
  );
}
