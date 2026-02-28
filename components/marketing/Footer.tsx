import Link from "next/link";
import { Logo } from "./Logo";

const FOOTER_LINKS = [
  { href: "/server-list", label: "Servers" },
  { href: "/streamer-interaction", label: "Streamer Interaction" },
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function Footer() {
  return (
    <footer className="border-t border-rust-border bg-rust-panel">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div>
            <Link href="/" className="inline-block">
              <Logo className="h-7 w-auto" width={140} height={28} fallbackClassName="text-lg font-bold text-rust-cyan" />
            </Link>
            <p className="mt-2 max-w-sm text-sm text-zinc-500">
              One command center for Rust servers. Admin tools, stream interaction, and live map intel.
            </p>
          </div>
          <nav className="flex flex-wrap gap-6" aria-label="Footer">
            {FOOTER_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-base text-rust-cyan transition-colors opacity-90 hover:opacity-100"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="mt-8 border-t border-rust-border pt-8">
          <p className="text-xs text-zinc-500">
            RustMaxx is not affiliated with, endorsed by, or connected with Facepunch Studios or the
            official Rust game. &quot;Rust&quot; is a trademark of Facepunch Studios.
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Works with Oxide/uMod and common hosts. We do not claim official endorsement by Oxide or
            uMod.
          </p>
        </div>
      </div>
    </footer>
  );
}
