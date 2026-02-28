const BULLETS = [
  "Secure webhook verification",
  "HMAC signed server execution",
  "Permission-based reward mapping",
  "Server-side validation",
  "Full audit trail",
];

export function SecurityCallout() {
  return (
    <section className="border-b border-rust-border bg-rust-surface/50 px-4 py-12 sm:px-6 sm:py-16" aria-labelledby="security-heading">
      <div className="mx-auto max-w-3xl">
        <h2 id="security-heading" className="text-center text-2xl font-bold text-zinc-100 sm:text-3xl">
          Security + Trust
        </h2>
        <p className="mt-6 text-center text-xl font-semibold text-zinc-200 sm:text-2xl">
          Built for server owners, not chaos merchants.
        </p>
        <ul className="mt-8 space-y-3">
          {BULLETS.map((b, i) => (
            <li key={i} className="flex items-center gap-2 text-zinc-300">
              <span className="h-2 w-2 rounded-full bg-rust-green" aria-hidden />
              {b}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
