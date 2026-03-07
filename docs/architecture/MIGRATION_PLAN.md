# RustMaxx Monorepo – Migration Plan

Safe, step-by-step plan to evolve the current repo into the Twitch-integration monorepo.

---

## Phase 1: Add workspace and new packages (non-breaking)

1. **Add pnpm workspace**
   - Create `pnpm-workspace.yaml` with `apps/*`, `packages/*`, `services/*`.
   - Create root `package.json` with scripts: `dev`, `build`, `lint`, `typecheck` (and optionally `migrate`, `generate:items` delegating to `apps/web` or current root).

2. **Create packages**
   - `packages/config` – env validation, no dependencies on app code.
   - `packages/shared` – TypeScript types for plugin auth, heartbeat, gateway commands, Twitch events.
   - `packages/database` – DB client wrapper and schema proposal; can depend on `@rustmaxx/config`.

3. **Keep existing app at repo root**
   - Leave `app/`, `components/`, `lib/`, `db/`, `scripts/` at root so current `pnpm dev` / `next dev` still works.
   - Root `package.json` stays the main Next.js app until Phase 2.

---

## Phase 2: Scaffold new services (no move yet)

4. **Scaffold `apps/api`**
   - Node + TypeScript (Express or Fastify).
   - Health route, auth module placeholder, server registration placeholder, Twitch module placeholder, event rules placeholder.
   - Use `@rustmaxx/config` and `@rustmaxx/shared` (and optionally `@rustmaxx/database`).

5. **Scaffold `services/realtime-gateway`**
   - WebSocket server, connection auth stub, heartbeat handling, command dispatch interface.
   - Use `@rustmaxx/shared` for message types.

6. **Scaffold `plugins/RustMaxxCore`**
   - C# uMod/Oxide plugin: placeholders for WebSocket client, auth handshake, command dispatcher, heartbeat sender.

7. **Add architecture docs**
   - `docs/architecture/` with WHY_WEBSOCKET, WHY_PLUGIN_INTEGRATION, WHY_WHITELIST_ACTIONS.

---

## Phase 3: Optional – Move Next.js app into `apps/web`

8. **Create `apps/web` and move code**
   - Create `apps/web/`.
   - Move `app/`, `components/`, `lib/`, `public/` into `apps/web/`.
   - Move `next.config.js`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.js`, `next-env.d.ts` into `apps/web/`.
   - Move `db/`, `scripts/` to root (shared) or under `apps/web` (if web-only).
   - Add `apps/web/package.json` (name: `@rustmaxx/web`, dependencies same as current root).
   - Update `apps/web/tsconfig.json` paths so `@/*` points to `./*` within `apps/web`.

9. **Root becomes workspace root only**
   - Root `package.json` becomes workspace root only: workspaces, scripts that run `pnpm -r run dev` or `pnpm --filter @rustmaxx/web dev`, etc.
   - Remove duplicate dependencies from root; install from `apps/web` via workspace.

10. **Update CI and deployment**
    - Railway / Nixpacks: build and start `apps/web` (or `apps/api`, `services/realtime-gateway` per service).
    - Adjust `nixpacks.toml` / build commands to use `pnpm install` and `pnpm --filter @rustmaxx/web build` (or equivalent).

---

## Phase 4: Integrate shared code (after Phase 2–3)

11. **Use shared packages in web and api**
    - Replace local types in `apps/web` with imports from `@rustmaxx/shared` where applicable.
    - Use `@rustmaxx/config` in api and gateway for env validation.
    - Use `@rustmaxx/database` in api (and optionally web) for DB access.

12. **Database schema**
    - Add migrations for: `server_connections`, `twitch_accounts`, `streamer_server_links`, `event_rules`, `event_logs`, `command_logs` (see schema proposal in `packages/database` or `docs/architecture`).
    - Run migrations from a single place (e.g. root or `packages/database`).

---

## Summary

| Phase | Action | Breaks existing app? |
|-------|--------|------------------------|
| 1 | Add workspace + packages | No |
| 2 | Scaffold api, gateway, plugin, docs | No |
| 3 | Move app to `apps/web` | Yes (paths, build) – do when ready |
| 4 | Use shared packages in web/api | Only if you change imports |

Recommendation: **Commit Phase 1 + 2 on the Integration branch** so the repo has the full scaffolding and docs; do Phase 3 (move to `apps/web`) in a follow-up PR when you are ready to adjust deployment and paths.
