"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

const WORLD_EVENTS = [
  { label: "Patrol helicopter", command: "heli.call", note: "Spawns attack helicopter." },
  { label: "Airdrop (random)", command: "supply.call", note: "May require in-game console on some servers." },
  { label: "Airdrop (center)", command: "supply.drop", note: "Drops at 0,0. May require in-game." },
];

const CARGO_SHIP = [
  { label: "Enable cargo ship event", command: "cargoship.event_enabled \"True\"", note: "Allows ship to spawn on its schedule." },
  { label: "Disable cargo ship event", command: "cargoship.event_enabled \"False\"", note: "Manual spawn (cargoshiptest) is in-game only." },
];

const ADD_TIME_EVENTS = [
  { label: "Advance +3h (trigger events)", command: "env.addtime 3", note: "Can trigger cargo plane, helicopter." },
];

function EventButton({
  label,
  command,
  note,
  running,
  onRun,
}: {
  label: string;
  command: string;
  note?: string;
  running: boolean;
  onRun: (cmd: string) => void;
}) {
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <span className="font-medium text-zinc-200">{label}</span>
        {note && <p className="text-xs text-zinc-500">{note}</p>}
      </div>
      <button
        type="button"
        onClick={() => onRun(command)}
        disabled={running}
        className="shrink-0 rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
      >
        {running ? "…" : "Trigger"}
      </button>
    </li>
  );
}

export default function EventsPage() {
  const params = useParams();
  const id = params.id as string;
  const [server, setServer] = useState<{ name: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/servers/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setServer)
      .catch(() => setServer(null));
  }, [id]);

  async function runCommand(command: string) {
    setMessage(null);
    setRunning(true);
    try {
      const res = await fetch(`/api/servers/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage({
          type: "ok",
          text: data.response ? String(data.response).trim() || "Done" : "Done",
        });
      } else {
        setMessage({ type: "error", text: data.error ?? "Failed" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/servers/${id}`} className="text-amber-500 hover:underline">
          ← {server?.name ?? "Server"}
        </Link>
        <span className="text-zinc-500">/</span>
        <h1 className="text-xl font-semibold text-zinc-100">Events</h1>
      </div>

      <p className="text-sm text-zinc-500">
        Trigger world events via RCON. Server must be connected. Some commands (e.g. airdrop, cargoshiptest) may only work from in-game console.
      </p>

      {message && (
        <p className={`text-sm ${message.type === "ok" ? "text-emerald-400" : "text-red-400"}`}>
          {message.text}
        </p>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 text-lg font-medium text-zinc-300">World events</h2>
        <ul className="space-y-2">
          {WORLD_EVENTS.map((e) => (
            <EventButton
              key={e.command}
              label={e.label}
              command={e.command}
              note={e.note}
              running={running}
              onRun={runCommand}
            />
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 text-lg font-medium text-zinc-300">Cargo ship</h2>
        <ul className="space-y-2">
          {CARGO_SHIP.map((e) => (
            <EventButton
              key={e.command}
              label={e.label}
              command={e.command}
              note={e.note}
              running={running}
              onRun={runCommand}
            />
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 text-lg font-medium text-zinc-300">Advance time (trigger events)</h2>
        <ul className="space-y-2">
          {ADD_TIME_EVENTS.map((e) => (
            <EventButton
              key={e.command}
              label={e.label}
              command={e.command}
              note={e.note}
              running={running}
              onRun={runCommand}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
