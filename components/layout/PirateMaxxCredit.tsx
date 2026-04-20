"use client";

import Image from "next/image";
import Link from "next/link";

const PIRATE_MAXX_HREF = "https://piratemaxx.com";

export type PirateMaxxCreditVariant = "marketing" | "dashboard" | "compact";

type Props = {
  variant?: PirateMaxxCreditVariant;
  className?: string;
};

/** Pirate Maxx branding — use in marketing footers, dashboard footers, and auth pages. */
export function PirateMaxxCredit({ variant = "marketing", className = "" }: Props) {
  const textClass =
    variant === "marketing"
      ? "text-sm leading-relaxed sm:text-base"
      : "text-xs leading-relaxed sm:text-sm";
  const logoClass =
    variant === "marketing"
      ? "h-14 w-auto max-h-[4.5rem] sm:h-16 sm:max-h-[5rem]"
      : variant === "dashboard"
        ? "h-11 w-auto max-h-12 sm:h-12"
        : "h-9 w-auto max-h-10 sm:h-10";

  return (
    <div
      className={`flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-center sm:gap-6 sm:text-left ${className}`}
    >
      <Link
        href={PIRATE_MAXX_HREF}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust-cyan"
      >
        <Image
          src="/marketing/pirate-maxx-footer.png"
          alt="Pirate Maxx"
          width={583}
          height={527}
          className={`${logoClass} w-auto max-w-[min(260px,88vw)] object-contain object-center`}
          sizes="260px"
        />
      </Link>
      <p className={`max-w-xl text-zinc-500 ${textClass}`}>
        All sites and systems built by and maintained by{" "}
        <Link
          href={PIRATE_MAXX_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-rust-cyan underline-offset-2 hover:text-rust-cyan hover:underline"
        >
          PirateMaxx.com
        </Link>
      </p>
    </div>
  );
}
