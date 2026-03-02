"use client";

import { useState } from "react";

type LogoProps = {
  className?: string;
  width?: number;
  height?: number;
  fallbackClassName?: string;
};

/**
 * Renders "RustMaxx" as text by default so the site never shows a broken image
 * when /rustmaxx-logo.png is missing. If the image loads, it is shown instead.
 */
export function Logo({
  className = "",
  width,
  height,
  fallbackClassName = "text-xl font-bold text-rust-cyan",
}: LogoProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const showImage = loaded && !failed;

  return (
    <>
      {!showImage && (
        <span
          className={[className, "inline-flex items-center"].filter(Boolean).join(" ")}
          style={width && height ? { minWidth: width, minHeight: height } : undefined}
        >
          <span className={fallbackClassName}>RustMaxx</span>
        </span>
      )}
      <img
        src="/rustmaxx-logo.png"
        alt="RustMaxx"
        className={className}
        width={width}
        height={height}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        style={{ display: showImage ? undefined : "none" }}
        loading="eager"
      />
    </>
  );
}
