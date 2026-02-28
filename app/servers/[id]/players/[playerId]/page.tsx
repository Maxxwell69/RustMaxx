"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";

const GIVE_ITEMS = [
  { shortname: "wood", label: "Wood", amount: 1000 },
  { shortname: "stones", label: "Stones", amount: 1000 },
  { shortname: "metal.ore", label: "Metal Ore", amount: 500 },
  { shortname: "sulfur.ore", label: "Sulfur Ore", amount: 500 },
  { shortname: "metal.fragments", label: "Metal Fragments", amount: 1000 },
  { shortname: "hq.metal.ore", label: "HQ Metal Ore", amount: 500 },
  { shortname: "scrap", label: "Scrap", amount: 100 },
  { shortname: "gun.powder", label: "Gunpowder", amount: 500 },
  { shortname: "cloth", label: "Cloth", amount: 100 },
  { shortname: "leather", label: "Leather", amount: 50 },
  { shortname: "syringe", label: "Syringe", amount: 5 },
  { shortname: "bandage", label: "Bandage", amount: 10 },
  { shortname: "rifle.ak", label: "AK-47", amount: 1 },
  { shortname: "ammo.rifle", label: "5.56 Ammo", amount: 128 },
  { shortname: "ammo.pistol", label: "Pistol Ammo", amount: 64 },
  { shortname: "explosive.timed", label: "C4", amount: 1 },
  { shortname: "rocket.basic", label: "Rocket", amount: 2 },
  { shortname: "building.planner", label: "Building Plan", amount: 1 },
  { shortname: "hammer", label: "Hammer", amount: 1 },
  { shortname: "hatchet", label: "Hatchet", amount: 1 },
  { shortname: "pickaxe", label: "Pickaxe", amount: 1 },
  { shortname: "torch", label: "Torch", amount: 1 },
  { shortname: "spear.wooden", label: "Wooden Spear", amount: 1 },
  { shortname: "bow.hunting", label: "Hunting Bow", amount: 1 },
  { shortname: "arrow.hunting", label: "Arrow", amount: 20 },
];

function PlayerContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const serverId = params.id as string;
  const playerId = params.playerId as string;
  const name = searchParams.get("name") || playerId;
  const [server, setServer] = useState<{ name: string } | null>(null);
  const [giving, setGiving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/servers/${serverId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setServer)
      .catch(() => setServer(null));
  }, [serverId]);

  async function giveItem(shortname: string, amount: number) {
    setMessage(null);
    setGiving(shortname);
    try {
      const cmd = `inventory.giveto ${playerId} \"${shortname}\" ${amount}`;
      const res = await fetch(`/api/servers/${serverId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage({ type: "ok", text: data.response ? String(data.response) : `Sent: ${shortname} x${amount}` });
      } else {
        setMessage({ type: "error", text: data.error ?? "Failed" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setGiving(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/servers/${serverId}`} className="text-amber-500 hover:underline">
          ← {server?.name ?? "Server"}
        </Link>
        <span className="text-zinc-500">/</span>
        <h1 className="text-xl font-semibold text-zinc-100">{name}</h1>
        <span className="text-sm text-zinc-500">({playerId})</span>
      </div>

      <p className="text-sm text-zinc-500">
        Give items to this player. Uses <code className="rounded bg-zinc-800 px-1">inventory.giveto</code> (Rust). Server must be connected.
      </p>

      {message && (
        <p className={`text-sm ${message.type === "ok" ? "text-emerald-400" : "text-red-400"}`}>
          {message.text}
        </p>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 text-lg font-medium text-zinc-300">Give items</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {GIVE_ITEMS.map((item) => (
            <li
              key={item.shortname}
              className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2"
            >
              <span className="text-zinc-200">
                {item.label} <span className="text-zinc-500 text-xs">×{item.amount}</span>
              </span>
              <button
                type="button"
                onClick={() => giveItem(item.shortname, item.amount)}
                disabled={giving !== null}
                className="rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {giving === item.shortname ? "…" : "Give"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function PlayerPage() {
  return (
    <Suspense fallback={<div className="p-4 text-zinc-500">Loading…</div>}>
      <PlayerContent />
    </Suspense>
  );
}
