"use client";

export function TerminalCard({
  children,
  className = "",
  title = "terminal",
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-lg border border-rust-border bg-rust-surface font-mono text-sm ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-rust-border bg-rust-panel px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-rust-danger" />
        <span className="h-2 w-2 rounded-full bg-rust-amber" />
        <span className="h-2 w-2 rounded-full bg-rust-green" />
        <span className="ml-2 text-xs text-zinc-500">{title}</span>
      </div>
      <div className="relative p-3">
        {children}
        <span
          className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-rust-cyan"
          aria-hidden
        />
      </div>
    </div>
  );
}
