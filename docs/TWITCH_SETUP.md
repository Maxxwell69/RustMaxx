# Twitch integration setup

RustMaxx uses Twitch OAuth to link streamer accounts and EventSub webhooks to receive follow (and future) events. All Twitch logic runs in the backend; tokens are stored encrypted.

## 1. Create a Twitch application

1. Go to [Twitch Developer Console](https://dev.twitch.tv/console).
2. Log in and click **Register Your Application**.
3. Fill in:
   - **Name**: e.g. `RustMaxx`
   - **OAuth Redirect URLs**: add your callback URL, e.g. `https://yourdomain.com/api/twitch/callback` (must match `TWITCH_REDIRECT_URI` exactly).
   - **Category**: e.g. Website Integration.
4. After creating, open the app and copy the **Client ID** and create a **Client Secret**. Store the secret securely.

## 2. Environment variables

Set these in your deployment (e.g. Railway) and in local `.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `TWITCH_CLIENT_ID` | Yes | Application Client ID from Twitch console. |
| `TWITCH_CLIENT_SECRET` | Yes | Application Client Secret. Do not commit. |
| `TWITCH_REDIRECT_URI` | Yes | Exact redirect URL (e.g. `https://yourdomain.com/api/twitch/callback`). Must be listed in the Twitch app’s OAuth Redirect URLs. |
| `TWITCH_WEBHOOK_CALLBACK_URL` | Yes for EventSub | Public URL for EventSub (e.g. `https://yourdomain.com/api/twitch/webhook`). Must be HTTPS in production. |
| `TWITCH_EVENTSUB_SECRET` | Yes for EventSub | A random string you choose (e.g. 32+ chars). Used to verify webhook payloads; use the same value when creating subscriptions. |
| `ENCRYPTION_KEY` | Yes for token storage | At least 32 characters (or 32-byte hex). Used to encrypt access/refresh tokens in the database. |

## 3. Run database migrations

Ensure the Twitch integration migration has been applied:

```bash
pnpm migrate
```

This creates `twitch_accounts`, `streamer_server_links`, `event_rules`, and `event_logs` (see `db/migrations/010_twitch_integration.sql`).

## 4. User flow

1. User goes to **Profile** and clicks **Connect Twitch**.
2. They are sent to Twitch to authorize; Twitch redirects back to `TWITCH_REDIRECT_URI` with a code.
3. The backend exchanges the code for tokens, fetches the Twitch user, and stores encrypted tokens and broadcaster id/login/display name.
4. If `TWITCH_WEBHOOK_CALLBACK_URL` and `TWITCH_EVENTSUB_SECRET` are set, the backend creates an EventSub subscription for `channel.follow` for that broadcaster.
5. User can **Link server** on Profile to choose a server and enable the rule “Twitch follow → in-game broadcast”.

## 5. EventSub webhook (production)

- Twitch will send HTTP POST requests to `TWITCH_WEBHOOK_CALLBACK_URL`.
- Your app must be reachable over HTTPS (Twitch requires HTTPS for production webhooks).
- On first subscription creation, Twitch sends a `webhook_callback_verification` message with a `challenge`; the app responds with the challenge body to confirm ownership.
- Incoming events are verified with `Twitch-Eventsub-Message-Signature` using `TWITCH_EVENTSUB_SECRET`, then normalized, logged, and run through event rules (e.g. follow → broadcast).

## 6. Testing the first Twitch-triggered broadcast

1. Configure all env vars and run migrations.
2. **Webhook must be public:** Twitch can only POST to a public HTTPS URL. On localhost, use a tunnel (e.g. ngrok) and set `TWITCH_WEBHOOK_CALLBACK_URL` to it (e.g. `https://xxx.ngrok.io/api/twitch/webhook`).
3. Link Twitch from Profile (Connect Twitch) and link a server (Link server for “Follow → in-game broadcast”).
4. Ensure the server has RCON connected (user has opened the server page or triggered a connection so the app can send the `say` command).
5. Have someone follow your Twitch channel (or use a test account).
6. Twitch sends the follow event to your webhook; the app logs it, applies the rule, and sends the whitelist action “broadcast” (in-game `say`).
7. Check **Super Admin Dashboard** → “Recent Twitch events” to see the event; check the game server for the broadcast message.

## 7. Retry-safe / duplicate handling

- Each EventSub notification includes `Twitch-Eventsub-Message-Id`. The app stores this in `event_logs.twitch_message_id` and checks it before processing: if the same message id already exists, the event is skipped (no duplicate broadcast).

## 8. Security notes

- Never expose `TWITCH_CLIENT_SECRET`, `TWITCH_EVENTSUB_SECRET`, or `ENCRYPTION_KEY` in the frontend or in logs.
- Tokens are stored encrypted; only the backend decrypts them for API calls or refresh.
- All actions from Twitch events go through the whitelist (e.g. “broadcast” → single `say` command); there is no raw RCON command path from events.
