"use client";

import { useState } from "react";

type LogoProps = {
  className?: string;
  width?: number;
  height?: number;
  fallbackClassName?: string;
};

export function Logo({ className = "", width, height, fallbackClassName = "text-xl font-bold text-rust-cyan" }: LogoProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <span className={fallbackClassName}>RustMaxx</span>;
  }

  return (
    <img
      src="/rustmaxx-logo.png"
      alt="RustMaxx"
      className={className}
      width={width}
      height={height}
      onError={() => setFailed(true)}
    />
  );
}
