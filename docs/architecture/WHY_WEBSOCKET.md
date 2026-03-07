# Why WebSocket for plugin connectivity

## Decision

The realtime link between Rust game servers (via the RustMaxxCore plugin) and the RustMaxx backend uses **WebSocket** instead of HTTP polling or long-polling.

## Rationale

1. **Low latency**  
   Commands (e.g. “give item”, “run whitelisted action”) and heartbeats need to be delivered quickly. WebSocket keeps a single long-lived connection, so there is no per-request connection overhead and the server can push as soon as an event or command is ready.

2. **Server push**  
   The backend must push commands and config updates to the plugin as soon as they are authorized (e.g. from a Twitch event or admin action). With polling, the plugin would have to keep asking “any new commands?” on an interval, which increases latency and load. WebSocket is designed for this push model.

3. **Efficiency**  
   One connection per server can carry both heartbeats and commands. Polling would require many repeated HTTP requests and responses for the same logical channel, increasing load on the gateway and the game server.

4. **Bidirectional**  
   The plugin sends auth, heartbeats, and status; the gateway sends commands and acks. A single WebSocket connection handles both directions cleanly.

5. **Widely supported**  
   WebSocket is supported in .NET (plugin) and Node (gateway), and fits Railway’s deployment model (single gateway process holding many connections).

## Alternatives considered

- **HTTP long-polling** – More complex (repeated requests, timeouts), higher latency, and no clear advantage over WebSocket for this use case.
- **Server-Sent Events (SSE)** – One-way (server → client). We need plugin → gateway (auth, heartbeat) as well, so we’d still need a second channel; WebSocket gives one bidirectional channel.
- **Raw TCP** – Would require custom framing and more security surface; WebSocket gives a standard, well-understood protocol and good library support.

## References

- Gateway implementation: `services/realtime-gateway`
- Plugin client: `plugins/RustMaxxCore`
