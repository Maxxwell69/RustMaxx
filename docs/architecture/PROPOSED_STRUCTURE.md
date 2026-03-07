# RustMaxx Monorepo – Proposed File & Folder Structure

This document describes the target layout for the Twitch-to-Rust streamer integration inside the existing RustMaxx repository.

```
rustmaxx/
├── apps/
│   ├── web/                    # Next.js web/admin app (existing app moved here)
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   ├── public/
│   │   ├── package.json
│   │   ├── next.config.js
│   │   └── tsconfig.json
│   │
│   └── api/                    # Node/TypeScript API backend
│       ├── src/
│       │   ├── index.ts
│       │   ├── routes/
│       │   │   ├── health.ts
│       │   │   ├── auth.ts
│       │   │   ├── servers.ts
│       │   │   ├── twitch.ts
│       │   │   └── event-rules.ts
│       │   └── middleware/
│       ├── package.json
│       └── tsconfig.json
│
├── services/
│   └── realtime-gateway/       # WebSocket gateway for Rust plugin connections
│       ├── src/
│       │   ├── index.ts
│       │   ├── server.ts
│       │   ├── auth.ts
│       │   ├── heartbeat.ts
│       │   └── commands.ts
│       ├── package.json
│       └── tsconfig.json
│
├── plugins/
│   └── RustMaxxCore/           # uMod/Oxide C# plugin for Rust game servers
│       ├── RustMaxxCore.cs
│       ├── RustMaxxCore.csproj
│       └── README.md
│
├── packages/
│   ├── shared/                 # Shared TypeScript types and constants
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── plugin-messages.ts
│   │   │   ├── gateway-messages.ts
│   │   │   └── twitch-events.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── database/               # DB client, migrations, schema (shared)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── client.ts
│   │   │   └── schema/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── config/                 # Env validation and shared config
│       ├── src/
│       │   ├── index.ts
│       │   └── env.ts
│       ├── package.json
│       └── tsconfig.json
│
├── docs/
│   └── architecture/           # Architecture decision records
│       ├── README.md
│       ├── PROPOSED_STRUCTURE.md
│       ├── MIGRATION_PLAN.md
│       ├── WHY_WEBSOCKET.md
│       ├── WHY_PLUGIN_INTEGRATION.md
│       └── WHY_WHITELIST_ACTIONS.md
│
├── db/                         # Migrations (shared; can move under packages/database later)
│   └── migrations/
│
├── pnpm-workspace.yaml
├── package.json                # Root scripts: dev, build, lint, typecheck
├── .env.example
└── README.md
```

## Workspace packages

| Path | Package name | Purpose |
|------|--------------|---------|
| `apps/web` | `@rustmaxx/web` | Next.js app (admin, streamer UI) |
| `apps/api` | `@rustmaxx/api` | REST API for auth, servers, Twitch, event rules |
| `services/realtime-gateway` | `@rustmaxx/realtime-gateway` | WebSocket server for plugin connections |
| `packages/shared` | `@rustmaxx/shared` | Types for plugin/gateway/Twitch |
| `packages/database` | `@rustmaxx/database` | PostgreSQL client and schema |
| `packages/config` | `@rustmaxx/config` | Env validation and config |

`plugins/RustMaxxCore` is a C# project (uMod/Oxide), not a pnpm workspace member.
