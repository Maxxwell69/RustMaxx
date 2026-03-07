# Review before commit (Integration branch)

After scaffolding the Twitch-integration monorepo, manually review the following before merging.

## 1. Workspace install

- Run `pnpm install` at repo root. Ensure no resolution errors.
- Build packages: `pnpm run build:packages`. Fix any TypeScript errors in `packages/*`.

## 2. Existing app

- Confirm the current Next.js app still runs: `pnpm dev` and open the site.
- No changes were made to `app/`, `components/`, `lib/` in this scaffold; only new folders and root scripts were added.

## 3. API and gateway

- Build shared first: `pnpm --filter @rustmaxx/shared build`, then `pnpm --filter @rustmaxx/config build`.
- Run API: `pnpm run dev:api`. Hit `http://localhost:3001/health` (or `API_PORT`).
- Run gateway: set `GATEWAY_SECRET` and `GATEWAY_PORT`, then `pnpm run dev:gateway`. Connect with a test WebSocket client and send auth/heartbeat JSON to verify.

## 4. Environment variables

- `.env.example`: add `GATEWAY_SECRET`, `GATEWAY_PORT`, `API_PORT` if not present.
- Do not commit real secrets; ensure `.env` remains in `.gitignore`.

## 5. Database schema

- `packages/database/src/schema/proposal-integration.sql` is a **proposal**. Do not run it blindly; integrate into your migration flow (e.g. new migration file under `db/migrations/`) when ready, and adjust table names if they conflict with existing schema.

## 6. RustMaxxCore plugin

- `plugins/RustMaxxCore` is C# scaffold with placeholders. It references Oxide/uMod types (`RustPlugin`, etc.); build only in an environment where Oxide is available, or treat as reference and implement WebSocket client and dispatcher when ready.

## 7. Deployment (Railway)

- Current Nixpacks/railway config targets the root Next.js app. When you add API or gateway as separate services, add separate Railway services and point each to the correct workspace package (`apps/api`, `services/realtime-gateway`) with appropriate build/start commands and env vars.

## 8. Lint and typecheck

- Run `pnpm lint` and `pnpm typecheck` at root. Fix any new issues in modified or new files.
