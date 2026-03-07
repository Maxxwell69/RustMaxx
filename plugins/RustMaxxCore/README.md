# RustMaxxCore

uMod/Oxide plugin for Rust game servers. Connects to the RustMaxx realtime gateway over WebSocket to receive whitelist commands (e.g. give item, run effect) triggered by Twitch events or the web app.

## Placeholders (scaffold)

- **WebSocket client** – Connect to `GATEWAY_URL` (e.g. `wss://gateway.rustmaxx.example`).
- **Auth handshake** – On connect, send `{ type: "auth", serverId, token }`; expect `auth_ok` or `auth_fail`.
- **Heartbeat** – Every 30s send `{ type: "heartbeat", serverId, at }`.
- **Command dispatcher** – On `{ type: "command", id, payload }`, run the whitelisted action and send `{ type: "ack", commandId, status, at }`.

## Install

1. Build or copy `RustMaxxCore.cs` into your server’s `Rust/oxide/plugins/` folder.
2. Configure in RustMaxx web: register the server and obtain a connection token.
3. Set plugin config (or convars) with gateway URL, server ID, and token.

## Security

- Only whitelisted actions are implemented in code; there is no execution of raw RCON or arbitrary commands from the gateway.
- Token must be kept secret; the gateway validates it before accepting commands.

## References

- Gateway: `services/realtime-gateway`
- Shared types: `packages/shared`
- Architecture: `docs/architecture/`
