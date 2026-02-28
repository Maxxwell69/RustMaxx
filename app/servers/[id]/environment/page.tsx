"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

const TIME_PRESETS = [
  { label: "Dawn", command: "env.time 6" },
  { label: "Noon", command: "env.time 12" },
  { label: "Dusk", command: "env.time 18" },
  { label: "Midnight", command: "env.time 0" },
];

const WEATHER = [
  { label: "Rain On", command: "env.rain 1" },
  { label: "Rain Off", command: "env.rain 0" },
  { label: "Fog On", command: "env.fog 1" },
  { label: "Fog Off", command: "env.fog 0" },
  { label: "Snow On", command: "env.snow 1" },
  { label: "Snow Off", command: "env.snow 0" },
  { label: "Clouds On", command: "env.clouds 1" },
  { label: "Clouds Off", command: "env.clouds 0" },
];

const TIME_CONTROL = [
  { label: "Pause time", command: "env.progresstime \"false\"" },
  { label: "Resume time", command: "env.progresstime \"true\"" },
];

const ADD_TIME = [
  { label: "+1 hour", command: "env.addtime 1" },
  { label: "+3 hours", command: "env.addtime 3" },
  { label: "+6 hours", command: "env.addtime 6" },
];

function EnvButton({
  label,
  command,
  running,
  onRun,
}: {
  label: string;
  command: string;
  running: boolean;
  onRun: (cmd: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onRun(command)}
      disabled={running}
      className="rounded-lg border border-rust-cyan/50 bg-zinc-800 px-3 py-2 text-sm font-medium text-rust-cyan hover:bg-zinc-700 hover:shadow-rust-glow-subtle disabled:opacity-50"
    >
      {running ? "…" : label}
    </button>
  );
}

export default function EnvironmentPage() {
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
        <Link href={`/servers/${id}`} className="text-rust-cyan hover:underline">
          ← {server?.name ?? "Server"}
        </Link>
        <span className="text-zinc-500">/</span>
        <h1 className="text-xl font-semibold text-zinc-100">Environment</h1>
      </div>

      <p className="text-sm text-zinc-500">
        Set time and weather. Commands run via RCON (<code className="rounded bg-zinc-800 px-1">env.*</code>). Server must be connected.
      </p>

      {message && (
        <p className={`text-sm ${message.type === "ok" ? "text-emerald-400" : "text-red-400"}`}>
          {message.text}
        </p>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 text-lg font-medium text-zinc-300">Time of day</h2>
        <div className="flex flex-wrap gap-2">
          {TIME_PRESETS.map((p) => (
            <EnvButton
              key={p.command}
              label={p.label}
              command={p.command}
              running={running}
              onRun={runCommand}
            />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 text-lg font-medium text-zinc-300">Weather</h2>
        <div className="flex flex-wrap gap-2">
          {WEATHER.map((w) => (
            <EnvButton
              key={w.command}
              label={w.label}
              command={w.command}
              running={running}
              onRun={runCommand}
            />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 text-lg font-medium text-zinc-300">Time progression</h2>
        <div className="flex flex-wrap gap-2">
          {TIME_CONTROL.map((t) => (
            <EnvButton
              key={t.command}
              label={t.label}
              command={t.command}
              running={running}
              onRun={runCommand}
            />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 text-lg font-medium text-zinc-300">Add time</h2>
        <p className="mb-2 text-xs text-zinc-500">
          Advance the clock (can trigger cargo plane, helicopter, etc.).
        </p>
        <div className="flex flex-wrap gap-2">
          {ADD_TIME.map((a) => (
            <EnvButton
              key={a.command}
              label={a.label}
              command={a.command}
              running={running}
              onRun={runCommand}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
