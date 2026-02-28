"use client";

import { useState } from "react";

export type Pillar = "admin" | "stream" | "map";

const PILLARS: { id: Pillar; label: string; tagline: string }[] = [
  { id: "admin", label: "Admin Tools", tagline: "RCON, presets, roles, and audit logs in one place." },
  { id: "stream", label: "Stream Interaction", tagline: "Rewards, cooldowns, and safe viewer engagement." },
  { id: "map", label: "Live Map Intel", tagline: "Heatmaps, events, and raid awareness at a glance." },
];

export function PillarTabs({
  active,
  onChange,
}: {
  active: Pillar;
  onChange: (p: Pillar) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Product pillars">
      {PILLARS.map(({ id, label, tagline }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={active === id}
          aria-controls={`panel-${id}`}
          id={`tab-${id}`}
          onClick={() => onChange(id)}
          className={`rounded-lg border px-4 py-3 text-left transition-colors ${
            active === id
              ? "border-rust-cyan bg-rust-cyan/10 text-rust-cyan"
              : "border-rust-border bg-rust-surface text-zinc-400 hover:border-rust-mute hover:text-zinc-200"
          }`}
        >
          <span className="block font-medium">{label}</span>
          <span className="block text-xs opacity-80">{tagline}</span>
        </button>
      ))}
    </div>
  );
}

export function getPillarTagline(pillar: Pillar): string {
  return PILLARS.find((p) => p.id === pillar)?.tagline ?? "";
}
