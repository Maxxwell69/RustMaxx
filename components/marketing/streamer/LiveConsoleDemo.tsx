"use client";

import { useState, useEffect } from "react";

const LINES = [
  { time: "14:32:01", msg: "[Twitch] viewer_alpha redeemed Spawn Wolves", type: "event" },
  { time: "14:32:01", msg: "> spawn wolf 3", type: "cmd" },
  { time: "14:32:02", msg: "Spawned 3 wolf at (1234, 56, 789)", type: "out" },
  { time: "14:32:15", msg: "[Twitch] bits: 500 from streamer_fan → Supply Drop", type: "event" },
  { time: "14:32:15", msg: "> supply.drop", type: "cmd" },
  { time: "14:32:16", msg: "Supply drop initiated.", type: "out" },
  { time: "14:32:28", msg: "[Cooldown] Spawn Wolves ready in 42s", type: "info" },
];

const CYCLE_MS = 4000;

export function LiveConsoleDemo() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % LINES.length);
    }, CYCLE_MS / LINES.length);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="overflow-hidden rounded-lg border border-rust-border bg-rust-surface font-mono text-sm">
      <div className="flex items-center gap-2 border-b border-rust-border bg-rust-panel px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-rust-danger" aria-hidden />
        <span className="h-2 w-2 rounded-full bg-rust-amber" aria-hidden />
        <span className="h-2 w-2 rounded-full bg-rust-green" aria-hidden />
        <span className="ml-2 text-xs text-zinc-500">live console (demo)</span>
      </div>
      <div className="relative max-h-[220px] overflow-hidden p-3">
        {LINES.map((line, i) => (
          <div
            key={i}
            className={`flex gap-2 transition-opacity duration-300 ${i === index ? "opacity-100" : "opacity-50"}`}
          >
            <span className="shrink-0 text-zinc-500">{line.time}</span>
            <span
              className={
                line.type === "cmd"
                  ? "text-rust-cyan"
                  : line.type === "event"
                    ? "text-rust-amber"
                    : line.type === "out"
                      ? "text-rust-green"
                      : "text-zinc-400"
              }
            >
              {line.msg}
            </span>
          </div>
        ))}
        <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-rust-cyan" aria-hidden />
      </div>
    </div>
  );
}
