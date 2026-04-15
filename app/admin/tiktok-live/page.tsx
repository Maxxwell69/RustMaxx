"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Board = {
  id: string;
  scope_kind: string;
  name: string;
  is_enabled: boolean;
  is_default: boolean;
  server_id: string | null;
  user_id: string | null;
};

type Mapping = {
  id: string;
  event_type: string;
  event_key: string | null;
  min_value: number;
  server_action: string;
  priority: number;
  is_enabled: boolean;
};

export default function AdminTikTokLivePage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<string>("");
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [newBoardName, setNewBoardName] = useState("");

  async function loadBoards() {
    const res = await fetch("/api/tiktok-live/boards?includeTemplates=1&includeServers=1", {
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    const list = Array.isArray(data.boards) ? (data.boards as Board[]) : [];
    setBoards(list);
    if (!selectedBoard && list.length > 0) setSelectedBoard(list[0].id);
  }
  async function loadMappings(boardId: string) {
    if (!boardId) {
      setMappings([]);
      return;
    }
    const res = await fetch(`/api/tiktok-live/boards/${boardId}/mappings`, { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    setMappings(Array.isArray(data.mappings) ? (data.mappings as Mapping[]) : []);
  }

  useEffect(() => {
    loadBoards().catch(() => {});
  }, []);

  useEffect(() => {
    loadMappings(selectedBoard).catch(() => {});
  }, [selectedBoard]);

  async function createTemplateBoard() {
    setMsg(null);
    const res = await fetch("/api/tiktok-live/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        scopeKind: "admin_template",
        name: newBoardName.trim() || "Default admin template",
        isDefault: true,
        isEnabled: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(typeof data.error === "string" ? data.error : "Could not create board");
      return;
    }
    setMsg("Board created.");
    setNewBoardName("");
    await loadBoards();
  }

  async function addBasicMapping() {
    if (!selectedBoard) return;
    setMsg(null);
    const res = await fetch(`/api/tiktok-live/boards/${selectedBoard}/mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        eventType: "gift",
        eventKey: "Rose",
        minValue: 0,
        serverAction: "rose",
        priority: 10,
        isEnabled: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(typeof data.error === "string" ? data.error : "Could not create mapping");
      return;
    }
    setMsg("Sample mapping created.");
    await loadMappings(selectedBoard);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin" className="text-rust-cyan hover:underline">
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-100">TikTok Live (Direct)</h1>
      </div>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="text-lg text-zinc-100">Template boards</h2>
        <p className="text-sm text-zinc-500">
          Admin templates define default event-to-action behavior for streamers/servers.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={newBoardName}
            onChange={(e) => setNewBoardName(e.target.value)}
            placeholder="Template board name"
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
          />
          <button
            onClick={() => void createTemplateBoard()}
            className="rounded bg-rust-cyan px-3 py-1.5 text-sm font-medium text-zinc-950"
          >
            Create template board
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="text-lg text-zinc-100">Boards</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {boards.map((b) => (
            <button
              key={b.id}
              onClick={() => setSelectedBoard(b.id)}
              className={`rounded border px-3 py-2 text-left text-sm ${
                selectedBoard === b.id
                  ? "border-rust-cyan bg-rust-cyan/10 text-zinc-100"
                  : "border-zinc-700 bg-zinc-800 text-zinc-300"
              }`}
            >
              {b.name} · {b.scope_kind}
              {b.is_default ? " · default" : ""}
              {!b.is_enabled ? " · disabled" : ""}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg text-zinc-100">Mappings ({mappings.length})</h2>
          <button
            onClick={() => void addBasicMapping()}
            disabled={!selectedBoard}
            className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 disabled:opacity-50"
          >
            Add sample mapping
          </button>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400">
                <th className="py-2">Event type</th>
                <th>Event key</th>
                <th>Min</th>
                <th>Action</th>
                <th>Priority</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.id} className="border-b border-zinc-900 text-zinc-300">
                  <td className="py-2">{m.event_type}</td>
                  <td>{m.event_key ?? "(any)"}</td>
                  <td>{m.min_value}</td>
                  <td>{m.server_action}</td>
                  <td>{m.priority}</td>
                  <td>{m.is_enabled ? "yes" : "no"}</td>
                </tr>
              ))}
              {mappings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-3 text-zinc-500">
                    No mappings for this board yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {msg ? (
        <p className="rounded border border-amber-900/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
