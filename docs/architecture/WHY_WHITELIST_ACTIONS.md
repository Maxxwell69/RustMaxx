# Why whitelist-based actions instead of raw commands

## Decision

The system uses a **whitelist-based action model**: only predefined actions (e.g. “give item X”, “run effect Y”) can be triggered by Twitch events or the API. There is no path for executing arbitrary RCON or shell commands from the web app or event pipeline.

## Rationale

1. **Security**  
   Raw command execution is high risk: a misconfiguration or compromised token could run anything on the game server. Whitelisting restricts the attack surface to a fixed set of implemented actions, each with explicit parameters (e.g. item shortname, amount).

2. **Auditability**  
   Every whitelisted action can be logged with a clear name and payload. There are no opaque “command string” logs that are hard to review or reproduce.

3. **Stability**  
   Plugin code implements each action with type-safe parameters and server-side checks. Invalid or malicious payloads can be rejected without ever reaching the game’s command layer.

4. **Maintainability**  
   New features are added by defining new action types and implementing them in the plugin and gateway. This keeps the contract explicit and avoids “stringly typed” command parsing.

5. **Compliance with constraints**  
   The project explicitly disallows “raw RCON command execution paths”. A whitelist model enforces that at the design level.

## Implementation

- **Gateway** – Dispatches only known message types (e.g. `command: "give_item"`, `params: { shortname, amount }`). Unknown or malformed commands are rejected.
- **Plugin** – Has a command dispatcher that maps action IDs to handler methods. No generic “run(string)” path.
- **API / Web** – Event rules reference action IDs (and parameters), not free-form command strings.
- **Database** – `event_rules` and `command_logs` store action identifiers and structured payloads, not raw command text.

## References

- Shared types: `packages/shared` (gateway command messages, acks)
- Gateway: `services/realtime-gateway`
- Plugin: `plugins/RustMaxxCore`
