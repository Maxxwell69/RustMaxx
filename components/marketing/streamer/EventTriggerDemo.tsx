"use client";

import { useState, useEffect } from "react";

const EVENTS = [
  { label: "ViewerRedeem: Spawn Wolves", source: "channel_points" },
  { label: "Bits: Supply Drop", source: "bits" },
  { label: "Sub: Helicopter Event", source: "sub" },
];

const ROTATE_MS = 3500;

export function EventTriggerDemo() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setActive((a) => (a + 1) % EVENTS.length);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="overflow-hidden rounded-lg border border-rust-border bg-rust-surface p-4">
      <div className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
        Event Trigger (demo)
      </div>
      <ul className="space-y-2" aria-live="polite">
        {EVENTS.map((ev, i) => (
          <li
            key={i}
            className={`flex items-center gap-2 rounded border px-3 py-2 transition-all duration-300 ${
              i === active
                ? "border-rust-cyan bg-rust-cyan/10 shadow-rust-glow-subtle"
                : "border-rust-border bg-rust-panel/50"
            }`}
          >
            {i === active && (
              <span
                className="h-2 w-2 rounded-full bg-rust-cyan animate-pulse"
                aria-hidden
              />
            )}
            <span className={i === active ? "text-rust-cyan font-medium" : "text-zinc-400"}>
              {ev.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
