import type { ReactNode } from "react";

type Variant = "default" | "muted" | "spotlight";

const variantClass: Record<Variant, string> = {
  default: "marketing-section",
  muted: "marketing-section-muted",
  spotlight: "marketing-section-spotlight",
};

/**
 * Consistent vertical rhythm and backgrounds for marketing pages (home, features, etc.).
 */
export function MarketingSection({
  children,
  variant = "default",
  id,
  className = "",
  containerClassName = "",
}: {
  children: ReactNode;
  variant?: Variant;
  id?: string;
  /** Extra classes on the outer section */
  className?: string;
  /** Extra classes on the inner max-width wrapper */
  containerClassName?: string;
}) {
  return (
    <section id={id} className={`${variantClass[variant]} ${className}`.trim()}>
      <div className={`marketing-container ${containerClassName}`.trim()}>{children}</div>
    </section>
  );
}
