"use client";

import { useEffect, useState } from "react";

const LINES = [
  "[RCON] Connected to server 0.0.0.0:28082",
  "> status",
  "hostname: My Rust Server",
  "players : 12 / 100",
  "> playerlist",
  "[{\"SteamID\":\"7656119…\",\"DisplayName\":\"Player1\"}]",
  "> env.time 12",
  "env.time: \"12.00\"",
  "[Event] Cargo plane incoming",
];

export function LiveConsole() {
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setVisible((n) => (n + 1) % (LINES.length + 1));
    }, 1200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-[180px] font-mono text-xs">
      {LINES.slice(0, visible).map((line, i) => (
        <div key={i} className="text-zinc-500">
          <span className={line.startsWith(">") ? "text-rust-cyan" : "text-zinc-400"}>
            {line}
          </span>
        </div>
      ))}
    </div>
  );
}
