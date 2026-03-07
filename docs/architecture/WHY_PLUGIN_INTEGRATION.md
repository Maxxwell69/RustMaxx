# Why plugin-based integration for Rust servers

## Decision

Rust game servers integrate with RustMaxx via a **uMod/Oxide plugin (RustMaxxCore)** that runs on the server and talks to the realtime gateway over WebSocket. We do not rely on RCON alone for streamer/Twitch-driven actions.

## Rationale

1. **Controlled execution**  
   The plugin runs in the same process as the game server and can execute actions through the game’s API (e.g. give item, spawn, run whitelisted logic). This avoids sending raw RCON command strings and keeps execution in a single, auditable place (the plugin).

2. **No raw RCON command path**  
   Raw RCON is powerful and dangerous if exposed to event-driven or user-driven inputs. By using a plugin, we ensure that only whitelisted actions (implemented in code) can be triggered; there is no “execute arbitrary RCON” path from Twitch or the web app.

3. **State and context**  
   The plugin can maintain connection state, rate limits, and server-side checks. It can validate that a command is allowed for this server, this streamer, and this event type before doing anything.

4. **Consistency with existing RustMaxx model**  
   RustMaxx already uses RCON for read-only or well-scoped operations (e.g. map fetch, player list). Adding a dedicated plugin for Twitch/streamer actions keeps a clear boundary: RCON for admin tooling, plugin + gateway for event-driven, whitelisted actions.

5. **Extensibility**  
   New actions (new Twitch rewards, new event types) can be added as new whitelisted handlers in the plugin and corresponding message types in the gateway, without exposing a generic “run command” surface.

## Alternatives considered

- **RCON-only** – Would require sending command strings from the backend; easy to misconfigure or abuse (e.g. arbitrary commands). Rejected for security and maintainability.
- **External daemon on server** – More moving parts and deployment complexity than a single uMod plugin that server owners already know how to install.
- **Game server REST API** – Rust/official servers don’t expose a safe, standardized REST API for in-game actions; the plugin is the right integration point.

## References

- Plugin scaffold: `plugins/RustMaxxCore`
- Gateway: `services/realtime-gateway`
- Whitelist model: `docs/architecture/WHY_WHITELIST_ACTIONS.md`
