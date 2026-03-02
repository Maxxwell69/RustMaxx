"use client";

import { useState } from "react";

type LogoProps = {
  className?: string;
  width?: number;
  height?: number;
  fallbackClassName?: string;
};

/** Inline SVG wordmark so logged-out view shows the same graphic logo (no plain lettering). */
function LogoSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 240 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <defs>
        <filter id="rust-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <text
        x="0"
        y="34"
        fill="#06b6d4"
        filter="url(#rust-glow)"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontWeight="bold"
        fontSize="32"
      >
        RustMaxx
      </text>
    </svg>
  );
}

/**
 * Prefer the image logo; only show SVG fallback after image fails to load.
 * Image is shown by default so the PNG is used as soon as it loads (no flash of lettering).
 */
export function Logo({
  className = "",
  width,
  height,
  fallbackClassName = "text-xl font-bold text-rust-cyan",
}: LogoProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        className={[className, "inline-flex items-center justify-center"].filter(Boolean).join(" ")}
      >
        <LogoSvg className="h-full w-auto max-w-full" />
      </span>
    );
  }

  return (
    <img
      src="/rustmaxx-logo.png"
      alt="RustMaxx"
      className={className}
      width={width}
      height={height}
      onError={() => setFailed(true)}
      loading="eager"
      decoding="async"
    />
  );
}
