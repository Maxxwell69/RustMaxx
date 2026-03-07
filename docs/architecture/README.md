# RustMaxx architecture

This folder documents the structure and design decisions for the RustMaxx monorepo and the Twitch-to-Rust streamer integration.

## Contents

| Document | Description |
|----------|-------------|
| [PROPOSED_STRUCTURE.md](./PROPOSED_STRUCTURE.md) | Target file and folder layout (apps, services, packages, plugins). |
| [MIGRATION_PLAN.md](./MIGRATION_PLAN.md) | Step-by-step migration from current repo to monorepo. |
| [WHY_WEBSOCKET.md](./WHY_WEBSOCKET.md) | Why WebSocket is used for the plugin–gateway link. |
| [WHY_PLUGIN_INTEGRATION.md](./WHY_PLUGIN_INTEGRATION.md) | Why we use a uMod/Oxide plugin for Rust server integration. |
| [WHY_WHITELIST_ACTIONS.md](./WHY_WHITELIST_ACTIONS.md) | Why actions are whitelisted and raw command execution is disallowed. |

## Stack

- **Web / Admin**: Next.js (TypeScript)
- **API**: Node + TypeScript (Express/Fastify)
- **Realtime**: WebSocket gateway (Node + TypeScript)
- **Plugin**: C# uMod/Oxide (Rust game server)
- **Database**: PostgreSQL
- **Deployment**: Railway (Nixpacks); modular so web, api, and gateway can be separate services.
