# RustMaxx

Rust server web admin panel (RustAdmin Core MVP). Connects to Rust game servers via RCON and provides login, server management, live console/chat, and command runner. Deploy on Railway with Postgres.

## Stack

- **Next.js** (App Router) + TypeScript
- **Tailwind CSS**
- **Postgres** (Railway)
- **SSE** for realtime log stream
- **RCON** (server-side only; password never exposed to browser)

## Security (MVP)

- Admin login using `ADMIN_PASSWORD` from env
- Session cookie signed with `SESSION_SECRET`, 12h expiry
- All pages except `/login` require auth

**TODO (Phase 2):** Encrypt RCON password in DB; MVP stores plaintext.

## Local run

1. **Clone and install**

   ```bash
   cd rustmaxx
   npm install
   ```

2. **Environment**

   Copy `.env.example` to `.env` and set:

   - `DATABASE_URL` – Postgres connection string (e.g. `postgresql://user:pass@localhost:5432/rustmaxx`)
   - `ADMIN_PASSWORD` – password for admin login
   - `SESSION_SECRET` – at least 16 characters (used to sign session cookie)

3. **Database**

   ```bash
   npm run migrate
   ```

4. **Start**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000), go to `/login`, sign in, then add a server and connect.

## Railway CLI – migrations and DB

The Railway CLI is installed globally (`@railway/cli`). Use it to run migrations against your Railway Postgres.

**One-time setup (run in your terminal):**

1. **Log in** (opens browser):

   ```bash
   railway login
   ```

2. **Link this folder to your Railway project** (pick the project and environment that has your Postgres):

   ```bash
   cd path/to/rustmaxx
   railway link
   ```

3. **Run migrations** (uses `DATABASE_URL` from the linked project):

   ```bash
   railway run npm run migrate
   ```

To run the 7-day log cleanup later:

```bash
railway run npm run cleanup
```

## Railway deploy

1. **Create a project** on [Railway](https://railway.app) and add a **Postgres** service.

2. **Add your app** (GitHub repo or deploy from CLI). Link the Postgres service so `DATABASE_URL` is set.

3. **Variables**

   - `ADMIN_PASSWORD` – set a strong admin password
   - `SESSION_SECRET` – set a long random string (e.g. `openssl rand -hex 24`)
   - `NODE_ENV=production`

4. **Build & start**

   - Build: `npm run build` (or use Nixpacks/Railway default)
   - Start: `npm start`
   - Run migrations after first deploy: in Railway shell or one-off job run `npm run migrate`

5. **Log retention (optional)**

   To delete logs older than 7 days, run daily:

   ```bash
   npm run cleanup
   ```

   Use Railway cron if available, or document for manual/scheduled run.

## Troubleshooting: Connect returns 502 / "Connection failed"

If **Connect** fails with 502 or an error message:

1. **Reachability** – RustMaxx on Railway runs in the cloud. It can only reach your Rust server if the server has a **public IP** (or a hostname that resolves to one). It cannot reach `localhost` or a server on your home LAN unless you expose it (e.g. port forward + dynamic DNS).
2. **RCON port** – Use the **RCON port** from your host, not the game/join port (e.g. `21715` is usually the game port). On **Shockbyte**: look in Config, Console, or the RCON section for the RCON port and password. Other hosts: check server config or panel for `rcon.port` (often `28016` or game port + 1).
3. **Firewall** – The machine hosting the Rust server must allow **inbound TCP** on the RCON port from the internet (or at least from Railway’s egress IPs).
4. **Password** – Double-check the RCON password in the server config and in RustMaxx (they must match).
5. **Error text** – The UI shows the exact error (e.g. `Connection timeout`, `Authentication failed`, `ECONNREFUSED`). Use it to narrow down the cause.
6. **Connection timeout but RustAdmin (or similar) connects** – The host may allow only certain IPs for RCON. Railway uses dynamic egress IPs by default. Fix: enable **Railway Pro → Static Outbound IP** (Settings → Networking), then ask your host (e.g. Shockbyte) to whitelist that IP for the RCON port. Alternatively, run RustMaxx locally from a network the host already allows.

## How to add a server and connect

1. Log in at `/login`.
2. On **Servers** (`/servers`), fill **Add server**: name, host (IP or hostname), RCON port (often `28016`), RCON password. Click **Add server**.
3. Open the server row to go to **Server detail** (`/servers/[id]`).
4. Click **Connect** to open a backend RCON connection for that server.
5. Use the command input or quick buttons (**status**, **players**, **say test**, **oxide.plugins**) to send commands. Live console and chat lines appear in the log area and are stored in Postgres (last 7 days retention with cleanup job).

## Scripts

- `npm run dev` – development server
- `npm run build` / `npm start` – production
- `npm run migrate` – run DB migrations in `db/migrations/`
- `npm run cleanup` – delete logs older than 7 days (run daily via cron or manually)

## API routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login (body: `{ password }`), sets session cookie |
| POST | `/api/auth/logout` | Clears session cookie |
| GET | `/api/servers` | List servers |
| POST | `/api/servers` | Create server (name, host, port, password) |
| GET | `/api/servers/:id` | Server details |
| POST | `/api/servers/:id/connect` | Ensure RCON connection |
| GET | `/api/servers/:id/stream` | SSE stream of log events |
| POST | `/api/servers/:id/command` | Send RCON command (body: `{ command }`) |
| GET | `/api/servers/:id/logs?limit=200` | Initial logs for page load |

## License

MIT
