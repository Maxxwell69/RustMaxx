"use client";

import { useEffect, useState } from "react";
import { logoUrlForImgSrc } from "@/lib/upload-files";

function initialsFrom(label: string): string {
  const t = label.trim();
  if (!t) return "?";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return t.slice(0, 2).toUpperCase();
}

export function ServerLogo({
  url,
  alt = "",
  fallbackLabel,
  frameClassName = "h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-rust-border bg-rust-panel",
  imgClassName = "h-full w-full object-cover",
}: {
  url: string | null | undefined;
  alt?: string;
  /** Shown when there is no URL, or when the image fails (e.g. missing file after deploy). */
  fallbackLabel?: string;
  frameClassName?: string;
  imgClassName?: string;
}) {
  const src = logoUrlForImgSrc(url?.trim() || "") ?? null;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const placeholder = (
    <div
      className={`${frameClassName} flex items-center justify-center bg-zinc-800`}
      title={failed ? "Logo image missing or failed to load" : undefined}
    >
      <span className="select-none text-sm font-semibold text-zinc-400">
        {initialsFrom(fallbackLabel ?? alt ?? "")}
      </span>
    </div>
  );

  if (!src) {
    const show = Boolean((fallbackLabel ?? "").trim()) || Boolean((alt ?? "").trim());
    return show ? placeholder : null;
  }

  if (failed) {
    return placeholder;
  }

  return (
    <div className={frameClassName}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={imgClassName}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
