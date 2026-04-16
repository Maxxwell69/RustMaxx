"use client";

import { useEffect, useState } from "react";
import { logoUrlForImgSrc } from "@/lib/upload-files";

export function ServerLogo({
  url,
  alt = "",
  frameClassName = "h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-rust-border bg-rust-panel",
  imgClassName = "h-full w-full object-cover",
}: {
  url: string | null | undefined;
  alt?: string;
  frameClassName?: string;
  imgClassName?: string;
}) {
  const src = logoUrlForImgSrc(url?.trim() || "") ?? null;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) return null;

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
