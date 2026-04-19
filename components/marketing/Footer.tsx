import Link from "next/link";
import { Logo } from "./Logo";

const FOOTER_PRODUCT = [
  { href: "/features", label: "Features" },
  { href: "/maxxinvaders", label: "MaxxInvaders" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/contact", label: "Contact" },
];

const FOOTER_AUDIENCE = [
  { href: "/servers", label: "Dashboard" },
  { href: "/streamer/register", label: "Streamer application" },
  { href: "/streamers", label: "Streamers" },
  { href: "/viewer/superfan", label: "Superfans" },
];

const FOOTER_DISCOVER = [
  { href: "/server-list", label: "Server list" },
  { href: "/streamer-interaction", label: "Streamer interaction" },
  { href: "/about", label: "About" },
];

export function Footer() {
  return (
    <footer className="border-t border-rust-border bg-[#050607]">
      <div className="marketing-container py-14 sm:py-16">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          <div className="lg:col-span-1">
            <Link href="/" className="inline-block">
              <Logo
                className="h-16 w-auto"
                width={320}
                height={64}
                fallbackClassName="text-2xl font-bold text-rust-cyan"
              />
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-zinc-500">
              Server admins, streamers, and fans — invite, connect, and grow on one Rust command center.
            </p>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Product</h3>
            <ul className="mt-4 space-y-2.5">
              {FOOTER_PRODUCT.map(({ href, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="text-sm text-zinc-400 transition-colors hover:text-rust-cyan"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Get started</h3>
            <ul className="mt-4 space-y-2.5">
              {FOOTER_AUDIENCE.map(({ href, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="text-sm text-zinc-400 transition-colors hover:text-rust-cyan"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Discover</h3>
            <ul className="mt-4 space-y-2.5">
              {FOOTER_DISCOVER.map(({ href, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="text-sm text-zinc-400 transition-colors hover:text-rust-cyan"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-12 border-t border-rust-border pt-8">
          <p className="text-xs leading-relaxed text-zinc-600">
            RustMaxx is not affiliated with, endorsed by, or connected with Facepunch Studios or the official Rust
            game. &quot;Rust&quot; is a trademark of Facepunch Studios.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-600">
            Works with Oxide/uMod and common hosts. We do not claim official endorsement by Oxide or uMod.
          </p>
        </div>
      </div>
    </footer>
  );
}
