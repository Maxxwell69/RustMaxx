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

type CatalogGift = { gift: string; suggestedAction: string };
type CatalogAction = { action: string; label: string; description: string };

export default function AdminTikTokLivePage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<string>("");
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [newBoardName, setNewBoardName] = useState("");
  const [catalogGifts, setCatalogGifts] = useState<CatalogGift[]>([]);
  const [catalogActions, setCatalogActions] = useState<CatalogAction[]>([]);
  const [eventType, setEventType] = useState("gift");
  const [eventKey, setEventKey] = useState("");
  const [serverAction, setServerAction] = useState("rose");
  const [minValue, setMinValue] = useState("0");
  const [priority, setPriority] = useState("10");

  async function loadCatalog() {
    const res = await fetch("/api/admin/tiktok-live/catalog", { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    const gifts = Array.isArray(data.gifts) ? (data.gifts as CatalogGift[]) : [];
    const actions = Array.isArray(data.actions) ? (data.actions as CatalogAction[]) : [];
    setCatalogGifts(gifts);
    setCatalogActions(actions);
    if (!eventKey && gifts[0]?.gift) setEventKey(gifts[0].gift);
    if (actions.length > 0) {
      const hasRose = actions.some((a) => a.action === "rose");
      setServerAction(hasRose ? "rose" : actions[0].action);
    }
  }

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
    loadCatalog().catch(() => {});
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

  async function createMappingFromBuilder() {
    if (!selectedBoard) return;
    setMsg(null);
    const min = Number.parseInt(minValue, 10);
    const pri = Number.parseInt(priority, 10);
    const res = await fetch(`/api/tiktok-live/boards/${selectedBoard}/mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        eventType,
        eventKey: eventKey.trim() || null,
        minValue: Number.isFinite(min) ? Math.max(0, min) : 0,
        serverAction,
        priority: Number.isFinite(pri) ? pri : 10,
        isEnabled: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(typeof data.error === "string" ? data.error : "Could not create mapping");
      return;
    }
    setMsg("Mapping created.");
    await loadMappings(selectedBoard);
  }

  function pickGift(gift: string) {
    setEventType("gift");
    setEventKey(gift);
    const suggested = catalogGifts.find((g) => g.gift === gift)?.suggestedAction;
    if (suggested && catalogActions.some((a) => a.action === suggested)) {
      setServerAction(suggested);
    }
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
        </div>
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <p className="mb-2 text-sm text-zinc-400">Create mapping (gift/event → Rust action)</p>
          <div className="grid gap-2 sm:grid-cols-5">
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
            >
              <option value="gift">gift</option>
              <option value="like">like</option>
              <option value="follow">follow</option>
              <option value="share">share</option>
              <option value="subscribe">subscribe</option>
              <option value="chat">chat</option>
              <option value="join">join</option>
            </select>
            <input
              value={eventKey}
              onChange={(e) => setEventKey(e.target.value)}
              placeholder="Event/Gift key (e.g. Rose)"
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 sm:col-span-2"
            />
            <select
              value={serverAction}
              onChange={(e) => setServerAction(e.target.value)}
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 sm:col-span-2"
            >
              {catalogActions.map((a) => (
                <option key={a.action} value={a.action}>
                  {a.label} ({a.action})
                </option>
              ))}
            </select>
            <input
              value={minValue}
              onChange={(e) => setMinValue(e.target.value)}
              placeholder="Min value"
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
            />
            <input
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              placeholder="Priority"
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100"
            />
            <button
              onClick={() => void createMappingFromBuilder()}
              disabled={!selectedBoard}
              className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 disabled:opacity-50 sm:col-span-3"
            >
              Add mapping
            </button>
          </div>
          <div className="mt-3">
            <p className="mb-1 text-xs text-zinc-500">Gift quick-pick</p>
            <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto rounded border border-zinc-800 bg-zinc-900/50 p-2">
              {catalogGifts.slice(0, 120).map((g) => (
                <button
                  key={g.gift}
                  type="button"
                  onClick={() => pickGift(g.gift)}
                  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
                  title={`Suggested action: ${g.suggestedAction}`}
                >
                  {g.gift}
                </button>
              ))}
              {catalogGifts.length === 0 ? (
                <span className="text-xs text-zinc-500">No gifts loaded.</span>
              ) : null}
            </div>
          </div>
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
